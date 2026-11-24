/**
 * ELEMENTS_SCANNED — the bridge's DOM scan result. Seeds rootElementIds,
 * tracks the selection rect, auto-enters the infra wrapper context, and
 * flushes pending class updates queued against stale keys.
 */
import { applyCommand } from '@/store/commands';
import { selectRootElementIds } from '@/store/selectors';
import { forEachReapplicableTextEntry } from '@/store/sourceTextEntries';
import {
  forEachEditedSourceClassEntry,
  forEachSourceImageAttrsEntry,
  forEachSourceLinkAttrsEntry,
  editedSourceClassValue,
  noteSourceBaseValue,
  noteSourceFileValue,
  SOURCE_OWNED_FIELD,
  HYDRATE_ORIGIN,
} from '@/store/sourceOverrideEntries';
import {
  noteFileValue,
  setFileValue,
  getObservedFileValue,
  observeScannedValue,
  pendingWriteValue,
} from '@/services/classWriteBaseline';
import { MAP_NAME, BASE_FIELD, type LocalOverrideKind } from '@/store/localMasterOverrides';
import { isWrapperKey } from '@/store/keyKind';
import { stillSettling } from '@/utils/propOverrides';
import { sameTokenSet } from '@/core/classes';
import { parseKey } from '@/store/types';
import { migratePlacementKeys } from '@/store/placementKeyMigration';
import {
  peekLocalPendingSelection,
  clearLocalPendingSelection,
  resolveLocalPendingMatch,
  resolveOwnedLocalPendingMatch,
} from '@/utils/localPendingSelection';
import { admitLocalSourceScan, getLocalScanVersion, getLocalSourceScanRevision, getLocalSurfaceGeneration, rendersSupersededSource } from '@/utils/localPageSync';
import { pm } from '@/utils/probeMark';
import { selectOptionsFor } from '@/utils/selectOptions';
import { linkElementAfterScan } from '@/utils/linkSource';
import { viewRootKey } from '@/utils/treeUtils';
import { layoutSelectionRect } from '../canvasFocus';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ViewportMessageContext } from './context';
import { restoreTextDrafts } from './textDrafts';
import { isRootLevelElement, deduplicateKeysToIds } from './elementIds';
import { isLayoutChromeKey } from '@/utils/layoutChromeKeys';

/**
 * The override kinds the DOM scan reports a value for, and how to read it.
 * `undefined` = this element carries nothing for that kind (a <div> has no
 * imageSrc) and the whole row is skipped for it — recording '' would put an
 * image baseline on every element on the page.
 */
const tokensOf = (classes: string) => classes.split(/\s+/).filter(Boolean);

const SCANNED_KINDS: ReadonlyArray<[LocalOverrideKind, (el: ScannedElement) => string | undefined]> = [
  // An override prop renders the PAGE's value; the file value is the master's.
  ['classes', (el) => el.masterClasses ?? el.classes ?? ''],
  ['text', (el) => el.masterText ?? el.textContent ?? ''],
  ['image', (el) => el.masterSrc ?? el.imageSrc],
];

/** The one field of each tier's entry the scan can compare against the DOM. */
const OVERRIDE_FIELD: Record<LocalOverrideKind, string> = {
  classes: 'classes',
  text: 'textContent',
  image: 'src',
};

/** The stored override for `key` in that tier, or undefined if there is none.
 *  Class entries that only record a registration are not overrides. */
function overrideValueFor(
  doc: ViewportMessageContext['env']['doc'], kind: LocalOverrideKind, key: string,
): string | undefined {
  if (kind === 'classes') return editedSourceClassValue(doc, key);
  const entry = doc.getMap(MAP_NAME[kind]).get(key) as { get(f: string): unknown } | undefined;
  const value = entry?.get(OVERRIDE_FIELD[kind]);
  return typeof value === 'string' ? value : undefined;
}

/**
 * An override that lives ONLY in files (an imported project, another machine,
 * a cleared editor cache): the page renders a value its master does not say
 * (`data-sq-cf` / `data-sq-tf`, utils/propOverrides.ts). Seed the editor entry
 * so `*` / Push / Reset reach it. True = seeded.
 */
