import type { MaterializationCommand, DurableFileChange } from './types';
import { acceptedIdentityMaps, assertSourceLocationVersion, attributeIdentityMap, projectCoordinate, resolveProjectedSourceLocation } from './sourceIdentity';
import { hasProjectedSource, readProjectedSourceState, withProjectedSource } from './projectedSource';
import { updateClassAttribute } from '@/vite-plugin/ast-updater';
import { updateTextContent } from '@/vite-plugin/ast-updater';
import { createSourceIdentityMap } from '@/vite-plugin/source-transform-identity';
import { prepareWriteBackFiles } from './commandReceipts';
import { isCrossFileAtOrigin, allowsCrossFileOverrideWrite } from '@/utils/localWriteScope';
import { pm } from '@/utils/probeMark';
// @ts-expect-error shared browser-safe production expression guard
import { updateTextContent as validateTextContent } from '../../../../preview-template/src/plugins/sq-source-transforms.js';

/** Freeze real editor class intents in the acceptance lane. Old compatibility
 * commands without scan ownership retain their existing deferred preparation. */
export async function prepareClassIdentities(projectId: string, revision: number, commands: MaterializationCommand[], force = false): Promise<void> {
  const owned = new Set<string>();
  for (const command of commands) if (command.kind === 'class-write' && (force || command.payload.sourceLocation.sourceVersion || (await acceptedIdentityMaps(projectId, command.payload.sourceLocation.file)).length)) owned.add(command.payload.sourceLocation.file);
  for (const command of commands) if (command.kind === 'source-batch') {
    for (const edit of command.payload.sourceTextEdits ?? []) owned.add(edit.sourceLocation.file);
  }
  if (!owned.size && !commands.some(command => command.kind === 'source-batch')) return;
  const run = async () => {
    const files = new Map<string, DurableFileChange>();
    const read = async (file: string) => files.has(file) ? files.get(file)!.afterSource : readProjectedSourceState(projectId, file);
    const retain = (changes: DurableFileChange[]) => {
      for (const change of changes) files.set(change.file, { ...change,
        beforeSource: files.has(change.file) ? files.get(change.file)!.beforeSource : change.beforeSource,
        identityMaps: [...files.get(change.file)?.identityMaps ?? [], ...change.identityMaps ?? []] });
    };
    for (const command of commands) {
      if (command.kind === 'file-batch') { retain(command.payload.files); continue; }
      if ('preparedFiles' in command.payload && command.payload.preparedFiles) { retain(command.payload.preparedFiles); continue; }
      if (command.kind === 'source-batch') {
        if (command.payload.preparedFiles) { retain(command.payload.preparedFiles); continue; }
        const changes: DurableFileChange[] = [];
        for (const edit of command.payload.sourceTextEdits ?? []) {
          const file = edit.sourceLocation.file;
          if (!edit.masterWrite && isCrossFileAtOrigin(edit.origin, file) && !allowsCrossFileOverrideWrite(edit.origin, file)) throw new Error('Text source belongs to another surface');
          const before = await read(file);
          if (before === null) throw new Error('Text source does not exist');
          const accepted = await resolveProjectedSourceLocation(projectId, edit.sourceLocation, edit.sourceLocation.sourceRevision ?? 0, revision);
          const loc = projectCoordinate(accepted, files.get(file)?.identityMaps ?? []);
          if (!loc) throw new Error('Text source element has been deleted');
          assertSourceLocationVersion(loc, before);
          await validateTextContent(before, loc, edit.text);
          const identityMaps: NonNullable<DurableFileChange['identityMaps']> = [];
          const after = await updateTextContent(before, file, loc, edit.text,
            (old, next, spans) => identityMaps.push(createSourceIdentityMap(old, next, spans)));
          const change = { file, beforeSource: before, afterSource: after, identityMaps };
          changes.push(change); retain([change]);
        }
        const prepared = await prepareWriteBackFiles(projectId, command.payload, read, files);
        changes.push(...prepared.files); retain(prepared.files);
        const combined = new Map<string, DurableFileChange>();
        for (const change of changes) {
          const prior = combined.get(change.file);
          combined.set(change.file, prior ? { ...change, beforeSource: prior.beforeSource,
            identityMaps: [...prior.identityMaps ?? [], ...change.identityMaps ?? []] } : change);
        }
        command.payload.preparedFiles = [...combined.values()];
        command.payload.preparedSkipped = prepared.skipped;
        command.payload.preparedAppliedTotal = prepared.appliedTotal + (command.payload.sourceTextEdits?.length ?? 0);
        continue;
      }
      if (command.kind !== 'class-write' || command.payload.preparedFiles) continue;
      const p = command.payload, file = p.sourceLocation.file;
      if (!owned.has(file)) continue;
      pm('pci:cmd');
      const before = await read(file);
      pm('pci:read', () => ({ bytes: before?.length }));
      if (before === null) throw new Error('Class source does not exist');
      const accepted = await resolveProjectedSourceLocation(projectId, p.sourceLocation, p.sourceRevision ?? 0, revision);
      pm('pci:resolved');
      const loc = projectCoordinate(accepted, files.get(file)?.identityMaps ?? []);
      if (!loc) throw new Error('Class source element has been deleted');
      assertSourceLocationVersion(loc, before);
      const after = await updateClassAttribute(before, file, loc, p.newClasses, p.baseClasses ?? undefined);
      pm('pci:updated');
      const change = { file, beforeSource: before, afterSource: after, identityMaps: [attributeIdentityMap(before, after)] };
      p.preparedFiles = [change];
      retain([change]);
    }
  };
  if (hasProjectedSource(projectId)) await run();
  else await withProjectedSource(projectId, revision, run);
}
