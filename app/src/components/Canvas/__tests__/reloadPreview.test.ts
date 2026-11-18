/**
 * GAP 1 (round-5 recording) — local "Reset to master" discarded the override
 * everywhere the user could look (doc, localStorage, DesignBar header) and the
 * canvas still repainted the discarded value after the reload. A SECOND,
 * hand-dispatched reload cleared it instantly.
 *
 * The racing re-apply is NOT the doc one. `reapplySourceClassOverrides` reads
 * the doc live and the doc is already empty by then. It is ViewportFrame's
 * legacy retry queues:
 *
 *   1. ViewportFrame.tsx (SYNC_CLASSES_TO_IFRAME handler) files EVERY class
 *      edit into `pendingKeyUpdatesRef` (by the full element key) —
 *      unconditionally, whether or not the iframe applied it. (task-181 removed
 *      a second, `file:line`-keyed map that sat beside it.)
 *   2. Nothing drains them until the next ELEMENTS_SCANNED. A class-only edit
 *      never produces one: in local mode an override-tier edit writes no file
 *      (so no HMR), and the bridge's MutationObserver only rescans on a
 *      relevant ADDED node or an img[src] change — a `class` attribute
 *      mutation is explicitly not a rescan trigger
 *      (`bridge/parts/scanning.ts` startMutationObserver).
 *   3. Reset clears the doc and re-navigates the iframe. The reload's scan is
 *      therefore the FIRST scan since the edit — so `handleElementsScanned`
 *      replays the queued payloads as UPDATE_CLASSES (before it even gets to
 *      the doc re-apply), painting the discarded value back, and only THEN
 *      clears the queues. Hence: wrong after the first reload, right after the
 *      second.
 *
 * So the queues must be invalidated by the same action that discarded their
 * contents. `reloadPreviewFromSource` is that ordering, in one place.
 */
import { describe, it, expect, vi } from 'vitest';
import { reloadPreviewFromSource } from '../reloadPreview';
import { handleElementsScanned } from '../viewportMessages/scanning';
import { makeFakeCtx, makeFakeIframe } from '../viewportMessages/__tests__/fakeContext';

const KEY = 'src/components/Header.astro:12:3~p5e23e503da89f633';
const DISCARDED = 'text-2xl font-bold text-red-500';
const FROM_FILE = 'text-2xl font-bold text-stone-800';

/** The element as the RELOADED iframe reports it — bare master output. */
const scanned = {
  key: KEY,
  parentKey: null,
  tagName: 'h2',
  classes: FROM_FILE,
  rect: { top: 0, left: 0, width: 10, height: 10 },
  sourceLocation: { file: 'src/components/Header.astro', line: 12, column: 3 },
};

/** The queued edit the user then discarded with Reset. */
function queues() {
  return {
    pendingKeyUpdates: new Map([[KEY, { key: KEY, classes: DISCARDED }]]),
  };
}

const repaintedDiscarded = (postMessage: ReturnType<typeof vi.fn>) =>
  postMessage.mock.calls.some(
    ([msg]) => msg?.type === 'UPDATE_CLASSES' && msg.payload?.classes === DISCARDED,
  );

describe('reloadPreviewFromSource — Reset must be visible to the scan that follows it', () => {
  it('the stale queue IS what repaints a discarded value (the defect, reproduced)', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const q = queues();
    const ctx = makeFakeCtx({
      refs: {
        iframe,
        pendingKeyUpdates: { current: q.pendingKeyUpdates },
      },
    });

    // The doc carries NO override (Reset cleared it) — and it still repaints.
    handleElementsScanned(ctx, { elements: [scanned] });

    expect(repaintedDiscarded(postMessage)).toBe(true);
  });

  it('after a reload-from-source the next scan repaints nothing', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const q = queues();

    reloadPreviewFromSource({
      iframe: iframe.current,
      pendingKeyUpdates: q.pendingKeyUpdates,
    });

    const ctx = makeFakeCtx({
      refs: {
        iframe,
        pendingKeyUpdates: { current: q.pendingKeyUpdates },
      },
    });
    handleElementsScanned(ctx, { elements: [scanned] });

    expect(repaintedDiscarded(postMessage)).toBe(false);
  });

  it('asks the bridge to re-render in place — clears the queue first, never navigates (seamless 2.6)', () => {
    const setAttribute = vi.fn();
    const q = queues();
    let queueAtPost = -1;
    const postMessage = vi.fn(() => { queueAtPost = q.pendingKeyUpdates.size; });
    const el = { src: 'http://localhost:5199/about', setAttribute, contentWindow: { postMessage } } as unknown as HTMLIFrameElement;

    reloadPreviewFromSource({ iframe: el, pendingKeyUpdates: q.pendingKeyUpdates });

    expect(postMessage).toHaveBeenCalledWith({ type: 'REFRESH_FROM_SOURCE' }, '*');
    expect(queueAtPost).toBe(0);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('clears the queue even with no iframe (order must not depend on the frame)', () => {
    const q = queues();
    reloadPreviewFromSource({
      iframe: null,
      pendingKeyUpdates: q.pendingKeyUpdates,
    });
    expect(q.pendingKeyUpdates.size).toBe(0);
  });
});