function seedFileOverride(doc: ViewportMessageContext['env']['doc'], kind: LocalOverrideKind, el: ScannedElement, master: string,
  classEntry: { get(field: string): unknown } | undefined): boolean {
  if (!el.sourceLocation) return false;
  const differs = kind === 'classes' ? el.masterClasses !== undefined && !sameTokenSet(tokensOf(el.classes ?? ''), master)
    : kind === 'text' ? el.masterText !== undefined && (el.textContent ?? '') !== master
    : el.masterSrc !== undefined && (el.imageSrc ?? '') !== master;
  if (stillSettling(el.key, kind, differs) || !differs) return false;
  if (kind === 'classes') {
    if (classEntry?.get(SOURCE_OWNED_FIELD) === '1') return false;
    pm('v2:seed', () => ({ key: el.key.slice(-14), now: (el.classes ?? '').slice(-60), master: master.slice(-60) })); // runtime probe: the scan is a live-doc class writer
    applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: el.key, classes: master, sourceLocation: el.sourceLocation });
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: el.key, classes: el.classes ?? '', sourceLocation: el.sourceLocation });
    return true;
  }
  if (kind === 'image') {
    const src = el.imageSrc ?? '';
    if (src.length >= 200) return false;
    applyCommand(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: el.key, attribute: 'src', value: src });
    return true;
  }
  // The scan caps text at 200 chars — a capped value would repaint truncated.
  const text = el.textContent ?? '';
  if (text.length >= 200) return false;
  applyCommand(doc, { type: 'UPDATE_SOURCE_TEXT', sourceKey: el.key, textContent: text, originalText: master });
  noteSourceBaseValue(doc, MAP_NAME.text, BASE_FIELD.text, el.key, master);
  return true;
}

/** The pending selection a post-write scan is resolving (async): until it lands,
 *  rect pushes must not move the box by the pre-write key (hoverAndRects). */
let resolvingSelection: object | null = null;
export const isSelectionResolving = (): boolean => resolvingSelection !== null;

