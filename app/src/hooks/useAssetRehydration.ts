// app/src/hooks/useAssetRehydration.ts

import { useEffect, useRef } from 'react';
import { db, getAssetBlob } from '@/db';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { getLastAssetsOwned } from '@/components/Canvas/viewportMessages/lifecycle';
import { isCoverAssetId } from '@/hooks/useCoverCapture';

/**
 * Diff-based `sq-asset:` rehydration (task-012, reworked in task-120).
 *
 * On upload, `useAssetUpload` persists the blob to IndexedDB and
 * `transferAssetToIframe` hands the bytes to bridge.js, which mints an
 * iframe-origin blob URL in `_assetMap`. Yjs only stores the compact
 * `sq-asset:{id}` reference — so a fresh iframe holds no bytes.
 *
 * After every real iframe (re)load the bridge reports the asset ids it
 * already holds (`ASSETS_OWNED`, relayed by ViewportFrame as the
 * `sq:assets-owned` window event). This hook diffs that list against Dexie
 * and transfers ONLY the missing assets. Fresh boot → empty list → full
 * transfer; everything else → no bytes on the wire. RENDER never triggers
 * rehydration: blob URLs are stable for the iframe's lifetime (task-120
 * hash guard) and DOM nodes survive incremental paints.
 *
 * The hook is a no-op when `projectId` is null (project not yet hydrated) —
 * the next `sq:assets-owned` after hydration picks the assets up.
 */

/** Asset ids that must be sent: in Dexie, not held by the iframe, not a cover screenshot. */
export function diffMissingAssetIds(ownedIds: string[], dexieIds: string[]): string[] {
  const owned = new Set(ownedIds);
  return dexieIds.filter((id) => !isCoverAssetId(id) && !owned.has(id));
}

export function useAssetRehydration(projectId: string | null): void {
  // Guard against overlapping runs (e.g. multiple sq:assets-owned bursts) —
  // they would read the same IndexedDB rows and double-transfer. The bridge's
  // hash guard makes duplicates harmless, but skip the wasted bytes.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!projectId) return;

    const rehydrate = async (ownedIds: string[]) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const assets = await db.assets.where('projectId').equals(projectId).toArray();
        const missing = new Set(diffMissingAssetIds(ownedIds, assets.map((a) => a.id)));
        for (const asset of assets) {
          if (!missing.has(asset.id)) continue;
          try {
            await transferAssetToIframe(asset.id, getAssetBlob(asset));
          } catch (err) {
            console.warn('[asset-rehydration] transfer failed for', asset.id, err);
          }
        }
      } catch (err) {
        console.warn('[asset-rehydration] IndexedDB read failed', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    const onAssetsOwned = (e: Event) => {
      const ids = (e as CustomEvent<{ ids?: string[] }>).detail?.ids ?? [];
      void rehydrate(ids);
    };

    window.addEventListener('sq:assets-owned', onAssetsOwned);
    // Mount/projectId-hydration race: if the bridge already reported before
    // this listener attached, catch up from the stored last report.
    const missed = getLastAssetsOwned();
    if (missed) void rehydrate(missed);
    return () => {
      window.removeEventListener('sq:assets-owned', onAssetsOwned);
    };
  }, [projectId]);
}
