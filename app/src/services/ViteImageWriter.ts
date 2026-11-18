/**
 * Vite Image Writer
 *
 * Browser-safe client for writing image attribute updates to source files
 * via the Astro dev server's Vite plugin.
 */

import type { SourceLocation } from '@/core/state/index';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, allowsCrossFileOverrideWrite, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { BaseViteWriter } from './BaseViteWriter';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { isLocalProjectId } from '@/utils/localMode';
import { acceptSourceImageAttribute } from './durableEdits/sourceAttributeAcceptance';

class ViteImageWriter extends BaseViteWriter {
  constructor() {
    super({
      resultMessageType: 'SQ_WRITE_IMAGE_RESULT',
      writerName: 'ViteImageWriter',
      requestIdPrefix: 'img_',
    });
  }

  /** `masterWrite`: explicit Push to source only — see BaseViteWriter. */
  async writeImageUpdate(
    sourceLocation: SourceLocation,
    attribute: 'src' | 'alt' | 'loading' | 'data-sq-media',
    newValue: string,
    masterWrite = false,
    origin?: LocalWriteOrigin,
    recoveryOwnsFailure = false,
    /** The element key — an instance <img> on a page writes its override as a prop. */
    key?: string,
  ): Promise<boolean> {
    const projectId = getActiveSaveProjectId();
    if (projectId && isLocalProjectId(projectId)) {
      // An instance <img> on a page: the override lives in files as a prop (utils/propOverrides.ts).
      const at = origin ?? captureLocalWriteOrigin();
      if (!masterWrite && key && (attribute === 'src' || attribute === 'alt')
        && isCrossFileAtOrigin(at, sourceLocation.file) && !allowsCrossFileOverrideWrite(at, sourceLocation.file)) {
        const { acceptPropOverride } = await import('./durableEdits/propOverrideCommands');
        if (await acceptPropOverride(projectId, key, sourceLocation, attribute, newValue, at)) return true;
      }
      await acceptSourceImageAttribute(projectId, sourceLocation, attribute, newValue, masterWrite, origin);
      return true;
    }
    return this.sendViaPostMessage('SQ_WRITE_IMAGE', { sourceLocation, attribute, newValue }, masterWrite, origin, recoveryOwnsFailure);
  }
}

// Singleton instance
export const viteImageWriter = new ViteImageWriter();
