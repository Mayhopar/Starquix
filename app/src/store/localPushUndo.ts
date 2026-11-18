import type * as Y from 'yjs';
import type { useUndoContext } from '@/context/UndoContext';
import { localOverridesForPlacement, pushFileValueUndo, pushLocalOverridesToMaster, readLocalPushFiles, type LocalPushResult } from './localMasterOverrides';
import { selectProjectId } from './selectors';

/**
 * A Push that ONE ⌘Z takes back: the master file's pre-push bytes + the overrides, one step. The DesignBar Push and
 * the AI's push_instance_to_source both run this (parity: one code path). The accepted before/after source is captured
 * even while the runtime is still materializing it; the file half is replayed by undo's file batch, the doc half is
 * the snapshot of the overrides. `onPushed` sees the result before the undo is prepared.
 */
export async function pushLocalOverridesUndoable(
  doc: Y.Doc,
  file: string,
  placement: string | undefined,
  undo: { takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot']; claimSnapshot?: ReturnType<typeof useUndoContext>['claimSnapshot'] },
  onPushed?: (result: LocalPushResult) => void,
): Promise<LocalPushResult> {
  const entries = localOverridesForPlacement(doc, file, placement);
  const projectId = selectProjectId(doc);
  const pushedFiles = [...new Set(entries.map(e => e.sourceLocation.file))];
  const fileValues = pushFileValueUndo(doc, entries);
  undo.takeSnapshot({ reverse: fileValues.reverse, forward: fileValues.forward });
  const claim = undo.claimSnapshot?.();
  const filesBefore = await readLocalPushFiles(projectId, pushedFiles);
  const result = await pushLocalOverridesToMaster(doc, file, placement);
  onPushed?.(result);
  if (result.pushed > 0 && claim) {
    fileValues.setLanded(result.landedKeys);
    const filesAfter = await readLocalPushFiles(projectId, pushedFiles);
    const changes = pushedFiles.flatMap((pushed, i) => {
      const beforeSource = filesBefore[i], afterSource = filesAfter[i];
      return typeof beforeSource !== 'string' || typeof afterSource !== 'string' || beforeSource === afterSource ? [] : [{ file: pushed, beforeSource, afterSource }];
    });
    // …and the page props Push dropped (utils/propOverrides.ts).
    const undoFiles = [...changes, ...result.droppedFiles];
    if (undoFiles.length) claim.attachFiles?.(undoFiles);
    claim.commit();
  }
  return result;
}
