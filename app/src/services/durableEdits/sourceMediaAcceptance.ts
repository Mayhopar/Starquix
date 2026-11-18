import type { SourceLocation } from '@/bridge';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { acceptFileChanges, finishAcceptedFiles } from './fileAcceptance';
import { prepareSourceGesture } from './sourceGesture';
import { createSourceIdentityMap, type PreservedSourceSpan } from '@/vite-plugin/source-transform-identity';
import type { ImageFillRequest, MediaSwapResult } from '@/services/ViteMediaWriter';
// @ts-expect-error shared browser-safe production transform
import { swapElementTagWithUndo } from '../../../../preview-template/src/plugins/sq-source-transforms.js';

/** The transform supplies the identities actually retained by each operation,
 * including unchanged descendants on src-only edits. Exact bytes own undo. */
export async function acceptSourceMedia(projectId: string, location: SourceLocation,
  kind: 'image' | 'video' | 'container' | 'image-fill', src: string, imageFill?: ImageFillRequest,
  origin: LocalWriteOrigin = captureLocalWriteOrigin(), masterWrite = false): Promise<MediaSwapResult> {
  // masterWrite: the Fill-kind conversion of an element another file renders
  // rewrites THAT file on purpose (owner 2026-09-20) — same flag every other
  // tier carries (acceptSourceImageAttribute, structural acceptance).
  if (!masterWrite && isCrossFileAtOrigin(origin, location.file)) throw new Error('Media source belongs to another surface');
  const gesture = prepareSourceGesture(projectId);
  let result!: MediaSwapResult;
  const accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
    const loc = await gesture.resolve(location);
    const change = gesture.files.get(loc.file)!;
    const before = change.afterSource;
    if (before === null) throw new Error('Media source does not exist');
    const { updated, extra } = await swapElementTagWithUndo(before, loc, kind, src, imageFill,
      (old: string, next: string, spans: PreservedSourceSpan[]) => {
        (change.identityMaps ??= []).push(createSourceIdentityMap(old, next, spans));
      });
    change.afterSource = updated;
    result = extra as MediaSwapResult;
    return [...gesture.files.values()];
  });
  result.sourceFiles = accepted.files;
  void finishAcceptedFiles(accepted);
  return result;
}