export function handleElementsScanned(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as { elements: ScannedElement[]; route?: string | null; predicted?: boolean };
  // Wrong-file-write guard (live-smoke Critical): record WHICH ROUTE this scan
  // describes before anything consumes the elements. Local structural ops
  // refuse while it disagrees with the current page's route — otherwise a
  // write resolved from a stale scan lands in the wrong real file.
  const projectId = ctx.env.doc.getMap('meta').get('projectId') as string | undefined;
  if (!admitLocalSourceScan(projectId, p.route ?? null, p.elements)) return;
  ctx.actions.setScannedElements(p.elements);
  // Overrides that exist only in the editor store go into files (export/deploy carry files).
  void import('@/services/durableEdits/propOverrideCommands')
    .then(m => m.migrateEditorOverrides(ctx.env.doc, new Set(p.elements.map(el => el.key))))
    .catch(error => console.warn('[overrides] editor-only overrides not written to files', error));
  // Seamless canvas Task 1.7: a new document re-enters an edit typed before it.
  void restoreTextDrafts(ctx, p.elements, p.route).catch(error => console.warn('[sq] draft restore failed', error));

  // A frame still showing bytes an accepted write replaced (Reset, undo, a value
  // set back to the master) renders the dropped override — never seed it back.
  const seedable = !p.elements.some(el => rendersSupersededSource(projectId, el.sourceLocation) || rendersSupersededSource(projectId, el.usageLocation));

  // task-166: the scan is the only place that sees what the FILE renders for
  // an element the user has never clicked. The class writers need that to keep
  // a dynamic expression's tokens out of the literal they edit, and refuse the
  // partial shapes (class={'lit' + v}, class:list={['lit', v]}) without it.
  // Only-if-absent, and BEFORE reapplySourceClassOverrides below — a later
  // scan sees the parent's applied overrides, not the file.
  //
  // …with ONE exception, which is also the ↻ signal local mode was missing
  // (task-184). A key carrying an EDITED override has two possible scan values:
  // the override (our own re-apply painted it — not the file, never a baseline)
  // or something else, and "something else" can only have come from the file —
  // a fresh load, or the master moved past this edit. That case is allowed to
  // overwrite a known baseline, which is what makes `getClassWriteBaseline`
  // mean "what the file renders NOW" (its documented contract) instead of
  // "whatever the first scan happened to see". It also self-heals the boot
  // seed: ClassStoreContext seeds a restored overlay key from the OVERRIDE,
  // true in server mode (the write landed in the file) and false in local/WC
  // (the write was absorbed into the doc) — the first scan corrects it.
  //
  // task-184 unit B: the loop runs PER OVERRIDE KIND, because `sourceText`
  // shadows a moved master through the identical re-apply below and needs the
  // identical two halves. task-186 FIX-2 added the 'image' row once the bridge
  // scan started carrying the `<img>` src VALUE (it used to report only the
  // `hasSrc` boolean, so `getFileValue('image', …)` was undefined forever and
  // the kind-agnostic ↻ gate could not fire for an image-only master change).
  // ONE transaction for the whole sweep. Each `doc.transact` on `sourceClasses`
  // rebuilds ClassStoreContext's entire state and re-runs every useYjsValue
  // selector in the tree, so a per-element transaction turned a 20-override
  // page into 40 full observer cascades on every iframe load.
  ctx.env.doc.transact(() => {
    for (const el of p.elements) {
      for (const [kind, scanned] of SCANNED_KINDS) {
        const now = scanned(el);
        if (now === undefined) continue; // carries nothing for this kind

        // ONE staleness verdict, before the branch split: the frame may be
        // serving bytes older than a write we dispatched. Believing them would
        // record a value the file never had and re-arm the badge wrongly.
        const classEntry = kind === 'classes' ? ctx.env.doc.getMap('sourceClasses').get(el.key) as { get(field: string): unknown } | undefined : undefined;
        const ownedClassScan = classEntry?.get(SOURCE_OWNED_FIELD) === '1' && !!el.sourceLocation?.sourceVersion;
        // Admission already proved this scan includes accepted source writes.
        // A legacy pending-value cache cannot repaint a previous key occupant.
        if (!ownedClassScan && observeScannedValue(kind, el.key, now) === 'stale') {
          paintPendingValue(ctx, kind, el);
          continue;
        }

        let override = overrideValueFor(ctx.env.doc, kind, el.key);
        if (override === undefined && seedable && seedFileOverride(ctx.env.doc, kind, el, now, classEntry)) override = overrideValueFor(ctx.env.doc, kind, el.key);
        if (override === undefined || override === now) {
          // The first scan to carry a key is the file speaking — nothing has
          // re-applied to it yet — so it OBSERVES even when it agrees with the
          // override. That is how a component-editor master edit (file written,
          // entry left equal to it) heals on the next open instead of shadowing
          // the file the first time it moves externally. Every later agreeing
          // scan is our own re-apply: only-if-absent.
          if (getObservedFileValue(kind, el.key) === undefined) setFileValue(kind, el.key, now);
          else noteFileValue(kind, el.key, now);
          continue;
        }

        // The file moved (or this is the first load): adopt what it renders.
        // Read the PREVIOUS observation first — it is the anchor below.
        const before = getObservedFileValue(kind, el.key);
        setFileValue(kind, el.key, now);
        noteSourceFileValue(ctx.env.doc, MAP_NAME[kind], el.key, now);
        // An override entry that never got the ↻ anchor (restored from a
        // pre-anchor payload, or written by an edit no click preceded) is
        // anchored here — the only place that sees what the file renders.
        // The anchor is the LAST OBSERVED value, not the one just adopted:
        // anchoring to `now` would make base === now and the badge could never
        // fire. Falls back to `now` when nothing was ever observed.
        noteSourceBaseValue(ctx.env.doc, MAP_NAME[kind], BASE_FIELD[kind], el.key, before ?? now);
      }
    }
  }, HYDRATE_ORIGIN);

  // Eager seed rootElementIds from first scan so undo/redo snapshots
  // capture a meaningful order. Uses payload.elements directly because
  // setScannedElements() hasn't flushed yet (React batching).
  const currentPageId = ctx.refs.currentPageId.current;
  if (currentPageId) {
    const currentRootIds = selectRootElementIds(ctx.env.doc, currentPageId);
    if (currentRootIds.length === 0) {
      const rootScanned = p.elements.filter(isRootLevelElement);
      if (rootScanned.length > 0) {
        const candidateIds = deduplicateKeysToIds(rootScanned.map(el => el.key));
        // Layout chrome is NEVER page content (layoutElement.ts invariant).
        // The chrome <slot> scans as a root-level instance-child
        // (`layoutchrome-<pageId>:slot-0` under the page wrapper), and
        // keyToElementId maps it to the layout-chrome ELEMENT id — seeding
        // that id into rootElementIds made selectPageComponents fill the
        // layout's slot with its own chrome (runtime-proven 2026-08-26:
        // div+slot twins sharing one data-key, React dup-key spam).
        const validIds = candidateIds.filter(Boolean).filter((id) => !isLayoutChromeKey(id));
        if (validIds.length > 0) {
          // sync origin: initialization seeding, not tracked by undo
          ctx.env.doc.transact(() => {
            applyCommand(ctx.env.doc, {
              type: 'REORDER_PAGE_ELEMENTS',
              pageId: currentPageId,
              elementIds: validIds,
            });
          }, 'sync');
        }
      }
    }
  }

  // Refresh selectedRect from new scan so overlays track element movement.
  // The selected element is gone from a settled scan (deleted, an undone insert or
  // duplicate): clear the selection, or the panel keeps editing a ghost (#18). A
  // predicted scan still carries pre-write keys — it only drops the box.
  // Not while a structural edit's own selection resolves on this scan: keys are
  // positional, so the selected (pre-write) key may now name a neighbour — the box
  // flashed onto it for ~50 ms (filmstrip 2026-11-08). The pending re-selects.
  // The user re-selected (a click, Escape) since the insert began: theirs wins.
  const resolving = !p.predicted && peekLocalPendingSelection()?.projectId ? peekLocalPendingSelection() : null;
  if (ctx.refs.selectedKey.current && !resolving) {
    if (ctx.refs.selectedKey.current === ctx.refs.layoutRootKey.current) {
      // The Layout root has no DOM element — outline the union of its
      // scanned chrome tags, recomputed from the new scan.
      ctx.actions.updateSelectionRect(layoutSelectionRect(p.elements, ctx.refs.layoutRootKey.current));
    } else {
      const el = p.elements.find(e => e.key === ctx.refs.selectedKey.current);
      const moved = linkElementAfterScan(ctx.refs.selectedKey.current, p.elements);
      if (moved) ctx.refs.selectInContext.current(moved.key, selectOptionsFor(moved));
      else if (el || p.predicted) ctx.actions.updateSelectionRect(el?.rect ?? null);
      else ctx.actions.clearSelection();
      // The selection's facts are post-scan truth too: after a write that
      // changed the tag / src the panel must not wait for a re-click.
      if (el && !moved) ctx.refs.patchSelection?.current?.(el.key, { tagName: el.tagName, classes: el.classes, imageSrc: el.imageSrc ?? null, imageAlt: el.imageAlt ?? null });
    }
  }

  // Auto-select pending element after replace (key starts with elementId)
  if (ctx.refs.pendingSelect.current) {
    const el = matchPendingSelect(ctx.refs.pendingSelect.current, p.elements);
    if (el) {
      ctx.refs.pendingSelect.current = null;
      ctx.refs.selectInContext.current(el.key, selectOptionsFor(el));
    }
  }

  // task-133 Task 5: local-mode structural insert → select the freshly
  // written element once its file rescans. One-shot: the first scan covering
  // the file consumes the pending, matched or not (no sticky selection);
  // exact-line only — see resolveLocalPendingMatch (carry-forward b). Inert
  // for every other runtime (nothing sets the pending there). Can't co-fire
  // with the replace-flow pendingSelect above: the replace flow never runs
  // in local mode (handleSelectComponent's local branch returns first).
  // A predicted scan (applyPrediction) still carries pre-write keys: the
  // one-shot pending must wait for the refresh's scan, or it resolves stale.
  const localPending = p.predicted ? null : peekLocalPendingSelection();
  if (localPending?.projectId) {
    const scanVersion = getLocalScanVersion();
    const generation = getLocalSurfaceGeneration();
    resolvingSelection = localPending;
    void resolveOwnedLocalPendingMatch(localPending, p.elements, projectId, getLocalSourceScanRevision()).then(({ key, consumed }) => {
      if (resolvingSelection === localPending) resolvingSelection = null;
      if (peekLocalPendingSelection() !== localPending || getLocalScanVersion() !== scanVersion || getLocalSurfaceGeneration() !== generation) return;
      if (consumed) clearLocalPendingSelection();
      const match = key ? p.elements.find(el => el.key === key) : undefined;
      if (match) ctx.refs.selectInContext.current(match.key, selectOptionsFor(match));
      // No match: the selection keeps its key; give the box that key's rect now.
      else if (ctx.refs.selectedKey.current) ctx.actions.updateSelectionRect(p.elements.find(e => e.key === ctx.refs.selectedKey.current)?.rect ?? null);
    }, () => { if (resolvingSelection === localPending) resolvingSelection = null; });
  } else if (localPending) {
    const { key, consumed } = resolveLocalPendingMatch(
      localPending,
      p.elements.map((e) => e.key)
    );
    if (consumed) clearLocalPendingSelection();
    const match = key ? p.elements.find((e) => e.key === key) : undefined;
    if (match) {
      // SelectionContext is the ONLY selection owner — same write the
      // pendingSelect (replace flow) block above uses.
      ctx.refs.selectInContext.current(match.key, selectOptionsFor(match));
    }
  }

  // Auto-set context to infrastructure container (e.g., [pageId].astro) if present
  // This puts the user at the "second level" by default, so they can immediately
  // interact with page sections without needing to double-click through the wrapper
  if (!ctx.refs.contextKey.current) {
    const infrastructureContainer = p.elements.find(el =>
      el.parentKey === null && isWrapperKey(el.key)
    );
    if (infrastructureContainer) {
      // Enter the wrapper's context. enterContext never selects, and
      // select() itself refuses infra keys — selecting an infrastructure
      // element confuses the UI (the layout editor would show a styleable
      // "Layout" with nothing meaningful picked, and the Assets row reads
      // as unselected).
      ctx.refs.enterContext.current(infrastructureContainer.key);
    }
  }

  // Process pending class updates. EXACT KEY ONLY — the key is the whole
  // address (file:line:col, placement segment, `#N` repeat counter), so a
  // replay can only ever reach the element the user actually edited.
  //
  // task-181 deleted the `file:line` fallback that used to run first. It was
  // there to re-key an element whose column drifted after a file write, but
  // `file:line` names a LINE, not an element: two placements of one component
  // share it, and so does the same component's bare key in the master view — and
  // the replay took the FIRST scanned match, re-selected it, re-registered it
  // under the pending classes and posted UPDATE_CLASSES. Measured live
  // 2026-08-05: an instance edit made on a page painted the master view.
  // No matching rule over `file:line` can tell a drifted column from a
  // different element on the same line, so it went rather than got tightened;
  // and the drift it existed for cannot arise from a class write, which never
  // moves the start column of the element whose attribute it edits.
  if (ctx.refs.pendingKeyUpdates.current.size > 0) {
    const iframe = ctx.refs.iframe.current;
    if (iframe?.contentWindow) {
      // Build set of current element keys from scanned elements
      const currentKeys = new Set(p.elements.map(el => el.key));

      for (const [key, pendingUpdate] of ctx.refs.pendingKeyUpdates.current.entries()) {
        // Check if this key still exists in the scanned elements
        if (currentKeys.has(key)) {
          iframe.contentWindow.postMessage({
            type: 'UPDATE_CLASSES',
            payload: pendingUpdate
          }, '*');
        }
      }
      // Clear all pending updates after processing (prevents memory leak)
      ctx.refs.pendingKeyUpdates.current.clear();
    }
  }

  // task-159: move any override still stored under the PRE-task-159 placement
  // address onto its current one, BEFORE the three re-applies below — so the
  // first paint after the upgrade is already correct rather than the second.
  // No-op in WC/server (nothing carries a legacyKey) and after the first scan
  // that migrates a page (idempotent).
  migratePlacementKeys(ctx.env.doc, p.elements);

  // Re-apply persisted source-element text overrides. The iframe renders the
  // original source from the snapshot; Yjs sourceText is the truth (model b,
  // docs/archive/plans/2026-06-11-source-writes-dev-model-design.md). Idempotent —
  // the bridge's UPDATE_TEXT handler just sets textContent.
  reapplySourceTextOverrides(ctx, p.elements);
  reapplySourceClassOverrides(ctx, p.elements);
  reapplySourceImageAttrOverrides(ctx, p.elements);
  // AFTER the text re-apply: a stored link-markup override embeds its text,
  // and UPDATE_TEXT (textContent assignment) would wipe the <a> children the
  // markup re-apply just restored if it ran second.
  reapplySourceLinkAttrOverrides(ctx, p.elements);
}

