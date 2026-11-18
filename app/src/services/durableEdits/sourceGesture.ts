import type { StructuralOp } from '@/store/structuralUndo';
import type { DurableFileChange } from './types';
import { readProjectedSourceState } from './projectedSource';
import { applyStructuralTransform, structuralFile } from './structuralTransform';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { stripStamps } from '@/utils/stampAttr';
import { assertSourceLocationVersion, projectCoordinate, resolveProjectedSourceLocation, structuralIdentityMap } from './sourceIdentity';
import type { SourceLocation } from '@/bridge';
import { getLocalSourceScanRevision } from '@/utils/localPageSync';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';

/** Read-only, sequential virtual source. Dependent coordinates see earlier
 * transforms, but no file is changed until the complete gesture is accepted. */
/** `origin`: the surface the gesture was made on — a caller that awaits before
 *  preparing passes the one it captured, so a page switch meanwhile never
 *  re-scopes it. */
export function prepareSourceGesture(projectId: string, masterImportFiles: string[] = [], origin: LocalWriteOrigin = captureLocalWriteOrigin()) {
  const authorizedImports = new Set(masterImportFiles);
  const files = new Map<string, DurableFileChange>();
  // 2026-09-16: no surface/project GENERATION check here — it fired on every
  // StrictMode remount and route re-arm ('Source gesture owner changed' at
  // every boot) and refused the user's edit. Acceptance is by source version.
  const assertOwner = () => {
    const active = getActiveSaveProjectId();
    if (active !== null && active !== projectId) throw new Error('Another project is active');
  };
  const load = async (file: string) => {
    assertOwner();
    if (!files.has(file)) {
      const source = await readProjectedSourceState(projectId, file);
      assertOwner();
      files.set(file, { file, beforeSource: source, afterSource: source });
    }
    return files.get(file)!;
  };
  return {
    files,
    async resolve(loc: SourceLocation): Promise<SourceLocation> {
      const accepted = await resolveProjectedSourceLocation(projectId, loc, getLocalSourceScanRevision());
      const change = await load(loc.file);
      assertSourceLocationVersion(accepted, change.beforeSource);
      const mapped = projectCoordinate(accepted, files.get(loc.file)?.identityMaps ?? []);
      if (!mapped) throw new Error('Source element has been deleted');
      return mapped;
    },
    async apply(input: StructuralOp): Promise<Record<string, unknown> & { success: true; file: string }> {
      assertOwner();
      const op = structuredClone(input);
      const file = structuralFile(op);
      if (isCrossFileAtOrigin(origin, file) && !(op.kind === 'import' && authorizedImports.has(file))) throw new Error('Structural edits cannot change another surface file');
      if (op.kind === 'insert' || op.kind === 'append-page') op.markup = stripStamps(op.markup);
      const change = await load(file);
      if (change.afterSource === null) throw new Error('Structural source does not exist');
      const before = change.afterSource;
      if ('loc' in op) assertSourceLocationVersion(op.loc, before);
      else if (op.kind === 'move') {
        assertSourceLocationVersion(op.from, before); assertSourceLocationVersion(op.to, before);
      }
      const { content, ...result } = applyStructuralTransform(before, op);
      (change.identityMaps ??= []).push(structuralIdentityMap(before, content, op, result));
      change.afterSource = content;
      return { success: true, file, ...result };
    },
  };
}
