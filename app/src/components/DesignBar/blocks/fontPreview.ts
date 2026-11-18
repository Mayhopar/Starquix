/**
 * Editor-page font previews for the family dropdown. Google families load a
 * css2 stylesheet subset to the family name's own glyphs (tiny); project fonts
 * (bytes already in Dexie) register a real FontFace. Editor-only nicety — the
 * preview iframe and exports stay fully self-hosted; nothing here touches them.
 */
import { db, getAssetBlob } from '@/db';

const loaded = new Set<string>();

export function previewFontUrl(family: string): string {
  const fam = family.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(family)}&display=swap`;
}

export function ensurePreviewFont(family: string): void {
  if (loaded.has(family)) return;
  loaded.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = previewFontUrl(family);
  document.head.appendChild(link);
}

/** Exact, offline preview for a picked font: build a FontFace from its Dexie bytes. */
export async function ensureProjectPreviewFont(family: string, assetId: string | undefined): Promise<void> {
  if (!assetId || loaded.has(family)) return;
  loaded.add(family);
  try {
    const row = await db.assets.get(assetId);
    if (!row) return;
    const face = new FontFace(family, `url(${URL.createObjectURL(getAssetBlob(row))})`);
    await face.load();
    document.fonts.add(face);
  } catch {
    // preview only — never block the picker
  }
}

export function _resetPreviewCacheForTests(): void {
  loaded.clear();
}