function reapplySourceTextOverrides(ctx: ViewportMessageContext, elements: ScannedElement[]): void {
  if (ctx.refs.isEditingText.current) return; // never clobber an active edit session
  const win = ctx.refs.iframe.current?.contentWindow;
  if (!win) return;
  const sourceText = ctx.env.doc.getMap('sourceText');
  if (sourceText.size === 0) return;

  const byKey = new Map(elements.map((e) => [e.key, e]));
  // Source-file keys AND instance-child keys — for the latter this re-apply is
  // the ONLY reload path (see sourceTextEntries.ts header for the kind split).
  forEachReapplicableTextEntry(ctx.env.doc, (key, textContent) => {
    const scanned = byKey.get(key);
    if (!scanned) return; // entry is stale or belongs to another page's files — inert
    // Scanner reports empty text as undefined — coalesce so an override of ''
    // doesn't re-post UPDATE_TEXT on every scan forever
    if ((scanned.textContent ?? '') === textContent) return;
    win.postMessage({ type: 'UPDATE_TEXT', payload: { key, textContent } }, '*');
  });
}

/**
 * Re-apply persisted source-element class overrides (model b, task-070).
 * Load-bearing, not cosmetic: ClassStoreContext.registerElement treats a
 * DOM≠Yjs mismatch on click as an "external change" and overwrites Yjs with
 * the DOM's original classes — the DOM must match Yjs before any click.
 * Only `edited` entries re-apply; registered-unedited entries mean the DOM
 * is the truth.
 */
