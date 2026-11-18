import type * as Y from 'yjs';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import type { StructuralOp } from '@/store/structuralUndo';
import { structuralFile } from './structuralTransform';
import { acceptFileChanges, finishAcceptedFiles } from './fileAcceptance';
import { prepareSourceGesture } from './sourceGesture';

/** Source-only edits use the same project acceptance lane as document edits. */
/** `origin`: the surface the gesture was made on, when it waited for its write
 *  turn while the user moved on (default: the current surface). */
export async function acceptStructuralOperations(operations: StructuralOp[], options: { doc?: Y.Doc; masterWrite?: boolean; origin?: LocalWriteOrigin } = {}) {
  const projectId = options.doc?.getMap('meta').get('projectId') as string | undefined ?? getActiveSaveProjectId();
  if (!projectId) throw new Error('Project storage is not ready');
  const origin = options.origin ?? captureLocalWriteOrigin();
  const frozen = structuredClone(operations);
  for (const op of frozen) if (!options.masterWrite && isCrossFileAtOrigin(origin, structuralFile(op))) {
    throw new Error('Structural edits cannot change another surface file');
  }
  const results: Array<Record<string, unknown>> = [];
  // Only the explicitly requested import files gain project-wide scope;
  // the gesture cannot reuse this authorization for element transforms.
  const masterImportFiles = options.masterWrite ? frozen.filter(op => op.kind === 'import').map(structuralFile) : [];
  const gesture = prepareSourceGesture(projectId, masterImportFiles, origin);
    const accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
      for (const op of frozen) {
        if (op.kind === 'insert' || op.kind === 'remove') op.loc = await gesture.resolve(op.loc);
        else if (op.kind === 'move') { op.from = await gesture.resolve(op.from); op.to = await gesture.resolve(op.to); }
        results.push(await gesture.apply(op));
      }
      return [...gesture.files.values()];
    }, options.doc);
    for (const result of results) result.sourceFiles = accepted.files;
    void finishAcceptedFiles(accepted);
    return results;
}
