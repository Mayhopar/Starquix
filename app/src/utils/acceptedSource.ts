// Whole-file and position-based local edits that wait their write turn
// (store/structuralWriteGuard) run right behind other writes: these two keep
// them on what was ACCEPTED, never an older disk copy or scan position.
import type { SourceLocation } from '@/core/state/types';

/**
 * Disk catches up with every accepted write before a whole-file edit reads it
 * (owner 2026-11-10: edits wait their turn instead of being refused, so a
 * whole-file edit can run right behind another write; reading a disk copy that
 * write had not reached yet would put the old bytes back) — the direct-write
 * rule settleSourceWrites already keeps. Never throws.
 */
export async function settleAcceptedWrites(): Promise<void> {
  const [{ getActiveSaveProjectId }, { settleSourceWrites }] = await Promise.all([
    import('@/services/pendingProjectMutations'), import('@/services/durableEdits/sourceMaterialization')]);
  await settleSourceWrites(getActiveSaveProjectId());
}

/**
 * Where an element captured from an earlier scan is NOW, through every edit
 * accepted since (the same projection structural writes use). null: the
 * element is gone — the edit has nothing to act on.
 */
export async function currentSourceLocation(loc: SourceLocation): Promise<SourceLocation | null> {
  const { getActiveSaveProjectId } = await import('@/services/pendingProjectMutations');
  const projectId = getActiveSaveProjectId();
  if (!projectId) return loc;
  const { prepareSourceGesture } = await import('@/services/durableEdits/sourceGesture');
  try { return { ...loc, ...await prepareSourceGesture(projectId).resolve(loc) }; } catch { return null; }
}