/**
 * Paint the value a dispatched write is still waiting on straight onto the
 * element, instead of reloading the frame to reveal it.
 *
 * A local class write makes the dev server HMR-reload the frame, but the editor
 * has usually navigated by then, so the page can load carrying pre-write bytes.
 * Reloading to correct that showed the OLD value first and then swapped it —
 * visible blinking (owner, 2026-08-06). The dispatched value is already known,
 * so draw it: the same bytes HMR will render, one frame earlier.
 *
 * Classes only in effect: only class writes arm the guard (the dispatch
 * listener filters on SQ_WRITE_CLASSES), so `pendingWriteValue` is always
 * undefined for text/image. Generalising the paint before they get a dispatch
 * stamp would be dead code.
 */
function paintPendingValue(
  ctx: ViewportMessageContext, kind: LocalOverrideKind, el: ScannedElement,
): void {
  if (kind !== 'classes') return;
  const classes = pendingWriteValue(kind, el.key);
  if (classes === undefined) return;
  const win = ctx.refs.iframe.current?.contentWindow;
  if (!win) return;
  const parsed = parseKey(el.key);
  if (parsed?.type !== 'source') return;
  win.postMessage({
    type: 'UPDATE_CLASSES',
    payload: {
      key: el.key,
      classes,
      sourceLocation: { file: parsed.file, line: parsed.line, column: parsed.col },
    },
  }, '*');

}

