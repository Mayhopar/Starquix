/**
 * IO for page SEO: read the page's head chain from the project, write an edit
 * as ONE durable batch (one ⌘Z), and read the RENDERED head (what search
 * engines and share cards see) for the previews.
 */
import { readLocalFile, rewriteLocalFile, rewriteLocalFiles, type FileWriteSnapshot } from '@/utils/localElementSource';
import { chainFiles, editPageSeo, editSiteHead, editStructuredData, readStructuredData, type StructuredDataState, readFrontmatter, readPageSeo, readSiteHead, type PageSeoField, type PageSeoState, type PostRef, type SiteHeadField, type SiteHeadState } from './headSeo';
import { readSiteConfig, setSiteAddress, setSitemap, setPackageDep, robotsTxt, sitemapUrlOf, SITEMAP_PKG, SITEMAP_RANGE } from './siteConfig';
import { addFieldToContentConfig } from '@/core/collections/contentConfigSchema';

const readOrNull = (file: string) => readLocalFile(file).catch(() => null);
const CONTENT_CONFIGS = ['src/content.config.ts', 'src/content/config.ts', 'src/content.config.mjs', 'src/content/config.mjs', 'src/content.config.js', 'src/content/config.js'];

/** The post a dynamic route shows at `route` (its markdown file), or null. */
export async function resolvePostRef(route: string | null): Promise<PostRef | null> {
  if (!route) return null;
  const [{ contentOps }, { localPostTargetFor }] = await Promise.all([import('@/core/collections/content-ops'), import('@/utils/localMode')]);
  const collections = await contentOps.fetchCollections().catch(() => []);
  const hit = localPostTargetFor(route, collections);
  if (!hit) return null;
  const post = collections.find((c) => c.name === hit.collection)?.posts.find((p) => p.slug === hit.slug);
  if (!post) return null;
  const at = post.filePath.indexOf('src/');
  return { file: at >= 0 ? post.filePath.slice(at) : post.filePath, collection: hit.collection };
}

async function sourcesFor(pageFile: string, post?: PostRef | null): Promise<Record<string, string | null>> {
  const sources = await chainFiles(pageFile, readOrNull);
  if (post) sources[post.file] = await readOrNull(post.file);
  return sources;
}

export async function loadPageSeo(pageFile: string, post?: PostRef | null): Promise<PageSeoState> {
  return readPageSeo(await sourcesFor(pageFile, post), pageFile, post);
}

/**
 * Write one field. The edit is recomputed on the projected before-bytes inside
 * the gesture, so an outside edit in between is merged, never clobbered. On a
 * post, a field the collection's schema does not declare is declared in the
 * same batch (a strict schema would strip it). Returns the files written.
 */
export async function savePageSeo(pageFile: string, field: PageSeoField, input: string | boolean, snapshot?: FileWriteSnapshot, post?: PostRef | null): Promise<string[]> {
  // A share image must be an absolute URL for most networks: a site path becomes one when the site address is known.
  let value = input;
  if (field === 'image' && typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    const { site } = readSiteConfig((await readConfig())?.src ?? null);
    if (site) value = new URL(value, `${site}/`).href;
  }
  const sources = await sourcesFor(pageFile, post);
  const configs = post ? await Promise.all(CONTENT_CONFIGS.map(async (f) => [f, await readOrNull(f)] as const)) : [];
  const config = configs.find(([, src]) => src !== null)?.[0];
  const files = [...Object.keys(sources).filter((f) => sources[f] !== null), ...(config ? [config] : [])];
  return rewriteLocalFiles(files, (before) => {
    const out = editPageSeo(before, pageFile, field, value, post);
    if (post && config && out[post.file] && before[config]) {
      const had = readFrontmatter(before[post.file] ?? '');
      let cfg = before[config]!;
      // Every field this edit set must survive the collection's schema (idempotent for declared ones).
      for (const [key, v] of Object.entries(readFrontmatter(out[post.file]))) {
        if (had[key] !== v) cfg = addFieldToContentConfig(cfg, post.collection, key, typeof v === 'boolean' ? 'boolean' : 'text');
      }
      if (cfg !== before[config]) out[config] = cfg;
    }
    return out;
  }, snapshot);
}

export interface RenderedHead {
  title: string;
  description: string;
  image: string;
  url: string;
}

/** Parse a page's HTML head (pure; DOMParser). */
function parseRenderedHead(html: string): RenderedHead {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() ?? '';
  return {
    title: doc.querySelector('title')?.textContent?.trim() ?? '',
    description: meta('meta[name="description"]'),
    image: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'),
    url: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? meta('meta[property="og:url"]'),
  };
}

/** The page as the instance renders it right now; null when it cannot be fetched. */
export async function fetchRenderedHead(route: string): Promise<RenderedHead | null> {
  const { desktopDriver, isDesktop } = await import('@/services/desktopDriver');
  if (!isDesktop()) return null;
  const r = await desktopDriver.fetchDocument(route, { headers: { Accept: 'text/html' } }).catch(() => null);
  if (!r?.ok) return null;
  return parseRenderedHead(await r.text());
}

