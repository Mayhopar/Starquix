/**
 * Vite Text Writer
 *
 * Browser-safe client for writing text content updates to source files
 * via the Astro dev server's Vite plugin.
 */

import type { SourceLocation } from '@/store/types';
import { BaseViteWriter } from './BaseViteWriter';
import * as Y from 'yjs';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { isLocalProjectId } from '@/utils/localMode';
import { textCommands } from './durableEdits/textCommands';
import { acceptProjectEdit } from './durableEdits/acceptance';
import { flushDurableSourceWritesThrough } from './durableEdits/sourceMaterialization';
import { encodeInnerHtmlEntities } from '../../../preview-template/src/plugins/sq-prop-fallback.js';

class ViteTextWriter extends BaseViteWriter {
  constructor() {
    super({
      resultMessageType: 'SQ_WRITE_TEXT_RESULT',
      writerName: 'ViteTextWriter',
    });
  }

  /** `newText`: plain text (Element.textContent). `masterWrite`: explicit Push to source only — see BaseViteWriter. */
  async writeTextUpdate(
    sourceLocation: SourceLocation,
    newText: string,
    masterWrite = false,
  ): Promise<boolean> {
    const projectId = getActiveSaveProjectId();
    if (projectId && isLocalProjectId(projectId)) {
      const commands = textCommands(sourceLocation, encodeInnerHtmlEntities(newText), undefined, masterWrite);
      if (!commands.length) return false;
      const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
      try {
        const accepted = await acceptProjectEdit(doc, { projectId, operationId: crypto.randomUUID(), commands, mutate() {} });
        void flushDurableSourceWritesThrough(projectId, accepted.revision).catch(() => {});
        return true;
      } finally { doc.destroy(); }
    }
    // No armed instance → no write target: silent no-op here so call sites
    // don't need their own isAvailable() guards (the gate lives in one place)
    if (!this.isAvailable()) return false;
    return this.sendViaPostMessage('SQ_WRITE_TEXT', { sourceLocation, newText }, masterWrite);
  }
}

export const viteTextWriter = new ViteTextWriter();
