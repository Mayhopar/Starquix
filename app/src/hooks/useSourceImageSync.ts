/**
 * Source-image attribute sync.
 *
 * Observes the `sourceImageAttributes` Yjs map, posts
 * SYNC_IMAGE_ATTR_TO_IFRAME messages, and writes each change through
 * ViteImageWriter immediately (durable acceptance). Write-only sink.
 *
 * Extracted from ClassStoreContext.tsx 2026-05-22 (task-014).
 */

import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { viteImageWriter } from '@/services/ViteImageWriter';
import { registeredSourceLocation, currentScannedSourceLocation } from '@/utils/sourceLocationKey';
import type { SourceLocation } from '@/bridge';
import { isLocalProjectId } from '@/utils/localMode';
import { requestImageAttrRestore } from '@/components/Canvas/restoreOverrides';
import { isImageBookkeepingField, isSourceOwnedImageValue, HYDRATE_ORIGIN } from '@/store/sourceOverrideEntries';

import { captureLocalWriteOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';

type AttrMap = Map<string, string>;

interface PendingImage { key: string; sourceLocation: SourceLocation; attribute: string; value: string; origin: LocalWriteOrigin }
// A project queue outlives its disposable doc/hook while a refused edit remains.
const queues = new Map<string | Y.Doc, ReturnType<typeof createImageQueue>>();
function createImageQueue(projectId: string | null, queueKey: string | Y.Doc) {
  const dirty = new Map<string, PendingImage>();
  let inFlight: Promise<void> | null = null;
  let mounts = 0;
  const cleanup = () => { if (!mounts && !dirty.size && !inFlight) queues.delete(queueKey); };
  // Every edit dispatches at once: the local writer accepts it durably before
  // resolving. A refusal keeps the edit here and the next edit/mount retries it.
  const flush = (): Promise<void> => {
    if (inFlight) return inFlight;
    const drain = async () => {
      while (dirty.size) {
        if (projectId !== null && getActiveSaveProjectId() !== projectId) throw new Error('Image destination project is not active');
        const results = await Promise.allSettled([...dirty].map(async ([id, edit]) => {
          if (!(projectId && isLocalProjectId(projectId)) && !viteImageWriter.isAvailable()) throw new Error('Image writer is not ready');
          const ok = await viteImageWriter.writeImageUpdate(edit.sourceLocation, edit.attribute as 'src' | 'alt' | 'loading', edit.value, false, edit.origin, true, edit.key);
          if (!ok) throw new Error('Image source write was refused');
          if (dirty.get(id) === edit) dirty.delete(id);
        }));
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) throw failed.reason;
      }
    };
    inFlight = drain().then(() => { inFlight = null; cleanup(); }, error => { inFlight = null; console.error('[image source]', error); throw error; });
    return inFlight;
  };
  return {
    mount() {
      mounts++;
      if (dirty.size) void flush().catch(() => {});
      return () => { mounts--; cleanup(); };
    },
    markDirty(key: string, sourceLocation: SourceLocation, attribute: string, value: string, initial: boolean) {
      const id = `${key}:${attribute}`;
      // Hydrating a replacement doc is not a new gesture. Keep retained intent.
      if (initial && dirty.has(id)) return;
      dirty.set(id, { key, sourceLocation: { ...sourceLocation }, attribute, value, origin: captureLocalWriteOrigin() });
      void flush().catch(() => {});
    },
  };
}

