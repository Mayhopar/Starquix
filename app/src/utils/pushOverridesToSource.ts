import * as Y from 'yjs';
import { selectPageDrawnElements } from '@/store/selectors';
import { serializeDrawnTree } from '@/store/serializeDrawnTree';
import { resolveOverrideSource } from './resolveOverrideSource';
import { resolveDeleteTarget } from './resolveDeleteTarget';
import { isEditedSourceClassEntry } from '@/store/sourceOverrideEntries';
import { rootSelectorForMarkup } from '@/store/constants';
import { isSlotSelector } from '@/utils/layoutChromeKeys';
import type { WriteBackReport } from '@/vite-plugin/write-back-apply';
import { queueSourceWrites } from './pendingSourceWrites';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { db } from '@/db';
import { isLocalProjectId } from './localMode';
import { captureLocalSourceScan, captureLocalSourceScanOwnership } from './localPageSync';
import { resolveComponentSourcePath } from './astroAssetPaths';

export interface SkippedEntry {
  source: string;                                  // which .astro file
  category: keyof WriteBackReport['skipped'];
  selector: string;
  reason: 'unresolved' | 'inside-component' | 'not-found';
}

export interface PushResult {
  astroSource: string;
  skipped: SkippedEntry[];
  appliedTotal: number;
  /** The serialized top-level drawn markups baked into the editor's OWN
   *  source (markRoot'ed) — the overlay mirror appends exactly these. */
  drawnMarkups?: string[];
}

interface SourceBucket {
  classOverrides: Record<string, string>;
  textOverrides: Record<string, string>;
  imageOverrides: Record<string, Record<string, string>>;
  linkOverrides: Record<string, Record<string, string>>;
  attributeOverrides: Record<string, Record<string, string>>;
  orderOverrides: string[];
  // Cross-parent source moves (task-078): each moves a child selector under a new
  // parent selector (or to the file's top level when newParentSelector is null).
  reparentOverrides: Array<{ selector: string; newParentSelector: string | null }>;
  deletedSelectors: string[];
  // `undefined` = don't touch this source's drawn region. A present array (incl.
  // []) = reconcile: strip all baked drawn, re-insert this set. The editor's own
  // source is ALWAYS made present so a full delete still strips from source.
  drawnReconcile: Array<{ markup: string; parentSelector?: string }> | undefined;
}

function makeBucket(): SourceBucket {
  return {
    classOverrides: {}, textOverrides: {}, imageOverrides: {},
    linkOverrides: {}, attributeOverrides: {}, orderOverrides: [], reparentOverrides: [],
    deletedSelectors: [],
    drawnReconcile: undefined,
  };
}

/**
 * Y.Map<selector, Y.Map<attr, value>> → Record<selector, Record<attr, value>>,
 * keeping only string values (incl. '' — a meaningful "remove" instruction for
 * attribute overrides). `transform` remaps attr names where a collector needs it
 * (linkOverrides: ariaLabel → aria-label). Shared by the image/link/attribute
 * collectors.
 */
function collectAttrMap(
  yMap: Y.Map<Y.Map<unknown>> | undefined,
  transform: (attr: string) => string = (a) => a,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!yMap || yMap.size === 0) return out;
  yMap.forEach((attrMap, selector) => {
    const attrs: Record<string, string> = {};
    attrMap.forEach((value, attr) => {
      if (typeof value === 'string') attrs[transform(attr)] = value;
    });
    if (Object.keys(attrs).length > 0) out[selector] = attrs;
  });
  return out;
}

function bucketHasContent(b: SourceBucket): boolean {
  return (
    Object.keys(b.classOverrides).length > 0 ||
    Object.keys(b.textOverrides).length > 0 ||
    Object.keys(b.imageOverrides).length > 0 ||
    Object.keys(b.linkOverrides).length > 0 ||
    Object.keys(b.attributeOverrides).length > 0 ||
    b.orderOverrides.length > 0 ||
    b.reparentOverrides.length > 0 ||
    b.deletedSelectors.length > 0 ||
    // A present drawnReconcile (even []) is meaningful content — it instructs the
    // server to strip the source's baked drawn region (delete propagation).
    b.drawnReconcile !== undefined
  );
}

/** One POST-able write-back unit: a source file plus its override payload. */
export interface SourceWritePayload {
  astroSource: string;
  overrides: Record<string, unknown>;
  /** Every positional selector belongs to this source's authenticated scan. */
  selectorSourceRevision?: number;
  selectorSourceVersion?: string;
}

