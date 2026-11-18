/**
 * task-144: MediaSection's per-runtime asset sources behind ONE interface.
 * Local wraps the /__sq/local endpoints (files ARE the assets); the Dexie
 * source reads/writes db.assets (sq-asset pipeline; used before a project
 * path is known). The pick router in
 * MediaSection stays selection-typed — a source only shapes where bytes live.
 */
import { db, getAssetBlob } from '@/db';
import { readJsonResponse } from '@/utils/readJsonResponse';
import { uploadAssetBlob } from '@/hooks/useAssetUpload';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import { uploadLocalAssetFile } from '@/utils/imageUpload';
import { localFetch } from '../../utils/sqLocalBase';

export interface MediaAssetEntry {
  /** display + aria handle (local: repo-relative path; Dexie: file name) */
  name: string;
  kind: 'image' | 'video' | 'file';
  thumbUrl: string | null;
  /** value writable into an img src (plain URL or sq-asset ref); null = read-only */
  applySrc: string | null;
}

export interface MediaAssetSource {
  list(): Promise<MediaAssetEntry[]>;
  upload(file: File): Promise<void>;
  /** bytes for the bound-rebind pick path; absent when unsupported (Dexie) */
  fileFor?(entry: MediaAssetEntry): Promise<File | null>;
  /** release list()-created object URLs (blob thumbs) */
  dispose?(entries: MediaAssetEntry[]): void;
}

export function makeLocalAssetSource(projectId: string, localPath: string): MediaAssetSource {
  const ownedThumbnails = new Set<string>();
  const filePath = (name: string): string =>
    `/__sq/local/asset-file?path=${encodeURIComponent(localPath)}&file=${encodeURIComponent(name)}`;
  return {
    async list() {
      const resp = await localFetch(`/__sq/local/assets?path=${encodeURIComponent(localPath)}`);
      const assets = await readJsonResponse(resp, value => {
        if (!value || typeof value !== 'object' || !('assets' in value) || !Array.isArray(value.assets)) throw new Error('Invalid asset list');
        return value.assets.map((asset: unknown) => {
          if (!asset || typeof asset !== 'object' || !('file' in asset) || typeof asset.file !== 'string' || !('url' in asset) || asset.url !== null && typeof asset.url !== 'string' || !('kind' in asset) || !['image', 'video', 'file'].includes(String(asset.kind))) throw new Error('Invalid asset');
          return { file: asset.file, url: asset.url as string | null, kind: asset.kind as 'image' | 'video' | 'file' };
        });
      });
      // The editor page never loads the instance origin as a subresource —
      // thumbs become blob: URLs read through the local transport.
      return Promise.all(assets.map(async a => {
        let thumbUrl = '';
        try {
          const r = await localFetch(filePath(a.file));
          if (r.ok) { thumbUrl = URL.createObjectURL(await r.blob()); ownedThumbnails.add(thumbUrl); }
        } catch { /* listed without a thumb */ }
        return { name: a.file, kind: a.kind, thumbUrl, applySrc: a.url };
      }));
    },
    async upload(file) {
      await uploadLocalAssetFile(projectId, file);
    },
    dispose(entries) {
      for (const entry of entries) if (entry.thumbUrl && ownedThumbnails.delete(entry.thumbUrl)) URL.revokeObjectURL(entry.thumbUrl);
    },
    async fileFor(entry) {
      const resp = await localFetch(filePath(entry.name));
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const name = entry.name.split('/').pop() || 'image.png';
      return new File([blob], name, { type: blob.type || 'image/png' });
    },
  };
}

export function makeDexieAssetSource(projectId: string): MediaAssetSource {
  return {
    async list() {
      const rows = await db.assets.where('projectId').equals(projectId).toArray();
      return rows.map(a => ({
        name: a.name,
        kind: a.mimeType?.startsWith('video/') ? 'video' as const
          : a.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
        thumbUrl: URL.createObjectURL(getAssetBlob(a)),
        applySrc: `sq-asset:${a.id}`,
      }));
    },
    async upload(file) {
      const { assetId } = await uploadAssetBlob(projectId, file);
      await transferAssetToIframe(assetId, file);
    },
    dispose(entries) {
      for (const e of entries) {
        if (e.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(e.thumbUrl);
      }
    },
  };
}
