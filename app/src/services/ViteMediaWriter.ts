/**
 * task-140 media fill: browser-safe client for the container -> img/video
 * tag swap in the real source file (local/server write channel).
 */

import type { SourceLocation } from '@/core/state/index';
import { BaseViteWriter } from './BaseViteWriter';
import type { LocalWriteOrigin } from '@/utils/localWriteScope';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { isLocalProjectId } from '@/utils/localMode';
import { acceptSourceMedia } from './durableEdits/sourceMediaAcceptance';
import type { ImageFillRequest } from '../../../preview-template/src/plugins/sq-image-fill.js';
export type { ImageFillRequest, ImageFillChange } from '../../../preview-template/src/plugins/sq-image-fill.js';

export interface MediaSwapResult extends Record<string, unknown> {
  changed: boolean;
  replacedLine: number;
  originalLineCount: number;
  replacedLineCount: number;
  originalSegment: string;
  replacementSegment: string;
  sourceFiles?: import('./durableEdits/types').DurableFileChange[];
}

class ViteMediaWriter extends BaseViteWriter {
  constructor() {
    super({
      resultMessageType: 'SQ_WRITE_TAG_SWAP_RESULT',
      writerName: 'ViteMediaWriter',
      requestIdPrefix: 'media_',
    });
  }

  async writeTagSwap(
    sourceLocation: SourceLocation,
    kind: 'image' | 'video' | 'container' | 'image-fill',
    src: string,
    imageFill?: ImageFillRequest,
    origin?: LocalWriteOrigin,
    masterWrite = false,
  ): Promise<MediaSwapResult | false> {
    const projectId = getActiveSaveProjectId();
    if (projectId && isLocalProjectId(projectId)) return acceptSourceMedia(projectId, sourceLocation, kind, src, imageFill, origin, masterWrite);
    return this.sendViaPostMessageForPayload<MediaSwapResult>('SQ_WRITE_TAG_SWAP', { sourceLocation, kind, src, ...(imageFill ? { imageFill } : {}) }, masterWrite, origin);
  }
}

export const viteMediaWriter = new ViteMediaWriter();