export function useSourceImageSync(
  doc: Y.Doc,
  isUndoingOrRedoing: () => boolean,
  projectId: string | null = getActiveSaveProjectId(),
): void {
  const prevAttributesRef = useRef<Map<string, AttrMap>>(new Map());
  const prevOwnedAttributesRef = useRef<Map<string, Set<string>>>(new Map());
  const queueKey = projectId ?? doc;
  const queueRef = useRef<{ key: string | Y.Doc; queue: ReturnType<typeof createImageQueue> } | null>(null);
  if (queueRef.current?.key !== queueKey) {
    const queue = queues.get(queueKey) ?? createImageQueue(projectId, queueKey);
    queues.set(queueKey, queue);
    queueRef.current = { key: queueKey, queue };
  }
  const queue = queueRef.current.queue;
  useEffect(() => queue.mount(), [queue]);

  useEffect(() => {
    const sourceImageAttributes = doc.getMap('sourceImageAttributes');
    let initial = true;

    const sync = (_events?: unknown, tr?: Y.Transaction) => {
      // A scan seed or a cache restore is not a gesture — painting it is enough.
      const hydrating = tr?.origin === HYDRATE_ORIGIN;
      const current = new Map<string, AttrMap>();
      const owned = new Map<string, Set<string>>();

      sourceImageAttributes.forEach((yAttrs, key) => {
        const attrs = yAttrs as Y.Map<unknown>;
        const attrMap: AttrMap = new Map();
        attrs.forEach((value, attrKey) => {
          if (isImageBookkeepingField(attrKey)) return; // anchors, not attributes
          if (typeof value === 'string') attrMap.set(attrKey, value);
        });
        if (attrMap.size > 0) current.set(key, attrMap);
        owned.set(key, new Set([...attrMap].filter(([attribute, value]) => isSourceOwnedImageValue(attrs, attribute, value)).map(([attribute]) => attribute)));
      });

      const prev = prevAttributesRef.current;

      current.forEach((attrMap, key) => {
        // A coordinate key is only an index. A NEW gesture names the element
        // of the current admitted scan; a registration retained on the same key
        // (e.g. a class edit made when another element sat there) projects to
        // THAT element — desktop 2026-10-04: an upload landed on the <a> that
        // occupied the img's coordinate before a reorder, or failed 'Source
        // element has been deleted' after duplicate/delete/undo/redo. Hydration
        // and undo/redo replay keep the registered identity.
        const sourceLocation = (!initial && !isUndoingOrRedoing()
          ? currentScannedSourceLocation(projectId ?? (doc.getMap('meta').get('projectId') as string | undefined), key)
          : undefined) ?? registeredSourceLocation(doc, key, 'sourceImageAttributes');
        if (!sourceLocation) return;

        const prevMap = prev.get(key);

        attrMap.forEach((value, attribute) => {
          if (prevMap?.get(attribute) === value) return;

          // Owned carriers are transient live feedback, never a reload overlay.
          if (initial && owned.get(key)?.has(attribute)) return;
          window.postMessage(
            {
              type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
              payload: { key, attribute, value },
            },
            '*'
          );

          // The accepted file command already owns this exact value, including
          // snapshot replay. Keep preview publication, but never accept it twice.
          const replayingOwnedValue = isUndoingOrRedoing() && prevOwnedAttributesRef.current.get(key)?.has(attribute);
          if (!owned.get(key)?.has(attribute) && !replayingOwnedValue && !hydrating) {
            queue.markDirty(key, sourceLocation, attribute, value, initial);
          }
        });
      });

      // task-151: an entry the undo REMOVED means "put the image back the way
      // the source renders it". Nothing used to fire here — the key simply
      // vanished from `current` — so the canvas kept the discarded src until a
      // full preview reload. The value cannot come from the parent: the scan
      // payload reports boundAssetPath and (since task-186 FIX-2) the src value
      // alone — never alt/loading — so the answer is the baseline the bridge
      // captured before it applied the first override (bridge
      // handleRestoreOriginalImageAttributes).
      if (isUndoingOrRedoing()) {
        const removed: { key: string; kind: 'image' }[] = [];
        prev.forEach((attrMap, key) => {
          if (current.has(key)) return;
          requestImageAttrRestore({ key, attributes: Array.from(attrMap.keys()) });
          removed.push({ key, kind: 'image' });
        });
        // An instance <img> override also lives in files as a page prop.
        if (removed.length) void import('@/services/durableEdits/propOverrideCommands').then(m => m.dropPropOverrides(removed))
          .catch(error => console.error('[overrides] page prop not dropped on undo', error));
      }

      prevAttributesRef.current = current;
      prevOwnedAttributesRef.current = owned;
      initial = false;
    };

    sync();
    sourceImageAttributes.observeDeep(sync);

    return () => {
      sourceImageAttributes.unobserveDeep(sync);
    };
  }, [doc, queue, isUndoingOrRedoing]);

}
