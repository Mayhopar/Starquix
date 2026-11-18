import * as Y from 'yjs';

/**
 * Pure diff for drawn-element observer sync.
 *
 * Walks the Yjs `elements` map, finds entries flagged `isDrawn` for the active
 * page, and diffs them against the previous tick's snapshot. Used by the
 * observer in ViewportFrame to emit INSERT_DRAWN_ELEMENT / REMOVE_DRAWN_ELEMENT
 * messages.
 *
 * Extracted so the coalescer (see `createDrawnElementSyncCoalescer`) can be
 * unit-tested without spinning up a full ViewportFrame + iframe.
 */
export function computeDrawnElementDiff(
  prevDrawnKeys: ReadonlySet<string>,
  elementsMap: Y.Map<unknown>,
  currentPageId: string,
  /** Previous tick's staticMarkup snapshot — enables in-place change detection (task-107). */
  prevMarkup?: ReadonlyMap<string, string>,
): { added: string[]; removed: string[]; changed: string[]; currentKeys: Set<string>; currentMarkup: Map<string, string> } {
  const currentKeys = new Set<string>();
  const currentMarkup = new Map<string, string>();
  elementsMap.forEach((value, key) => {
    const yEl = value as Y.Map<unknown>;
    if (yEl.get('isDrawn') && (yEl.get('pageId') as string) === currentPageId) {
      currentKeys.add(key);
      const markup = yEl.get('staticMarkup') as string | undefined;
      if (markup) currentMarkup.set(key, markup);
    }
  });

  const added: string[] = [];
  for (const key of currentKeys) {
    if (!prevDrawnKeys.has(key)) added.push(key);
  }

  const removed: string[] = [];
  for (const key of prevDrawnKeys) {
    if (!currentKeys.has(key)) removed.push(key);
  }

  // In-place staticMarkup edits (pen node edits, their undo/redo) — the key-set
  // diff can't see them; surviving keys with different markup must re-send.
  const changed: string[] = [];
  for (const [key, markup] of currentMarkup) {
    if (prevDrawnKeys.has(key) && prevMarkup && prevMarkup.get(key) !== markup) {
      changed.push(key);
    }
  }

  return { added, removed, changed, currentKeys, currentMarkup };
}

/**
 * Microtask-coalesced wrapper around a sync function.
 *
 * Yjs `observeDeep` fires once per transaction. When drawn elements are added
 * via N separate transactions in quick succession (e.g. unwrapped batch
 * additions, or restore paths that don't wrap in `doc.transact`), the observer
 * fires N times — each firing walks the entire `elements` map, calls
 * `selectPageDrawnElements` (another full doc walk), and emits postMessages
 * synchronously. The bridge then queues N `setTimeout(scan, 50)` calls.
 *
 * scanThen / reportContentHeight are already coalesced inside bridge.js, so a
 * 30-element burst inside ONE transaction is already O(1) scans + O(N)
 * postMessages. But N transactions still means N observer walks on the parent
 * side.
 *
 * This coalescer collapses multiple observer firings within the same tick into
 * a single deferred call, so the diff walk happens once per microtask flush.
 *
 * The number of INSERT_DRAWN_ELEMENT postMessages itself is unchanged (one per
 * added element) — making it a single batched message would require a new
 * INSERT_DRAWN_ELEMENTS protocol entry on bridge.js + a snapshot rebuild. The
 * coalescer is the bridge-protocol-safe portion of that optimization.
 */
export function createMicrotaskCoalescer(
  fn: () => void,
  scheduler: (cb: () => void) => void = queueMicrotask,
): { trigger: () => void; flushSync: () => void; isPending: () => boolean } {
  let scheduled = false;
  return {
    trigger() {
      if (scheduled) return;
      scheduled = true;
      scheduler(() => {
        scheduled = false;
        fn();
      });
    },
    flushSync() {
      if (!scheduled) return;
      scheduled = false;
      fn();
    },
    isPending() {
      return scheduled;
    },
  };
}
