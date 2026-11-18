/**
 * gap-61: files-truth font persistence.
 *
 * The doc-truth path persisted a picked font as Dexie asset bytes + a Yjs
 * fonts-manifest entry; both are disposable for a files-truth project (the
 * doc is a session working copy), so a pick that only did that died on
 * reopen while the class writer had already put a font-["Family"] token into
 * the user's real .astro file. Here the pick writes REAL files into the
 * project instead (through the instance's /__sq/local/font-* routes):
 *   public/fonts/<file>              — the font bytes
 *   public/sq-fonts.css              — marker-merged @font-face + class rule
 *   <link … href="/sq-fonts.css">    — injected before </head> in src/**.astro
 * so the font survives editor reopen AND the user's own astro dev/build.
 * The session doc still gets SET_PROJECT_FONT with this css (real /fonts/
 * urls, no sq-asset: refs, assetIds: []) so the live iframe renders it
 * immediately via the unchanged useFontsSync → SET_FONTS_CSS path.
 */
import { findLocalProjectEntry, PROJECT_NOT_READY, projectIdFromPath } from '@/utils/localMode';
import { settleSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { fetchGoogleFontFiles, buildFontFaceCss } from '@/services/googleFonts';
import {
  buildCustomFontFaceCss, familyFromFileName, fontFormatForFile,
} from '@/utils/fontValidation';
import { familyToClass } from '@/components/DesignBar/blocks/fontFamilyClass';
import { localFetch } from './sqLocalBase';

export const LOCAL_FONT_NO_HEAD_WARNING =
  'Font saved to public/fonts + public/sq-fonts.css, but no </head> was found in src/**/*.astro — ' +
  'add <link rel="stylesheet" href="/sq-fonts.css"> to your layout yourself.';

/** The font-family rule for the exact class token the class writer persists
 *  (font-["Open_Sans"]), so the font resolves even in a project without
 *  Tailwind arbitrary-value support. Harmless duplicate when Tailwind does
 *  generate it — same declaration. */
export function fontClassRuleCss(family: string): string {
  const selector = '.' + familyToClass(family).replace(/[^A-Za-z0-9_-]/g, (m) => '\\' + m);
  return `${selector}{font-family:'${family}';}`;
}

async function postFontFile(dir: string, name: string, blob: Blob): Promise<string> {
  const params = new URLSearchParams({ path: dir, name });
  const resp = await localFetch(`/__sq/local/font-file?${params}`, { method: 'POST', body: blob });
  const body = (await resp.json().catch(() => ({}))) as { src?: string; error?: string };
  if (!resp.ok || !body.src) throw new Error(body.error || `Font write failed (${resp.status})`);
  return body.src;
}

async function postFontCss(dir: string, family: string, css: string): Promise<{ linked: boolean }> {
  // The <link> lands in layout files a pending class write may target.
  await settleSourceWrites(projectIdFromPath(dir));
  const resp = await localFetch('/__sq/local/font-css', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dir, family, css }),
  });
  const body = (await resp.json().catch(() => ({}))) as { linked?: boolean; error?: string };
  if (!resp.ok) throw new Error(body.error || `Font CSS write failed (${resp.status})`);
  return { linked: !!body.linked };
}

function requireEntryPath(projectId: string): string {
  const entry = findLocalProjectEntry(projectId);
  if (!entry) throw new Error(PROJECT_NOT_READY);
  return entry.path;
}

export interface LocalFontResult {
  /** Baked css with real /fonts/ urls — feed to SET_PROJECT_FONT for live preview. */
  css: string;
  /** Honest-toast text when the stylesheet could not be linked; null when wired. */
  warning: string | null;
}

/** Google pick, local runtime: fetch bytes → user's public/fonts/ →
 *  marker-merge sq-fonts.css → ensure the <link>. No Dexie, no sq-asset refs. */
export async function pickLocalGoogleFont(
  projectId: string, family: string, weights: number[],
): Promise<LocalFontResult> {
  const dir = requireEntryPath(projectId);
  const files = await fetchGoogleFontFiles(family, weights);
  const withSrc = await Promise.all(files.map(async (b) => ({
    ...b, src: await postFontFile(dir, b.fileName, b.blob),
  })));
  const css = `${buildFontFaceCss(family, withSrc, (b) => b.src)}\n${fontClassRuleCss(family)}`;
  const { linked } = await postFontCss(dir, family, css);
  return { css, warning: linked ? null : LOCAL_FONT_NO_HEAD_WARNING };
}

export interface LocalUploadedFont extends LocalFontResult {
  family: string;
  format: string;
  /** The /fonts/… url the bytes landed at — the rebake handle. */
  srcUrl: string;
}

/** Custom upload, local runtime: file → user's public/fonts/ + css merge. */
export async function uploadLocalFont(projectId: string, file: File): Promise<LocalUploadedFont> {
  const dir = requireEntryPath(projectId);
  const family = familyFromFileName(file.name);
  const format = fontFormatForFile(file.name);
  const srcUrl = await postFontFile(dir, file.name, file);
  const css = `${buildCustomFontFaceCss(family, '', 400, false, format, srcUrl)}\n${fontClassRuleCss(family)}`;
  const { linked } = await postFontCss(dir, family, css);
  return { family, format, srcUrl, css, warning: linked ? null : LOCAL_FONT_NO_HEAD_WARNING };
}

/** Weight/variable rebake for an uploaded font: same bytes, the family's
 *  marker block in sq-fonts.css is replaced wholesale. */
export async function updateLocalCustomFont(
  projectId: string,
  font: { family: string; format: string; srcUrl: string },
  weight: number,
  variable: boolean,
): Promise<{ css: string }> {
  const dir = requireEntryPath(projectId);
  const css = `${buildCustomFontFaceCss(font.family, '', weight, variable, font.format, font.srcUrl)}\n${fontClassRuleCss(font.family)}`;
  await postFontCss(dir, font.family, css);
  return { css };
}
