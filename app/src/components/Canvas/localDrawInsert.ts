import { sourceActionFailure } from '@/utils/sourceActionFeedback';
/**
 * task-133 Task 7: canvas draw → immediate materialization in the local
 * (files-truth) runtime. Drawn elements must NOT enter the doc (no doc-RENDER
 * for local iframes — they'd be invisible phantoms); instead the draw gesture
 * serializes to real markup and writes the real file at once. Mirrors the
 * Task 5/6 module pattern (localComponentInsert.ts / localStructuralOps.ts):
 * plain-data module, no doc dispatch, no takeSnapshot, single toast per
 * failure. Shares the structural write turn (store/structuralWriteGuard): a draw
 * behind a delete/move/insert waits for it (writes race the HMR reload; a second
 * write against pre-reload line numbers would corrupt the file).
 */
import toast from 'react-hot-toast';
import type { ScannedElement } from '@/context/SelectionContext';
import { resolveInsertTarget, type LocalStructuralResult } from '@/utils/localStructural';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { setLocalPendingSelection, getSelectionEpoch } from '@/utils/localPendingSelection';
import { serializeDrawnPayload } from '@/store/serializeDrawnTree';
import {
  acquireStructuralWrite,
  releaseStructuralWrite,
  classifyStructuralTarget,
  planLocalReparentInsert,
} from '@/components/Editor/localStructuralOps';
import { resolveLocalUsageTarget } from '@/utils/localUsageTarget';
import { afterLocalPageArrives, isLocalPageInSync, LOCAL_PAGE_NOT_LOADED_REASON } from '@/utils/localPageSync';
import { notifyLocalCrossFileWrite, localCrossFileReason, captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { insertRegionInverseOp, type PushStructuralUndo } from '@/store/structuralUndo';

/** Canvas.handleElementCreated's DrawOverlay/PenOverlay result. */
export interface LocalDrawPayload {
  tag: string;
  classes: string;
  textContent: string;
  /**
   * Scanned key under the draw (findInsertionTarget's deepest container) —
   * null when the draw landed on empty canvas. May also name a DOM-only
   * layout <slot> key that is absent from the scan → treated as empty canvas.
   */
  parentKey: string | null;
  /** Where it was drawn among parentKey's children; absent (AI tool) = the container's end. */
  insertIndex?: number;
  staticMarkup?: string;
  /** Pen anchors — NOT materialized; only the derived staticMarkup lands in the file. */
  penPath?: string;
}

export interface LocalDrawArgs {
  draw: LocalDrawPayload;
  /** true when the draw came from the slot/blog tool. */
  isSlotDraw: boolean;
  scannedElements: ScannedElement[];
  /** Project-relative file backing the current page (Editor's currentPageFile). */
  pageFile: string | null;
  /** task-133 Task 8: UndoContext's pushStructuralUndo — pushed ONLY on a successful write. */
  pushUndo?: PushStructuralUndo;
}

/**
 * Serialize the just-drawn payload and insert it into the real file.
 * Placement: element under the draw is the target (container → at the drawn
 * slot among its children, else inside-end; void → after); empty canvas →
 * resolveInsertTarget's page-anchor fallback.
 * On success the new element is selected after the HMR rescan via the
 * pending-selection singleton (exact line). Returns {ok:true} only on a real
 * write; failures carry the reason (task-133 Task 9: the AI tool relays it —
 * UI callers ignore the return and rely on the toasts).
 */
export async function insertLocalDrawnElement(
  { draw, isSlotDraw, scannedElements, pageFile, pushUndo }: LocalDrawArgs,
  writer = viteStructuralWriter,
): Promise<LocalStructuralResult> {
  if (isSlotDraw) {
    // Blog/slot elements are built-in machinery (BlogSlot master, bindings,
    // posts wrapper) that doesn't exist in the user's own project.
    toast('Blog/slot sections are not supported in local mode yet');
    return { ok: false, reason: 'Blog/slot sections are not supported in local mode yet' };
  }
  // Wrong-file-write guard: a draw resolved against the previous page's scan
  // writes the wrong real file. Owner 2026-11-10 ("it must just SWITCH"): a
  // draw made while the page switches lands on the switched-to page, against
  // its own scan, once that lands; the element under the draw was the
  // outgoing page's, so that page's anchor takes it.
  if (!isLocalPageInSync()) {
    return afterLocalPageArrives((page) => insertLocalDrawnElement(
      { draw: { ...draw, parentKey: null }, isSlotDraw, scannedElements: page.scanned, pageFile: page.pageFile, pushUndo }, writer,
    ), { ok: false, reason: LOCAL_PAGE_NOT_LOADED_REASON });
  }
  if (!pageFile) {
    toast('This page has no source file yet — drawing needs a real page file');
    return { ok: false, reason: 'this page has no source file yet — drawing needs a real page file' };
  }
  // Captured before the wait: the draw lands on the page it was drawn on.
  const origin = captureLocalWriteOrigin();
  const selectionEpoch = getSelectionEpoch();
  await acquireStructuralWrite();
  try {
    const dropTarget = draw.parentKey
      ? scannedElements.find((e) => e.key === draw.parentKey) ?? null
      : null;

    const target = resolveInsertTarget(dropTarget, scannedElements, pageFile);
    if ('error' in target) {
      const reason =
        target.error === 'component-instance'
          ? "loop copies / component internals can't take draws — target a page element"
          : "the page isn't scanned yet — wait for the preview to load";
      toast(
        target.error === 'component-instance'
          ? "Loop copies / component internals can't take draws — draw over a page element"
          : "Page isn't ready yet — wait for the preview to load",
      );
      return { ok: false, reason };
    }
    // Drawn INTO a container: land at the drawn slot, beside the nearest
    // anchorable sibling (the reparent-drop rule), not at the container's end.
    if (dropTarget?.sourceLocation && draw.insertIndex !== undefined && 'loc' in target && target.position === 'inside-end') {
      const byKey = new Map(scannedElements.map((e) => [e.key, e]));
      const slot = planLocalReparentInsert(dropTarget.key, scannedElements.filter((e) => e.parentKey === dropTarget.key).map((e) => e.key), draw.insertIndex);
      // A rendered component's anchor is its `<Card />` tag; the anchor must share the container's file.
      const loc = slot && (resolveLocalUsageTarget(slot.targetKey, byKey, pageFile) ?? byKey.get(slot.targetKey)?.sourceLocation);
      if (slot && loc?.file === target.loc.file) { target.loc = loc; target.position = slot.position; }
    }

    // THE write-scope law (utils/localWriteScope.ts): drawing ONTO an element
    // that belongs to a shared component resolves the target to that
    // component's file — the drawn box would appear on every page using it,
    // from a gesture the user made on one page. Refused before any write; the
    // toast offers the component view, where the same draw is same-file and
    // proceeds.
    const drawTargetFile = 'pageBody' in target ? pageFile : target.loc.file;
    if (classifyStructuralTarget(drawTargetFile, pageFile) === 'cross-file') {
      notifyLocalCrossFileWrite(drawTargetFile);
      return { ok: false, reason: localCrossFileReason(drawTargetFile) };
    }

    // Root-level promotion parity with WC (commands.ts ADD_DRAWN_ELEMENT):
    // no source-backed element under the draw → the markup lands at the page
    // anchor, so a plain <div> frame becomes a <section>.
    const rootLevel = !dropTarget?.sourceLocation;
    const tag = draw.tag === 'div' && rootLevel ? 'section' : draw.tag;
    const markup = serializeDrawnPayload({
      tag,
      classes: draw.classes,
      textContent: draw.textContent,
      staticMarkup: draw.staticMarkup,
    });

    // Fix 1 (task-148): a component-only page has no scanned node keyed to the
    // page file — the anchor is resolved server-side from the file itself.
    const pageBody = 'pageBody' in target;
    let res: Awaited<ReturnType<typeof writer.writeInsert>>;
    try {
      res = pageBody
        ? await writer.writeAppendPage(pageFile, markup, origin)
        : await writer.writeInsert(target.loc, markup, target.position, origin);
    } catch (err) {
      console.error('Adding shape failed:', err);
      const detail = sourceActionFailure('draw', err);
      toast.error(detail);
      return { ok: false, reason: detail };
    }
    if (!res || !res.success) {
      console.error('Adding shape was not confirmed:', res);
      toast.error(sourceActionFailure('draw'));
      return { ok: false, reason: sourceActionFailure('draw') };
    }

    // task-133 Task 8 + live-smoke Critical: inverse = ONE byte-exact region
    // restore of the splice (a mid-line splice into a single-line container
    // splits its closing tag; remove-at-insertedLine never rejoined it).
    pushUndo?.({
      origin,
      structuralOp: {
        sourceFiles: res.sourceFiles,
        forward: [
          'pageBody' in target
            ? { kind: 'append-page' as const, pageFile, markup }
            : { kind: 'insert' as const, loc: target.loc, markup, position: target.position },
        ],
        inverse: [
          insertRegionInverseOp(res)
            // allowRootRemoval: an inverse remove undoes OUR OWN insert —
            // the file goes back to a state it held moments ago.
            ?? { kind: 'remove', loc: { file: res.file, line: res.insertedLine, column: 1 }, allowRootRemoval: true },
        ],
      },
    });
    setLocalPendingSelection(res.file, res.insertedLine, selectionEpoch);
    return { ok: true, file: res.file, insertedLine: res.insertedLine };
  } finally {
    releaseStructuralWrite();
  }
}
