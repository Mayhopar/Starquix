import { db, getAssetBlob } from '@/db';
import { bytesToBase64, type CopiedAsset } from './envelope';

// Broadest of the three sq-asset regexes in the codebase (assetSync.ts).
const SQ_ASSET_RE = /sq-asset:([A-Za-z0-9._-]{1,128})/g;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

export function collectAssetRefs(strings: string[]): string[] {
  const ids = new Set<string>();
  for (const s of strings) {
    for (const m of s.matchAll(SQ_ASSET_RE)) {
      if (!m[1].startsWith('cover_')) ids.add(m[1]);
    }
  }
  return [...ids];
}

export async function collectAssets(assetIds: string[]): Promise<CopiedAsset[]> {
  const out: CopiedAsset[] = [];
  let total = 0;
  for (const assetId of assetIds) {
    const row = await db.assets.get(assetId);
    if (!row) continue; // dangling ref: carry the string ref as-is, nothing to embed
    const blob = getAssetBlob(row);
    if (blob.size > MAX_ASSET_BYTES || total + blob.size > MAX_TOTAL_BYTES) {
      out.push({ assetId, mime: row.mimeType, name: row.name, base64: null });
      continue;
    }
    total += blob.size;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    out.push({ assetId, mime: row.mimeType, name: row.name, base64: bytesToBase64(bytes) });
  }
  return out;
}