function reapplySourceClassOverrides(ctx: ViewportMessageContext, elements: ScannedElement[]): void {
  const win = ctx.refs.iframe.current?.contentWindow;
  if (!win) return;
  if (ctx.env.doc.getMap('sourceClasses').size === 0) return;

  const byKey = new Map(elements.map((e) => [e.key, e]));
  forEachEditedSourceClassEntry(ctx.env.doc, ({ key, file, line, col, classes }) => {
    const scanned = byKey.get(key);
    if (!scanned) return; // stale or another page's files — inert
    if ((scanned.classes ?? '') === classes) return; // idempotent
    win.postMessage({
      type: 'UPDATE_CLASSES',
      payload: { key, classes, sourceLocation: { file, line, column: col } },
    }, '*');
  });
}

/**
 * Re-apply persisted source-element image attributes (model b, task-070).
 * The sq:iframe-ready sweep in useInstanceOverrideSync covers RENDER-driven
 * rebuilds, but an HMR iframe reload with an unchanged render key skips
 * RENDER entirely — ELEMENTS_SCANNED is the deterministic hook. The bridge
 * handler is idempotent (sets attributes); scans don't report img attrs, so
 * no equality check is possible — matching keys re-post each scan.
 */
function reapplySourceImageAttrOverrides(ctx: ViewportMessageContext, elements: ScannedElement[]): void {
  const win = ctx.refs.iframe.current?.contentWindow;
  if (!win) return;
  if (ctx.env.doc.getMap('sourceImageAttributes').size === 0) return;

  const keys = new Set(elements.map((e) => e.key));
  forEachSourceImageAttrsEntry(ctx.env.doc, ({ key, attributes }) => {
    if (!keys.has(key)) return;
    for (const [attribute, value] of Object.entries(attributes)) {
      win.postMessage({ type: 'UPDATE_IMAGE_ATTRIBUTE', payload: { key, attribute, value } }, '*');
    }
  });
}

