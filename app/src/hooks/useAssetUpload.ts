import { useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { db, getAssetBlob } from '../db';
import { getSyncConfig } from '../store/persistence/SyncClient';
import { pushAsset } from '../store/persistence/assetSync';

export interface UploadAssetResult {
  assetId: string;
  editorBlobUrl: string;
}

interface UseAssetUploadReturn {
  uploadAsset: (file: File) => Promise<UploadAssetResult>;
  getAssetUrl: (assetId: string) => Promise<string | null>;
}

/**
 * Uploads an image file to IndexedDB and returns an asset ID + editor-origin
 * blob URL. Plain function so non-hook callers (AI generate_image tool) can
 * ride the SAME upload path as the hook — never duplicate this logic.
 */
export async function uploadAssetBlob(projectId: string, file: File): Promise<UploadAssetResult> {
  const id = uuid();

  await db.assets.add({
    id,
    projectId,
    name: file.name,
    mimeType: file.type,
    blob: file,
    createdAt: new Date(),
  });

  // Cloud asset sync (task-087b): fire-and-forget — bytes are durable
  // locally either way; device B pulls them via syncAssets on open.
  const syncCfg = getSyncConfig(projectId);
  if (syncCfg) void pushAsset(id, file, syncCfg);

  return { assetId: id, editorBlobUrl: URL.createObjectURL(file) };
}

/**
 * Uploads an image file to IndexedDB and returns an asset ID + editor-origin blob URL.
 */
export function useAssetUpload(projectId: string): UseAssetUploadReturn {
  const uploadAsset = useCallback((file: File) => uploadAssetBlob(projectId, file), [projectId]);

  const getAssetUrl = useCallback(async (assetId: string): Promise<string | null> => {
    const asset = await db.assets.get(assetId);
    if (!asset) return null;
    return URL.createObjectURL(getAssetBlob(asset));
  }, []);

  return { uploadAsset, getAssetUrl };
}
