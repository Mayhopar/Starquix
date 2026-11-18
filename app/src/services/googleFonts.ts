/**
 * Google Fonts self-hosting: fetch css2 once at pick time, download woff2
 * bytes into Dexie assets, and bake @font-face CSS with sq-asset: refs.
 * After pick, Google is never contacted again (bytes are local).
 */
import { v4 as uuid } from 'uuid';
import { db } from '@/db';
import { getSyncConfig } from '@/store/persistence/SyncClient';
import { pushAsset } from '@/store/persistence/assetSync';

export interface FontFaceBlock {
  fontFamily: string;
  fontStyle: string;
  fontWeight: string;
  unicodeRange: string;
  url: string;
  subset: string;
}

// ponytail: latin + latin-ext only; more subsets when a user asks
const KEEP_SUBSETS = ['latin', 'latin-ext'];

export function buildCss2Url(family: string, weights: number[]): string {
  const fam = family.replace(/ /g, '+');
  const w = [...weights].sort((a, b) => a - b).join(';');
  return `https://fonts.googleapis.com/css2?family=${fam}:wght@${w}&display=swap`;
}

export function parseGoogleFontCss(css: string, keepSubsets: string[] = KEEP_SUBSETS): FontFaceBlock[] {
  const blocks: FontFaceBlock[] = [];
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const subset = m[1];
    if (!keepSubsets.includes(subset)) continue;
    const body = m[2];
    const prop = (name: string) =>
      (body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? '').trim();
    const urlMatch = body.match(/src:\s*url\(([^)]+)\)/);
    if (!urlMatch) continue;
    blocks.push({
      fontFamily: prop('font-family').replace(/['"]/g, ''),
      fontStyle: prop('font-style') || 'normal',
      fontWeight: prop('font-weight') || '400',
      unicodeRange: prop('unicode-range'),
      url: urlMatch[1].replace(/['"]/g, ''),
      subset,
    });
  }
  return blocks;
}

/** Bake @font-face blocks. Default url shape is the WC sq-asset: ref
 *  (resolved by bridge/export); local mode passes `urlFor` to point at the
 *  real /fonts/ files it wrote — ONE css shape for both runtimes (gap-61). */
export function buildFontFaceCss<T extends FontFaceBlock>(
  family: string,
  blocks: T[],
  urlFor: (b: T) => string = (b) => `sq-asset:${(b as T & { assetId?: string }).assetId}`,
): string {
  return blocks.map(b =>
    `@font-face{font-family:'${family}';font-style:${b.fontStyle};` +
    `font-weight:${b.fontWeight};font-display:swap;` +
    `src:url('${urlFor(b)}') format('woff2');` +
    (b.unicodeRange ? `unicode-range:${b.unicodeRange};` : '') + `}`,
  ).join('\n');
}

export interface FetchedFontFile extends FontFaceBlock {
  blob: Blob;
  fileName: string;
}

/**
 * Fetch css2 → download each woff2. Persistence-free half of the pick flow,
 * shared by the WC path (Dexie, below) and the local files-truth path
 * (utils/localFonts.ts — Dexie is banned for local_ ids, task-132).
 * Throws on ANY failure BEFORE anything is referenced.
 */
export async function fetchGoogleFontFiles(
  family: string,
  weights: number[],
): Promise<FetchedFontFile[]> {
  const resp = await fetch(buildCss2Url(family, weights));
  if (!resp.ok) throw new Error(`Google Fonts responded ${resp.status}`);
  const blocks = parseGoogleFontCss(await resp.text());
  if (blocks.length === 0) throw new Error(`No font files parsed for ${family}`);
  return Promise.all(blocks.map(async (b) => {
    const r = await fetch(b.url);
    if (!r.ok) throw new Error(`Font file fetch failed: ${r.status}`);
    return {
      ...b,
      blob: await r.blob(),
      fileName: `${family.replace(/ /g, '-')}-${b.fontWeight}-${b.subset}.woff2`,
    };
  }));
}

/**
 * Full WC pick flow: fetch css2 → download each woff2 → store as Dexie
 * assets. Caller writes the manifest only on success (no half-state; stray
 * Dexie rows are harmless). NOT for local_ projects — they use
 * utils/localFonts.pickLocalGoogleFont (files are truth, no Dexie).
 */
export async function pickGoogleFont(
  family: string,
  weights: number[],
  projectId: string,
): Promise<{ css: string; assetIds: string[] }> {
  const files = await fetchGoogleFontFiles(family, weights);
  const syncCfg = getSyncConfig(projectId);
  const withAssets = await Promise.all(files.map(async (b) => {
    const id = uuid();
    await db.assets.add({
      id, projectId,
      name: b.fileName,
      mimeType: 'font/woff2', blob: b.blob, createdAt: new Date(),
    });
    if (syncCfg) void pushAsset(id, b.blob, syncCfg);
    return { ...b, assetId: id };
  }));
  return { css: buildFontFaceCss(family, withAssets), assetIds: withAssets.map(a => a.assetId) };
}