/** Each bucket owns its source's scan, not the host component's coordinates. */
export function captureWriteBackSourceOwnership(doc: Y.Doc, source: string): Pick<SourceWritePayload, 'selectorSourceRevision' | 'selectorSourceVersion'> {
  const projectId = doc.getMap('meta').get('projectId');
  if (typeof projectId !== 'string' || !isLocalProjectId(projectId)) return {};
  const file = source.startsWith('src/') ? source : resolveComponentSourcePath(source);
  const owner = captureLocalSourceScanOwnership(projectId, file);
  return { selectorSourceRevision: owner.sourceRevision,
    ...(owner.sourceVersion ? { selectorSourceVersion: owner.sourceVersion } : {}) };
}

/** Staged Push keeps collection/bake serialized but freezes gesture identity now. */
export function captureWriteBackSourceScan(doc: Y.Doc): (source: string) => Pick<SourceWritePayload, 'selectorSourceRevision' | 'selectorSourceVersion'> {
  const projectId = doc.getMap('meta').get('projectId');
  if (typeof projectId !== 'string' || !isLocalProjectId(projectId)) return () => ({});
  const scan = captureLocalSourceScan(projectId);
  return source => {
    const owner = scan(source.startsWith('src/') ? source : resolveComponentSourcePath(source));
    return { selectorSourceRevision: owner.sourceRevision,
      ...(owner.sourceVersion ? { selectorSourceVersion: owner.sourceVersion } : {}) };
  };
}

/**
 * Synchronous collection phase: gather an element's overrides into per-source
 * write-back payloads WITHOUT any network I/O. Callers that must survive a
 * later override-clear (Push-to-source) or defer the write to a navigation
 * boundary (pendingSourceWrites) collect now and send later.
 * Returns null only when there is no element / astroSource.
 */
