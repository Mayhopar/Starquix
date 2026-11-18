/**
 * The post title is the one field a card can never lose (owner 2026-10-09):
 * deleting the element that renders `post.data.title` — or any element
 * containing it — does nothing; Layers shows a lock on it.
 *
 * The delete planner is synchronous, so the card sources it judges by live in
 * a small cache that useProjectCardSources refreshes per scan/sync (card files
 * = components that render collection entries — `post.data.x`, an imported
 * card's `work.data.x`; utils/cardFields.isCardSource). An uncached file is
 * never locked. The same cache tells DesignBar which components are cards and
 * holds each card's collection assignment (utils/cardAssignment, C11) — read
 * by DesignBar (Fields scope) and AssetsPanel (the Blog section).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getElementSource } from '@/vite-plugin/ast-updater';
import { readLocalFile } from '@/utils/localElementSource';
import { fetchLocalPages, fetchLocalPageSource } from '@/utils/localPageSync';
import { entryVarOf, fieldElements, hasSetupBlock, isCardSource, readerOf } from '@/utils/cardFields';
import { assignCards, usageCollections, type CardAssignment } from '@/utils/cardAssignment';
import type { SourceLocation } from '@/store/types';

const CARD_FILE_RE = /^src\/components\/.+\.astro$/;
const sources = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let assignments = new Map<string, CardAssignment>();
let projectFiles: Record<string, string> = {};
let projectPath: string | null = null;

function bump(): void {
  version++;
  for (const l of listeners) l();
}

export function setCardSource(file: string, source: string | null): void {
  const card = source !== null && isCardSource(source) ? source : null;
  if ((sources.get(file) ?? null) === card) return;
  if (card === null) sources.delete(file); else sources.set(file, card);
  bump();
}

/** Replace the cache with the project's components + pages; recompute every card's assignment. */
export function setProjectSources({ files, collections, path = null }: { files: Record<string, string>; collections: readonly string[]; path?: string | null }): void {
  projectFiles = files;
  projectPath = path;
  const components = Object.fromEntries(Object.entries(files).filter(([f]) => CARD_FILE_RE.test(f)));
  sources.clear();
  for (const [f, src] of Object.entries(components)) if (isCardSource(src)) sources.set(f, src);
  assignments = assignCards({ components, usage: usageCollections(files), collections });
  bump();
}

/** A component's collection assignment (`card` tells a card from a list), else null (no collection, or not read yet). */
export const cardAssignmentOf = (file: string): CardAssignment | null => assignments.get(file) ?? null;
export const allCardAssignments = (): ReadonlyMap<string, CardAssignment> => assignments;
/** The last-read components + pages (which files a card move may touch; the write re-reads their bytes). */
export const projectSourcesSnapshot = (): Readonly<Record<string, string>> => projectFiles;
/** The project the snapshot was read from (a project switch leaves the previous one in place until the re-read lands). */
export const projectSourcesPath = (): string | null => projectPath;

/** The cached source of a card component, else null (not a card, or not scanned yet). */
export const cardSourceOf = (file: string): string | null => sources.get(file) ?? null;

function elementAt(loc: SourceLocation): string | null {
  const src = sources.get(loc.file);
  if (!src) return null;
  try { return getElementSource(src, loc).source; } catch { return null; }
}

/** The field the element at `loc` shows (`<h1>{f('title')}</h1>` → 'title'), else null —
 *  the Layers name of a card element (owner 2026-10-11: rows read "image",
 *  "title", not "a"/"div"/"p"). Containers holding several fields → null. */
export function cardFieldAt(loc: SourceLocation): string | null {
  const el = elementAt(loc);
  if (el === null) return null;
  // An image is named by its src field (`alt={work.data.title}` is not what it shows).
  const img = el.match(/^<(?:img|Image|Picture)\b(?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*?\bsrc=\{\s*(?:f\('(\w+)'\)|[\w$]+\.data\.(\w+))/);
  if (img) return img[1] ?? img[2];
  const fields = fieldElements(el, undefined, readerOf(sources.get(loc.file)!));
  return fields.length === 1 && fields[0].start === 0 ? fields[0].field : null;
}

/** Would deleting the element at `loc` remove a card's title? */
export function containsCardTitle(loc: SourceLocation): boolean {
  const el = elementAt(loc);
  const src = sources.get(loc.file)!;
  return el !== null && fieldElements(el, undefined, readerOf(src)).some((e) => e.field === 'title');
}

/** Is the element at `loc` THE title element (the Layers lock)? */
export function isCardTitleElement(loc: SourceLocation): boolean {
  const el = elementAt(loc);
  if (el === null) return false;
  const src = sources.get(loc.file)!;
  const read = hasSetupBlock(src) ? String.raw`f\('title'\)` : String.raw`${entryVarOf(src)}\.data\.title`;
  return new RegExp(String.raw`^<(?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*>\s*\{\s*${read}\s*\}\s*<\/`).test(el);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** Re-render when the lock cache changes (Layers' lock icon). */
export const useCardTitleLockVersion = (): number => useSyncExternalStore(subscribe, () => version);

/**
 * Keeps the cache fresh: reads every user component + every page and feeds
 * setProjectSources. `trigger` = anything that means "files may have changed"
 * (scan version, files-truth sync). Mounted once, in Editor.
 * ponytail: re-reads every component + page per trigger — fine at site sizes
 * here; cache by mtime if a project grows large.
 */
/** At most one full re-read per window, always of the latest state: leading edge, then one trailing run. */
export const CARD_SOURCES_COALESCE_MS = 400;
export function useProjectCardSources(localPath: string | null, componentFiles: readonly string[], collections: readonly string[], trigger: unknown): void {
  const compKey = [...new Set(componentFiles.filter((f) => CARD_FILE_RE.test(f)))].sort().join('|');
  const collKey = [...collections].sort().join('|');
  const lastRun = useRef(0);
  useEffect(() => {
    if (!localPath) return;
    let cancelled = false;
    const run = () => void (async () => {
      lastRun.current = Date.now();
      const pages = (await fetchLocalPages(localPath)).map((p) => p.file).filter((f) => f.endsWith('.astro'));
      const read = await Promise.all([
        ...(compKey ? compKey.split('|') : []).map(async (f) => [f, await readLocalFile(f).catch(() => null)] as const),
        ...[...new Set(pages)].map(async (f) => [f, await fetchLocalPageSource(localPath, f)] as const),
      ]);
      if (cancelled) return;
      setProjectSources({ files: Object.fromEntries(read.filter((e): e is readonly [string, string] => e[1] !== null)), collections: collKey ? collKey.split('|') : [], path: localPath });
    })();
    // Every accepted edit and every mirror pull is a trigger and each run re-reads every page: coalesce a burst.
    const wait = Math.max(0, lastRun.current + CARD_SOURCES_COALESCE_MS - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (wait === 0) run(); else timer = setTimeout(run, wait);
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
  }, [localPath, compKey, collKey, trigger]);
}

export function _resetCardTitleLocksForTests(): void { sources.clear(); assignments = new Map(); projectFiles = {}; projectPath = null; version = 0; }