/**
 * Re-apply persisted inline-link markup: the LINK_MARKUP_FIELD entry
 * (link wrap/unwrap via MARKUP_CHANGED) → UPDATE_SOURCE_MARKUP, an idempotent
 * innerHTML set in the bridge. Skipped while a text-edit session is live —
 * setting innerHTML would destroy the caret mid-edit. A link's attributes are the file's: a
 * value stored in the doc would shadow it, so none is repainted.
 */
function reapplySourceLinkAttrOverrides(ctx: ViewportMessageContext, elements: ScannedElement[]): void {
  const win = ctx.refs.iframe.current?.contentWindow;
  if (!win) return;
  if (ctx.env.doc.getMap('sourceLinkAttributes').size === 0) return;

  const keys = new Set(elements.map((e) => e.key));
  forEachSourceLinkAttrsEntry(ctx.env.doc, ({ key, markup }) => {
    if (!keys.has(key)) return;
    if (markup !== undefined && !ctx.refs.isEditingText.current) {
      win.postMessage({ type: 'UPDATE_SOURCE_MARKUP', payload: { key, markup } }, '*');
    }
  });
}

/**
 * `sq:pending-select` targets an element id (replace flow: the id or any key
 * under `id:`) OR a master FILE (opened from Assets / ↗): its root via
 * viewRootKey. Shared by the scan (target arrives with the next scan) and
 * ViewportFrame's listener (target already on the canvas — re-selecting the
 * open master).
 */
export function matchPendingSelect(pendingId: string, elements: ScannedElement[]): ScannedElement | undefined {
  if (pendingId.endsWith('.astro')) {
    const key = viewRootKey(pendingId, elements);
    return key ? elements.find(e => e.key === key) : undefined;
  }
  return elements.find(e => e.key === pendingId || e.key.startsWith(pendingId + ':'));
}