// ── site settings ───────────────────────────────────────────────────────────

const CONFIG_FILES = ['astro.config.mjs', 'astro.config.ts', 'astro.config.mts', 'astro.config.js', 'astro.config.cjs'];

async function readConfig(): Promise<{ file: string; src: string } | null> {
  for (const file of CONFIG_FILES) { const src = await readOrNull(file); if (src !== null) return { file, src }; }
  return null;
}

/** Every page file of the open project (dynamic routes included: their heads are layouts). */
async function projectPageFiles(): Promise<string[]> {
  const [{ getActiveSaveProjectId }, { findLocalProjectEntry }, { fetchLocalPages }] = await Promise.all([
    import('@/services/pendingProjectMutations'), import('@/utils/localMode'), import('@/utils/localPageSync')]);
  const path = findLocalProjectEntry(getActiveSaveProjectId() ?? '')?.path;
  if (!path) return [];
  return [...new Set((await fetchLocalPages(path)).map((p) => p.file).filter((f) => f.endsWith('.astro')))];
}

async function headSources(pages: string[]): Promise<Record<string, string | null>> {
  // Every page's chain at once; the shared layout is read once (the promise cache).
  const cache = new Map<string, Promise<string | null>>();
  const read = (f: string) => { if (!cache.has(f)) cache.set(f, readOrNull(f)); return cache.get(f)!; };
  return Object.assign({}, ...await Promise.all(pages.map((p) => chainFiles(p, read))));
}

export interface SiteSeoState {
  site: string;
  sitemap: boolean;
  configFile: string | null;
  head: Record<SiteHeadField, SiteHeadState>;
}

export async function loadSiteSeo(): Promise<SiteSeoState> {
  const [config, pages] = await Promise.all([readConfig(), projectPageFiles()]);
  const { site, sitemap } = readSiteConfig(config?.src ?? null);
  return { site, sitemap, configFile: config?.file ?? null, head: readSiteHead(await headSources(pages), pages) };
}

/** favicon / language / site name / X handle → every head of the project, one batch, one ⌘Z. */
export async function saveSiteHead(field: SiteHeadField, value: string, snapshot?: FileWriteSnapshot): Promise<string[]> {
  const pages = await projectPageFiles();
  const sources = await headSources(pages);
  const files = Object.keys(sources).filter((f) => sources[f] !== null);
  return rewriteLocalFiles(files, (before) => editSiteHead(before, pages, field, value), snapshot);
}

async function writeRobots(site: string, on: boolean): Promise<void> {
  const before = await readOrNull('public/robots.txt');
  const next = robotsTxt(before, on && site ? sitemapUrlOf(site) : null);
  if (next !== null && next !== before) await rewriteLocalFile('public/robots.txt', () => next);
}

/** `site:` in astro.config (Astro's own setting). Restarts the dev server (Astro reloads its config). */
export async function saveSiteAddress(url: string): Promise<string> {
  const config = await readConfig();
  if (!config) throw new Error('This project has no astro.config file');
  let next = config.src;
  await rewriteLocalFile(config.file, (before) => (next = setSiteAddress(before ?? config.src, url)));
  const { site, sitemap } = readSiteConfig(next);
  if (sitemap) await writeRobots(site, true);
  return site;
}

/** The sitemap: @astrojs/sitemap in astro.config + package.json (Vercel installs it), robots.txt points at it. */
export async function saveSitemap(on: boolean): Promise<void> {
  const config = await readConfig();
  if (!config) throw new Error('This project has no astro.config file');
  const { site } = readSiteConfig(config.src);
  if (on && !site) throw new Error('Set the site address first — the sitemap lists full URLs');
  await rewriteLocalFile('package.json', (before) => setPackageDep(before ?? '{}', SITEMAP_PKG, on ? SITEMAP_RANGE : null));
  await rewriteLocalFile(config.file, (before) => setSitemap(before ?? config.src, on));
  await writeRobots(site, on);
}

/** After a publish: the live address becomes the site address when none is set (owner D5). */
export async function ensureSiteAddress(liveUrl: string | null | undefined): Promise<void> {
  if (!liveUrl) return;
  const config = await readConfig();
  if (!config || readSiteConfig(config.src).site) return;
  await saveSiteAddress(new URL(liveUrl).origin);
}

// ── structured data ─────────────────────────────────────────────────────────

export async function loadStructuredData(pageFile: string, posts = false): Promise<StructuredDataState> {
  return readStructuredData(await chainFiles(pageFile, readOrNull), pageFile, posts);
}

/** The page's JSON-LD block ('' removes it; on a post route 'on'/'' toggles the per-post BlogPosting). */
export async function saveStructuredData(pageFile: string, json: string, snapshot?: FileWriteSnapshot, posts = false): Promise<string[]> {
  const sources = await chainFiles(pageFile, readOrNull);
  return rewriteLocalFiles(Object.keys(sources).filter((f) => sources[f] !== null), (before) => editStructuredData(before, pageFile, json, posts), snapshot);
}