export function collectWriteBackPayloads(
  doc: Y.Doc,
  elementId: string,
  opts?: { reconcileDrawn?: boolean; skipDrawn?: boolean; sourceOwnership?: ReturnType<typeof captureWriteBackSourceScan> },
): { astroSource: string; payloads: SourceWritePayload[]; skipped: SkippedEntry[]; drawnMarkups: string[] } | null {
  const elements = doc.getMap('elements');
  const yEl = elements.get(elementId) as Y.Map<unknown> | undefined;
  if (!yEl) return null;

  const astroSource = yEl.get('astroSource') as string | undefined;
  if (!astroSource) return null;
  const sourceOwnership = opts?.sourceOwnership ?? captureWriteBackSourceScan(doc);

  // Collect classOverrides: Y.Map<Y.Map<Y.Array<string>>> → Record<string, string>
  const yClassOverrides = yEl.get('classOverrides') as Y.Map<Y.Map<Y.Array<string>>> | undefined;
  const classOverrides: Record<string, string> = {};
  if (yClassOverrides && yClassOverrides.size > 0) {
    yClassOverrides.forEach((selectorMap, selector) => {
      const allClasses: string[] = [];
      selectorMap.forEach((bpClasses, bp) => {
        const classes = bpClasses.toArray();
        if (bp === 'xs' || bp === 'base') {
          allClasses.push(...classes);
        } else {
          allClasses.push(...classes.map(c => `${bp}:${c}`));
        }
      });
      if (allClasses.length > 0) {
        classOverrides[selector] = allClasses.join(' ');
      }
    });
  }

  // Collect textOverrides from sourceText map
  const sourceText = doc.getMap('sourceText');
  const textOverrides: Record<string, string> = {};
  sourceText.forEach((value, textKey) => {
    if (textKey.startsWith(elementId + ':')) {
      const selector = textKey.slice(elementId.length + 1);
      const yEntry = value as Y.Map<unknown>;
      const text = yEntry.get('textContent') as string;
      if (text) textOverrides[selector] = text;
    }
  });

  // Collect markupOverrides (link wrapping, rich text) — these override textOverrides
  const yMarkupOverrides = yEl.get('markupOverrides') as Y.Map<string> | undefined;
  if (yMarkupOverrides && yMarkupOverrides.size > 0) {
    yMarkupOverrides.forEach((innerHTML, selector) => {
      const sanitized = innerHTML
        .replace(/<a\s+([^>]*?)class="[^"]*"([^>]*)>/gi, '<a $1$2>')
        .replace(/<a\s+([^>]*?)class='[^']*'([^>]*)>/gi, '<a $1$2>');
      textOverrides[selector] = sanitized;
    });
  }

  // Instance pushes store text/class edits in the `overrides` map
  // (UPDATE_INSTANCE_OVERRIDE, commands.ts) — a container the component editor
  // never uses. Map {text, classes} into the same buckets so Push-to-source
  // materializes them. sourceText/markupOverrides win on selector collision
  // (they are the newer, richer tiers).
  // ponytail: only text+classes mapped; hrefOverrides/imageAttributes/
  // linkAttributes/unifiedOverrides stay doc-only until a real gap shows.
  const yInstanceOverrides = yEl.get('overrides') as Y.Map<Y.Map<unknown>> | undefined;
  yInstanceOverrides?.forEach((o, selector) => {
    const t = o.get('text');
    if (typeof t === 'string' && !(selector in textOverrides)) textOverrides[selector] = t;
    const c = o.get('classes');
    if (typeof c === 'string' && !(selector in classOverrides)) classOverrides[selector] = c;
  });

  // Image / link / attribute overrides share the Y.Map<selector, Y.Map<attr>>
  // shape — one collector, with link remapping ariaLabel → aria-label.
  const imageOverrides = collectAttrMap(yEl.get('imageOverrides') as Y.Map<Y.Map<unknown>> | undefined);
  const linkOverrides = collectAttrMap(
    yEl.get('linkOverrides') as Y.Map<Y.Map<unknown>> | undefined,
    (attr) => (attr === 'ariaLabel' ? 'aria-label' : attr),
  );
  // attributeOverrides KEEPS '' values — '' means "remove this attribute in
  // source" (e.g. clearing a slot name back to the default slot).
  const attributeOverrides = collectAttrMap(yEl.get('attributeOverrides') as Y.Map<Y.Map<unknown>> | undefined);

  // Collect orderOverrides and deletedSelectors
  const yOrderOverrides = yEl.get('orderOverrides') as Y.Array<string> | undefined;
  const orderOverrides = yOrderOverrides?.toArray() || [];
  // reparentOverrides: Y.Array<"childSelector>parentSelector"> ('' parent = root).
  const yReparentOverrides = yEl.get('reparentOverrides') as Y.Array<string> | undefined;
  const reparentOverrides = (yReparentOverrides?.toArray() || []).map((entry) => {
    const sep = entry.indexOf('>');
    const selector = sep === -1 ? entry : entry.slice(0, sep);
    const parent = sep === -1 ? '' : entry.slice(sep + 1);
    return { selector, newParentSelector: parent === '' ? null : parent };
  });
  const yDeletedSelectors = yEl.get('deletedSelectors') as Y.Array<string> | undefined;
  const deletedSelectors = yDeletedSelectors?.toArray() || [];

  // Collect drawn elements that live on the page hosting this editor element.
  // Treats the page-template editor as a "page" — drawn boxes added inside it
  // bake into the source so instances (e.g. every post page wrapped in
  // BlogPost) get the same boxes on next render. Without this, drawn
  // elements stay in Yjs only and never propagate.
  // skipDrawn (instance push): the host page's drawn boxes belong to the PAGE,
  // not the pushed component — collecting them here would bake page furniture
  // into the master .astro.
  const pageId = yEl.get('pageId') as string | undefined;
  const drawnAll = pageId && !opts?.skipDrawn ? selectPageDrawnElements(doc, pageId) : [];
  // Top-level roots: no parent, the editor element itself, OR a legacy wrapper
  // key (pre-task-078 data — tolerate as top-level, ledger F5). Section-nested
  // roots: parent is a source/instance child of THIS editor element (el-x:sel),
  // baked under that selector's closing tag (task-078 Problem B). Descendants of
  // either are pulled in by serializeDrawnTree's recursion, so we only emit roots.
  const isSectionNested = (d: { parentKey?: string | null }) =>
    !!d.parentKey && d.parentKey.startsWith(elementId + ':');
  // A parentKey referencing another DRAWN element: the child rides its root's
  // serializeDrawnTree recursion, never emits on its own. Keys hashed once —
  // a `some()` inside the `filter()` below is quadratic in the page's drawn count.
  const drawnKeys = new Set(drawnAll.map((d) => d.key));
  const isDrawnChild = (d: { parentKey?: string | null }) =>
    !!d.parentKey && drawnKeys.has(d.parentKey);
  // Top-level: no parent, the editor element itself, a legacy wrapper key —
  // or a parentKey NOTHING in this session resolves (2026-08-26: every master
  // reopen seeds a NEW editor id, so a drawn kept `el-OLD:slot-0` from the
  // session it was drawn in; matching neither bucket silently dropped it from
  // the bake, and the synchronous overlay mirror then STRIPPED it from every
  // page). An unresolvable parent renders as a root, so it bakes as one.
  const isTopLevel = (d: { parentKey?: string | null }) =>
    !isSectionNested(d) && !isDrawnChild(d);

  const topLevelDrawn = drawnAll.filter(isTopLevel);
  const nestedDrawn = drawnAll.filter(isSectionNested);

  // Group overrides by their TRUE source file. Tags rendered from
  // <Header /> / <Footer /> inside a page-template editor route to the
  // sub-component's source, not to the page-template's. See
  // docs/archive/plans/2026-05-13-page-template-subcomponent-propagation-design.md.
  const staticMarkup = (yEl.get('staticMarkup') as string) || '';

  // Class edits that rode the doc-level sourceClasses tier (task-070): keyed
  // `${elementId}` (the instance ROOT — e.g. a fill change on the whole
  // component) or `${elementId}:selector` (children). Only `edited: true`
  // entries are user edits; inert registrations must not write back. The root
  // maps to the canonical `<tag>-0` selector. On-element classOverrides win
  // on collision (newer tier).
  const rootSelector = rootSelectorForMarkup(staticMarkup);
  doc.getMap('sourceClasses').forEach((v, k) => {
    if (k !== elementId && !k.startsWith(elementId + ':')) return;
    const entry = v as Y.Map<unknown>;
    if (!isEditedSourceClassEntry(entry, k)) return;
    const classes = entry.get('classes');
    if (typeof classes !== 'string') return;
    const selector = k === elementId ? rootSelector : k.slice(elementId.length + 1);
    if (selector && !(selector in classOverrides)) classOverrides[selector] = classes;
  });

  const buckets = new Map<string, SourceBucket>();
  const bucket = (src: string): SourceBucket => {
    let b = buckets.get(src);
    if (!b) { b = makeBucket(); buckets.set(src, b); }
    return b;
  };
  const routed = (selector: string) => resolveOverrideSource(staticMarkup, selector, astroSource);

  const skipped: SkippedEntry[] = [];

  // Class/text/image/link/attribute/order/delete overrides are collected for the
  // flush. task-078: the old `drawnOnly` eager-flush mode (which withheld these
  // and mirrored ONLY the drawn region every 400ms structural tick) was REMOVED.
  // That .astro write full-reloads the preview iframe — a visible "blink"
  // (the exact reason class/text/image already defer to leave). Drawn now stay
  // live in Yjs + localStorage and their source mirror defers to the leave flush
  // like every other override; instances/export pick them up on leave.
  for (const [selector, value] of Object.entries(classOverrides)) {
    const r = routed(selector);
    bucket(r.source).classOverrides[r.subSelector] = value;
  }
  for (const [selector, value] of Object.entries(textOverrides)) {
    const r = routed(selector);
    bucket(r.source).textOverrides[r.subSelector] = value;
  }
  for (const [selector, attrs] of Object.entries(imageOverrides)) {
    const r = routed(selector);
    bucket(r.source).imageOverrides[r.subSelector] = attrs;
  }
  for (const [selector, attrs] of Object.entries(linkOverrides)) {
    const r = routed(selector);
    bucket(r.source).linkOverrides[r.subSelector] = attrs;
  }
  for (const [selector, attrs] of Object.entries(attributeOverrides)) {
    const r = routed(selector);
    bucket(r.source).attributeOverrides[r.subSelector] = attrs;
  }
  // Reorder is a sibling relationship in the page-template source, not in
  // any sub-component — bucket directly under the editor element's
  // `astroSource` instead of marker-routing. Server selector resolution is
  // case-insensitive so lowercase selectors hit PascalCase component tags.
  if (orderOverrides.length > 0) {
    bucket(astroSource).orderOverrides.push(...orderOverrides);
  }
  // Cross-parent moves bucket under the editor's own source (same-file relationship,
  // like reorder). Sub-component routing is a Phase-2 concern (ledger C4/D14).
  if (reparentOverrides.length > 0) {
    bucket(astroSource).reparentOverrides.push(...reparentOverrides);
  }
  for (const selector of deletedSelectors) {
    const r = resolveDeleteTarget(staticMarkup, selector, astroSource);
    if (r.kind === 'reject') {
      console.warn(
        '[SQ-LAYOUT] delete dropped:',
        r.reason === 'inside-component'
          ? `selector "${selector}" is inside-component (${r.componentSrc}); single-instance delete cannot scope to one page`
          : `selector "${selector}" not-found in resolved markup`,
      );
      skipped.push({
        source: astroSource,
        category: 'deletes',
        selector,
        reason: r.reason === 'inside-component' ? 'inside-component' : 'not-found',
      });
      continue;
    }
    bucket(astroSource).deletedSelectors.push(r.sourceSelector);
  }

  // Drawn elements are the editor's LIVE truth (they stay in Yjs); the source is
  // a reconciled mirror. We send the FULL current drawn set as `drawnReconcile`
  // so the server strips every baked `data-sq-drawn` and re-inserts this set —
  // making add AND delete both modify source. Mark roots (`markRoot`) so the
  // strip can find them next time; export/Make-Component omit the marker.
  //
  const ensureReconcile = (src: string) => {
    const b = bucket(src);
    if (b.drawnReconcile === undefined) b.drawnReconcile = [];
    return b.drawnReconcile;
  };
  // Force a present (possibly empty) reconcile on the editor's OWN source when
  // the caller is a drawn structural flush (`reconcileDrawn`). A delete-to-zero
  // leaves no drawn in Yjs, so only an empty-array reconcile can tell the server
  // to strip the now-orphaned boxes from source. Ordinary leave-flushes (class/
  // text/image) omit the flag, so a component with no drawn stays a clean no-op.
  if (opts?.reconcileDrawn) ensureReconcile(astroSource);
  // Top-level roots → the editor element's own source.
  for (const d of topLevelDrawn) {
    ensureReconcile(astroSource).push({ markup: serializeDrawnTree(drawnAll, d.key, { markRoot: true }) });
  }
  // Section-nested roots → routed to the parent selector's TRUE source file
  // (sub-component aware). Routing a nested insert also makes that source
  // reconcile, so its baked region stays in sync as nested boxes are added.
  for (const d of nestedDrawn) {
    const rawSel = d.parentKey!.slice(elementId.length + 1); // e.g. 'section-0'
    const r = routed(rawSel);
    // A <slot> is a compile-time placeholder, not a container — a drawn box
    // whose parentKey resolved to the layout master's rendered slot must bake
    // as TOP-LEVEL chrome (a sibling of the <slot/>), never inside it. The
    // server cannot resolve `slot-N` (mapKeyToPosition skips slot tags), so
    // routing it as a parentSelector silently skipped the whole insert:
    // "[SQ-SAVE] write-back skipped selectors" + the layout .astro never
    // received the drawn element (proven 2026-08-26).
    if (isSlotSelector(r.subSelector)) {
      ensureReconcile(r.source).push({
        markup: serializeDrawnTree(drawnAll, d.key, { markRoot: true }),
      });
      continue;
    }
    ensureReconcile(r.source).push({
      markup: serializeDrawnTree(drawnAll, d.key, { markRoot: true }),
      parentSelector: r.subSelector,
    });
  }

  // Top-level drawn markups on the editor's own source — the leave flush
  // mirrors these into the masters overlay (3-store law: doc + overlay + .astro).
  const drawnMarkups = (buckets.get(astroSource)?.drawnReconcile ?? [])
    .filter((i) => !i.parentSelector)
    .map((i) => i.markup);

  const payloads: SourceWritePayload[] = [];
  for (const [src, b] of buckets.entries()) {
    if (!bucketHasContent(b)) continue;
    const payload: Record<string, unknown> = {
      classOverrides: b.classOverrides,
      textOverrides: b.textOverrides,
      imageOverrides: b.imageOverrides,
    };
    if (Object.keys(b.linkOverrides).length > 0) payload.linkOverrides = b.linkOverrides;
    if (Object.keys(b.attributeOverrides).length > 0) payload.attributeOverrides = b.attributeOverrides;
    if (b.orderOverrides.length > 0) payload.orderOverrides = b.orderOverrides;
    if (b.reparentOverrides.length > 0) payload.reparentOverrides = b.reparentOverrides;
    if (b.deletedSelectors.length > 0) payload.deletedSelectors = b.deletedSelectors;
    if (b.drawnReconcile !== undefined) payload.drawnReconcile = b.drawnReconcile;
    payloads.push({ astroSource: src, overrides: payload, ...sourceOwnership(src) });
  }

  return { astroSource, payloads, skipped, drawnMarkups };
}

