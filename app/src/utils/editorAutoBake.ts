import * as Y from 'yjs';
import { bakeEditorMaster } from './bakeEditorMaster';

/**
 * Debounced, Yjs-ONLY auto-bake for the component editor (task-098 reload
 * bug): edits used to reach `masters` only via the LEAVE flush
 * (pushAndPropagateChanges), which is gated on React state — a page reload
 * resets that state, so re-opening the component wiped un-baked child
 * overrides (the "card loses its fill on reload" bug).
 *
 * bakeEditorMaster writes only the masters Yjs map (mirrored to IndexedDB by
 * useProjectSync's 400ms saver) — NO .astro write, so eager
 * baking cannot cause the task-078 iframe-reload blink. The .astro mirror
 * stays deferred to the leave flush.
 *
 * flushNow (pagehide / unmount) bakes only when an edit is pending — an idle
 * flush must not churn the masters observer.
 */
export function createDebouncedBake(
  doc: Y.Doc,
  /** LIVE element-id getter, resolved AT BAKE TIME. The editor re-seed is
   *  async (instance read) and replaces the element AFTER the LeftSidebar effect
   *  runs — a captured id goes stale and bakeEditorMaster no-ops silently
   *  (edits became session-only; the "orange reverts to white" bug). */
  resolveId: () => string | null,
  debounceMs = 800,
): { schedule: () => void; flushNow: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const bake = () => {
    const elementId = resolveId();
    if (elementId) bakeEditorMaster(doc, elementId);
  };

  const flushNow = () => {
    if (!timer || disposed) return;
    clearTimeout(timer);
    timer = null;
    bake();
  };

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      bake();
    }, debounceMs);
  };

  const dispose = () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { schedule, flushNow, dispose };
}
