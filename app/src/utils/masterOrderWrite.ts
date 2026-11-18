import type * as Y from 'yjs';
import { parseKey } from '@/store/types';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { pageLayoutElementId } from '@/store/layoutElement';
import { selectRootElementIds } from '@/store/selectors';
import { acceptEditorCommands } from '@/store/commandGesture';
import type { MaterializationCommand } from '@/services/durableEdits/types';
import { getLocalSourceScanRevision } from '@/utils/localPageSync';
import { captureWriteBackSourceOwnership } from './pushOverridesToSource';


/**
 * A layout/component master's top-level rows are separate doc elements — one
 * per top-level tag in the file (`el-A:slot-0`, `el-B:header-0`). Reordering
 * them is therefore a doc ROOT reorder, which no writer mirrors to source: the
 * master re-seeds from the file on every reopen, so a component dragged above
 * <slot> snapped straight back to file order (owner: "it still goes down every
 * time"). SET_CHILD_ORDER cannot express this — the rows share no host element,
 * their common parent is the FILE's body.
 *
 * Returns the write-back payload that reorders those tags in the .astro, or
 * null when the reorder is not a master's top level (a page reorder, a mixed
 * bag of files, an element with no source).
 */
export function collectMasterOrderWrite(
  doc: Y.Doc,
  pageId: string | null,
  orderedKeys: string[],
  viewedComponentFile: string | null | undefined,
): { astroSource: string; selectors: string[] } | null {
  if (pageId !== COMPONENT_EDITOR_PAGE_ID || !viewedComponentFile || orderedKeys.length < 2) return null;
  const selectors: string[] = [];
  for (const key of orderedKeys) {
    const parsed = parseKey(key);
    // Each row is an instance-child whose SELECTOR (`header-0`, `slot-0`) is a
    // tag position in the viewed file. The element's own astroSource points at
    // the component's DEFINITION (library/Header.astro), which is why the order
    // must be written against the file being edited, not the row's source.
    // Rows that are NOT file tags — drawn elements, dynamic scan artifacts
    // (`dynamic:div:3@…` appears among CANVAS siblings but never in the tree)
    // — are simply left out: the server reorders only the listed tags and
    // unlisted ones keep their place, which is exactly what those rows need.
    if (parsed?.type !== 'instance-child') continue;
    selectors.push(parsed.selector);
  }
  if (selectors.length < 2) return null;
  return { astroSource: viewedComponentFile, selectors };
}

/**
 * PAGE-tree variant: the reordered rows are the layout-chrome element's
 * children (`layoutchrome-<pageId>:<renderedSelector>`). Rendered selectors
 * cannot name file tags — the slot renders as a div and a component renders as
 * its root tag — so the write is expressed as a PERMUTATION of the pre-drag
 * row order plus that order's rendered selectors, and the server, which parses
 * the real AST, pairs them against the file's top-level tags (write-back-apply
 * `orderPermutation`/`orderRendered`). `previousKeys` is the pre-drag sibling
 * order; the visual order may diverge from the file (pre-fix docs carry
 * stranded page childOrders), which is why the rendered selectors travel with
 * the permutation instead of trusting positions alone.
 */
export function collectChromeOrderWrite(
  doc: Y.Doc,
  pageId: string | null,
  orderedKeys: string[],
  previousKeys: string[] | null | undefined,
): { astroSource: string; permutation: number[]; rendered: string[] } | null {
  if (!pageId || pageId === COMPONENT_EDITOR_PAGE_ID) return null;
  if (!previousKeys || orderedKeys.length < 2 || previousKeys.length !== orderedKeys.length) return null;
  const chromeId = pageLayoutElementId(pageId);
  const rendered: string[] = [];
  for (const key of previousKeys) {
    const parsed = parseKey(key);
    if (parsed?.type !== 'instance-child' || parsed.instanceId !== chromeId) return null;
    rendered.push(parsed.selector);
  }
  for (const key of orderedKeys) {
    const parsed = parseKey(key);
    if (parsed?.type !== 'instance-child' || parsed.instanceId !== chromeId) return null;
  }
  const el = doc.getMap('elements').get(chromeId) as Y.Map<unknown> | undefined;
  const astroSource = el?.get('astroSource');
  if (typeof astroSource !== 'string' || !astroSource.startsWith('layouts/')) return null;
  const permutation = orderedKeys.map((k) => previousKeys.indexOf(k));
  if (permutation.some((i) => i < 0)) return null;
  return { astroSource, permutation, rendered };
}