interface WriteBackResponse {
  success: boolean;
  content?: string;
  report?: WriteBackReport;
  changed?: boolean;
}

/**
 * Network phase: POST collected payloads to /__sq/write-back-component.
 * `keepalive` is for the
 * pagehide flush only — keepalive fetches cap the body at ~64KB, so ordinary
 * flushes (whose drawnReconcile markup can exceed that) must not set it.
 */
export async function sendWriteBackPayloads(
  payloads: SourceWritePayload[],
  opts?: { keepalive?: boolean },
): Promise<{ skipped: SkippedEntry[]; appliedTotal: number }> {
  const skipped: SkippedEntry[] = [];
  let appliedTotal = 0;

  // Push every source in parallel. Each call has selectors local to that
  // source, so the server endpoint stays unchanged.
  await Promise.all(
    payloads.map(async ({ astroSource: src, overrides: payload }) => {
      const response = await fetch('/__sq/write-back-component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ astroSource: src, overrides: payload }),
        ...(opts?.keepalive ? { keepalive: true } : {}),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const err = (data as { error?: string; refusedSelectors?: string[] }).error;
        const refused = (data as { refusedSelectors?: string[] }).refusedSelectors;
        if (refused?.length) {
          console.error('[SQ-LAYOUT] write-back refused for', src, '— selectors:', refused);
        }
        throw new Error(err || `Write-back failed for ${src}`);
      }

      const result = (await response.json().catch(() => null)) as WriteBackResponse | null;
      if (result?.report) {
        for (const [category, selectors] of Object.entries(result.report.skipped)) {
          for (const selector of selectors) {
            skipped.push({
              source: src,
              category: category as SkippedEntry['category'],
              selector,
              reason: 'unresolved',
            });
            // Drawn stays LIVE in Yjs regardless — an unresolved nested insert
            // just means that box isn't mirrored to source yet (still visible in
            // the editor). No removal, so nothing to "keep".
          }
        }
        appliedTotal += Object.values(result.report.applied).reduce((a, n) => a + n, 0);
      }
    }),
  );

  return { skipped, appliedTotal };
}

