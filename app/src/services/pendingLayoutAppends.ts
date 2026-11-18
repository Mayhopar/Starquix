/** The journal owns deferred layout/master intent. Leaving a surface only
 * expedites its already accepted revision; no append thunk owns project data. */
import { useEffect } from 'react';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { awaitAccepted } from './durableEdits/acceptance';
import { listPendingRows } from './durableEdits/store';
import { flushDurableSourceWritesThrough } from './durableEdits/sourceMaterialization';

export async function flushLayoutAppends(projectId = getActiveSaveProjectId()): Promise<number> {
  if (!projectId) return 0;
  const revision = await awaitAccepted(projectId);
  const rows = await listPendingRows(projectId);
  const count = rows.filter(row => row.revision <= revision).flatMap(row => row.commands)
    .filter(command => command.kind === 'layout-append' || command.kind === 'source-batch' && command.payload.deferUntil).length;
  if (count) await flushDurableSourceWritesThrough(projectId, revision);
  return count;
}
/** Compatibility coordinator has no memory-owned append work to save. */
export function pendingLayoutAppendCount(): number { return 0; }

export function useDrainLayoutAppendsOnUnmount(): void {
  useEffect(() => {
    const projectId = getActiveSaveProjectId();
    return () => { void flushLayoutAppends(projectId).catch(() => {}); };
  }, []);
}