/**
 * The file the open master edits. A layout master's rows are SEPARATE root
 * elements and a prior reorder can put a component row first, so "first root"
 * (selectEditorRootElementId) is not reliable here — prefer the root whose
 * astroSource is the layout itself. Component masters have a single root, so
 * the first-root fallback stays correct for them.
 */
export function editorViewedFile(doc: Y.Doc): string | null {
  const elements = doc.getMap('elements');
  const roots = selectRootElementIds(doc, COMPONENT_EDITOR_PAGE_ID)
    .map((id) => elements.get(id) as Y.Map<unknown> | undefined)
    .filter((el): el is Y.Map<unknown> => !!el && !el.get('parentId'));
  const srcOf = (el: Y.Map<unknown>) => {
    const src = el.get('astroSource');
    return typeof src === 'string' ? src : null;
  };
  for (const el of roots) {
    const src = srcOf(el);
    if (src?.startsWith('layouts/')) return src;
  }
  return roots.length > 0 ? srcOf(roots[0]) : null;
}

/**
 * THE order-persistence seam for every reorder surface (Layers tree AND canvas
 * drag — the canvas path never wrote the file at all, proven live 2026-08-27
 * from the owner's own pointer trace). Two cases:
 *
 * - Master editor, top-level rows: file selectors are the row keys — queue an
 *   orderOverrides write on the SAME deferred queue component appends use (an
 *   eager write full-reloads the WC iframe mid-edit); it drains at every
 *   editor-leave boundary. Only for ROOT-level reorders: nested rows belong to
 *   a child component's own file, and their selectors must never be written
 *   against the viewed layout (tag-collision risk).
 * - Page, layout-chrome rows: EAGER chained write (nothing drains the queue on
 *   a page) expressed as orderPermutation + orderRendered — the server owns
 *   the AST and pairs rendered rows to file tags.
 */
export function collectOrderCommands(
  doc: Y.Doc,
  pageId: string | null,
  orderedKeys: string[],
  previousKeys: string[] | null | undefined,
  opts?: { rootLevel?: boolean; viewedComponentFile?: string | null },
): MaterializationCommand[] {
  const rootLevel = opts?.rootLevel ?? true;
  if (rootLevel && pageId === COMPONENT_EDITOR_PAGE_ID) {
    const viewed = opts?.viewedComponentFile ?? editorViewedFile(doc);
    const write = collectMasterOrderWrite(doc, pageId, orderedKeys, viewed);
    if (write) {
      return [{ kind: 'source-batch', payload: { payloads: [
          { astroSource: write.astroSource, overrides: { orderOverrides: write.selectors }, selectorSourceRevision: getLocalSourceScanRevision(), ...captureWriteBackSourceOwnership(doc, write.astroSource) },
        ], skipped: [], deferUntil: Date.now() + 86400000 } }];
    }
  }
  const chrome = collectChromeOrderWrite(doc, pageId, orderedKeys, previousKeys);
  if (!chrome) return [];
  return [{ kind: 'source-batch', payload: { payloads: [
      { astroSource: chrome.astroSource, overrides: { orderPermutation: chrome.permutation, orderRendered: chrome.rendered }, selectorSourceRevision: getLocalSourceScanRevision(), ...captureWriteBackSourceOwnership(doc, chrome.astroSource) },
    ], skipped: [] } }];
}

/** Source-only callers still accept intent immediately; grouped owners collect it. */
export async function queueOrderWrite(...args: Parameters<typeof collectOrderCommands>): Promise<void> {
  const commands = collectOrderCommands(...args);
  if (commands.length) await acceptEditorCommands(args[0], [], undefined, commands);
}
