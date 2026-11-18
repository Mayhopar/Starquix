import type { SourceLocation } from '@/core/state/index';
import type { LocalWriteOrigin } from '@/utils/localWriteScope';
import type { PushStructuralUndo } from '@/store/structuralUndo';
import { acquireStructuralWrite, releaseStructuralWrite } from '@/store/structuralWriteGuard';
import { viteMediaWriter, type ImageFillRequest, type MediaSwapResult } from './ViteMediaWriter';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { isLocalProjectId } from '@/utils/localMode';

export interface SourceMediaMutation {
  location: SourceLocation;
  kind: 'image' | 'video' | 'container' | 'image-fill';
  src: string;
  imageFill?: ImageFillRequest;
  origin?: LocalWriteOrigin;
  /** The Fill-kind conversion of an element another file renders (a component): an intentional master edit. */
  masterWrite?: boolean;
  /** Captured selection visit/project/surface must still own asynchronous work. */
  isCurrent?: () => boolean;
}

/** Local gestures queue for acceptance; exact source evidence owns Undo before ACK. */
export async function sourceMediaMutation(
  request: SourceMediaMutation,
  pushStructuralUndo: PushStructuralUndo,
  writer: Pick<typeof viteMediaWriter, 'writeTagSwap'> = viteMediaWriter,
): Promise<MediaSwapResult | false> {
  if (request.isCurrent && !request.isCurrent()) throw new Error('The image selection changed. Choose the image again.');
  const projectId = getActiveSaveProjectId();
  const legacyGuard = !projectId || !isLocalProjectId(projectId);
  if (legacyGuard) await acquireStructuralWrite(); // waits its turn (owner 2026-11-10: no refusals)
  try {
    const result = await writer.writeTagSwap(request.location, request.kind, request.src, request.imageFill, request.origin, request.masterWrite);
    if (result && result.changed) {
      const loc = { ...request.location, line: result.replacedLine, column: 1 };
      pushStructuralUndo({ structuralOp: {
        ...(result.sourceFiles ? { sourceFiles: result.sourceFiles } : {}),
        ...(request.masterWrite ? { masterWrite: true } : {}),
        inverse: [{ kind: 'restore-region', loc, lineCount: result.replacedLineCount, segment: result.originalSegment }],
        forward: [{ kind: 'restore-region', loc, lineCount: result.originalLineCount, segment: result.replacementSegment }],
      } });
    }
    return result;
  } finally { if (legacyGuard) releaseStructuralWrite(); }
}
