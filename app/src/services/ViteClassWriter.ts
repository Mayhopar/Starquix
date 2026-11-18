/**
 * Vite Class Writer
 *
 * Browser-safe client for writing class updates to source files
 * via the Astro dev server's Vite plugin.
 */

import type { SourceLocation } from '@/core/state/index';
import type { LocalWriteOrigin } from '@/utils/localWriteScope';
import { BaseViteWriter } from './BaseViteWriter';
import { getActiveSaveProjectId } from './pendingProjectMutations';
import { isLocalProjectId } from '@/utils/localMode';
import * as Y from 'yjs';
import { acceptFileChanges, finishAcceptedFiles } from './durableEdits/fileAcceptance';
import { classCommands } from './durableEdits/classCommands';
import { acceptProjectEdit } from './durableEdits/acceptance';
import { flushDurableSourceWritesThrough } from './durableEdits/sourceMaterialization';
import { prepareSourceGesture } from './durableEdits/sourceGesture';
import { updateClassAttribute } from '@/vite-plugin/ast-updater';
import { createSourceIdentityMap } from '@/vite-plugin/source-transform-identity';

class ViteClassWriter extends BaseViteWriter {
  constructor() {
    super({
      resultMessageType: 'SQ_WRITE_RESULT',
      writerName: 'ViteClassWriter',
    });
  }

  /**
   * `masterWrite`: explicit Push to source only — see BaseViteWriter.
   *
   * `baseClasses`: what the FILE renders for this element right now
   * (services/classWriteBaseline.ts). The writer needs it to tell the tokens a
   * leading literal owns from the ones a dynamic expression contributes, and
   * REFUSES the partial shapes without it rather than baking one over the
   * other — see the task-166 contract in vite-plugin/ast-updater.ts.
   *
   * `origin`: the surface the gesture was made ON (utils/localWriteScope.ts).
   * This is the only DEFERRED write path — the queue debounces 5 s — so the
   * write-scope law must be judged against gesture time, not flush time.
   */
  async writeClassUpdate(
    sourceLocation: SourceLocation,
    newClasses: string,
    masterWrite = false,
    baseClasses?: string,
    origin?: LocalWriteOrigin,
    recoveryOwnsFailure = false,
  ): Promise<boolean> {
    const projectId = getActiveSaveProjectId();
    if (masterWrite && projectId && isLocalProjectId(projectId)) {
      // Explicit Push may write several overrides from one scan. Retain this
      // transform's identity so following text/image writes can rebase safely.
      // Ordinary instance class edits keep their existing surface-scope gate.
      const gesture = prepareSourceGesture(projectId);
      const accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
        const location = await gesture.resolve(sourceLocation);
        const change = gesture.files.get(location.file)!;
        if (change.afterSource === null) throw new Error('Class source does not exist');
        change.afterSource = await updateClassAttribute(change.afterSource, location.file, location, newClasses, baseClasses,
          (before, after, spans) => { (change.identityMaps ??= []).push(createSourceIdentityMap(before, after, spans)); });
        return [...gesture.files.values()];
      });
      void finishAcceptedFiles(accepted);
      return true;
    }
    if (projectId && isLocalProjectId(projectId)) {
      // Ordinary local writes (grid placement, class-journal replay) take the
      // durable journal like every other local source write.
      const commands = classCommands(sourceLocation, newClasses, baseClasses ?? null, origin, 0);
      if (!commands.length) return false;
      const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
      try {
        const accepted = await acceptProjectEdit(doc, { projectId, operationId: crypto.randomUUID(), commands, mutate() {} });
        void flushDurableSourceWritesThrough(projectId, accepted.revision).catch(() => {});
        return true;
      } finally { doc.destroy(); }
    }
    return this.sendViaPostMessage(
      'SQ_WRITE_CLASSES', { sourceLocation, newClasses, baseClasses }, masterWrite, origin, recoveryOwnsFailure,
    );
  }
}

// Singleton instance
export const viteClassWriter = new ViteClassWriter();
