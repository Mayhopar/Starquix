import type * as Y from 'yjs';
import type { MutationSnapshot } from '@/store/documentMutation';
import type { ImageAttributes } from '@/store/types';
import type { DurableFileChange, MaterializationCommand } from './types';
import type { SourceLocation } from '@/bridge';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, allowsCrossFileOverrideWrite, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { updateImageAttribute } from '@/vite-plugin/ast-updater';
import { createSourceIdentityMap } from '@/vite-plugin/source-transform-identity';
import { acceptFileChanges, finishAcceptedFiles } from './fileAcceptance';
import { prepareSourceGesture } from './sourceGesture';

export interface SourceImageChange {
  location: SourceLocation;
  attribute: keyof ImageAttributes | 'data-sq-media';
  value: string;
}

/** Shared source preparation for a single UI edit or a compound generated image.
 * Invoke the returned read-only plan inside the projected acceptance lane. */
export function prepareSourceImageChanges(projectId: string, input: SourceImageChange[],
  masterWrite = false, origin: LocalWriteOrigin = captureLocalWriteOrigin()): () => Promise<DurableFileChange[]> {
  const changes = structuredClone(input);
  const gesture = prepareSourceGesture(projectId);
  return async () => {
    for (const { location, attribute, value } of changes) {
      if (attribute === 'loading' && value && !['lazy', 'eager'].includes(value)) throw new Error('Invalid image loading value');
      if (!masterWrite && isCrossFileAtOrigin(origin, location.file) && !allowsCrossFileOverrideWrite(origin, location.file)) {
        throw new Error('Image source belongs to another surface');
      }
      const loc = await gesture.resolve(location);
      const change = gesture.files.get(loc.file)!;
      if (change.afterSource === null) throw new Error('Image source does not exist');
      change.afterSource = await updateImageAttribute(change.afterSource, loc.file, loc, attribute, value,
        (before, after, spans) => { (change.identityMaps ??= []).push(createSourceIdentityMap(before, after, spans)); });
    }
    return [...gesture.files.values()];
  };
}

/** Image attributes share the durable source identity boundary with text and
 * structure. Uploading/reference atomicity remains owned by the asset path. */
export async function acceptSourceImageAttribute(projectId: string, location: SourceLocation,
  attribute: keyof ImageAttributes | 'data-sq-media', value: string,
  masterWrite = false, origin: LocalWriteOrigin = captureLocalWriteOrigin(),
  publication?: { doc: Y.Doc; mutate(staged: Y.Doc): void; snapshot?: MutationSnapshot;
    operationId?: string; commands?: MaterializationCommand[]; background?: boolean }) {
  const accepted = await acceptFileChanges(`wc://${projectId}`,
    prepareSourceImageChanges(projectId, [{ location, attribute, value }], masterWrite, origin),
    publication?.doc, publication?.mutate, publication?.snapshot, publication);
  void finishAcceptedFiles(accepted);
  return accepted;
}
