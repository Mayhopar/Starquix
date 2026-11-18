/**
 * THE one in-flight guard for local-mode structural file writes (task-133).
 * Every path that issues a structural write to the user's real files —
 * delete/move (localStructuralOps), ⌘K component insert (localComponentInsert),
 * canvas draw (localDrawInsert), AI tools (commandTools), and undo/redo replay
 * (UndoContext) — must acquire this before writing. Never create a second flag.
 *
 * SEQUENCING RULE (binding): one structural write per gesture; callers must
 * never issue overlapping writes to the same file — a second write computed
 * against pre-HMR line numbers resolves the SAME stale file:line to whichever
 * sibling moved into it (successive-sibling corruption).
 *
 * This module is SIDE-EFFECT FREE (pure + testable). Gestures never get a
 * refusal: they await acquireStructuralWrite() and run in arrival order
 * (2026-11-10; task-148's "Still saving the last change" toast and Undo's
 * "busy" copy are gone). Only automatic background work uses the try form.
 *
 * Lives in store/ (not components/) so context-layer consumers (UndoContext)
 * don't import from the components layer.
 */
let structuralWriteInFlight = false;
/** Gestures waiting their turn, first come first served. */
const turns: Array<() => void> = [];

/**
 * Automatic background work only (DesignBar's quiet upgrades): false when a
 * write is in flight or a gesture is waiting — skip, the next scan retries.
 * On true the caller MUST release() in a finally.
 */
export function tryAcquireStructuralWrite(): boolean {
  if (structuralWriteInFlight) return false;
  structuralWriteInFlight = true;
  return true;
}

/**
 * A user's gesture (or the AI's, or Undo/Redo): resolves when it is this
 * gesture's turn — never refused (owner 2026-11-10: "there should be no
 * refusals … nothing should be lost"). Safe for a gesture captured against an
 * older scan: every write projects its coordinates through the accepted
 * identity maps (sourceGesture.resolve). The caller MUST release() in a finally.
 */
export function acquireStructuralWrite(): Promise<void> {
  if (!structuralWriteInFlight) {
    structuralWriteInFlight = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => turns.push(resolve));
}

export function releaseStructuralWrite(): void {
  const next = turns.shift();
  if (next) next(); // handed straight on: a background try never jumps the queue
  else structuralWriteInFlight = false;
}

/** Test-only: the in-flight tests leave a write pending on purpose. */
export function _resetStructuralWriteInFlightForTests(): void {
  structuralWriteInFlight = false;
  turns.length = 0;
}
