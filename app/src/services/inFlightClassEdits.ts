/**
 * Class edits that were CALLED but have not finished (instant-edit P1). Undo pressed while an edit is still in
 * flight must undo THAT edit: the press first waits for the edits already in flight (not for later ones), then reads
 * its stacks. Without the wait the stack top is the previous step and the replay fails with "Undo source baseline
 * changed". A module util, not a context: UndoContext is a parent of the ClassStore provider.
 */
const inFlight = new Map<string, Set<Promise<unknown>>>();

export function trackClassEdit<T>(projectId: string | null | undefined, edit: Promise<T>): Promise<T> {
  if (!projectId) return edit;
  let set = inFlight.get(projectId);
  if (!set) inFlight.set(projectId, set = new Set());
  set.add(edit);
  const done = () => { set!.delete(edit); if (!set!.size && inFlight.get(projectId) === set) inFlight.delete(projectId); };
  void edit.then(done, done);
  return edit;
}

/** Synchronous check: nothing to wait for, so a press can start in the same tick as before. */
export function hasClassEditsInFlight(projectId: string | null | undefined): boolean {
  return !!projectId && (inFlight.get(projectId)?.size ?? 0) > 0;
}

/** Resolves when every class edit called BEFORE now has finished (accepted + its undo step recorded, or rejected). */
export async function awaitClassEditsInFlight(projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const now = [...inFlight.get(projectId) ?? []];
  if (now.length) await Promise.allSettled(now);
}