/**
 * Collect overrides from a Yjs element and push them to the source .astro file.
 * Used by the component editor to auto-save changes when leaving.
 *
 * Returns null only when there is no editor element / astroSource. Otherwise
 * returns a PushResult whose `skipped` list aggregates BOTH the server's
 * applied/skipped report and client-side resolveDeleteTarget rejections, so
 * callers can surface "saved, but these edits didn't land" instead of
 * trusting a bare 200. See docs/archive/plans/2026-06-10-save-feedback-design.md §4.2.
 *
 * Drawn elements stay LIVE in Yjs — the source is a derived mirror, not the
 * truth (Critical Rule 7). They keep rendering via the incremental
 * INSERT/REMOVE_DRAWN_ELEMENT path; the editor reopen strips the baked
 * `data-sq-drawn` from source so there is no double-render. (Previously this
 * removed flushed roots from Yjs, which made the box vanish on flush and a
 * delete never propagate.)
 */
export async function pushOverridesToSource(
  doc: Y.Doc,
  elementId: string,
  opts?: { reconcileDrawn?: boolean; skipDrawn?: boolean },
): Promise<PushResult | null> {
  const collected = collectWriteBackPayloads(doc, elementId, opts);
  if (!collected) return null;
  const { astroSource, payloads, skipped, drawnMarkups } = collected;

  // Clean no-op flush — still a PushResult so callers can report "nothing to
  // save" distinctly from "no editor element" (null). Client-side delete
  // rejections collected above stay visible even when nothing is POSTed.
  if (payloads.length === 0 && skipped.length === 0) return { astroSource, skipped, appliedTotal: 0 };
  const projectId = doc.getMap('meta').get('projectId') as string | undefined;
  if (!projectId) throw new Error('Project storage is not ready');
  const accepted = await queueSourceWrites(payloads, skipped, { doc });
  await flushDurableSourceWrites(projectId);
  const receipts = await db.durableCommandReceipts.bulkGet(payloads.map((_, index) =>
    [projectId, JSON.stringify([accepted.operationId, index])]));
  const appliedTotal = receipts.reduce((total, row) => {
    if (row?.outcome?.status !== 'written' || row.prepared.appliedTotal === undefined) {
      throw new Error('Source receipt does not report its applied operations');
    }
    return total + row.prepared.appliedTotal;
  }, 0);
  return {
    astroSource,
    skipped: [],
    appliedTotal,
    drawnMarkups,
  };
}
