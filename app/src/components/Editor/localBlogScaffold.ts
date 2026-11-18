/**
 * task-240 Phase 4: a ⌘K BlogSlot insert into a project with NO content
 * collection scaffolds one — no prompt (design U1): a `blog` entry in the
 * content config (created when the project has none), one post, and the post
 * route `src/pages/blog/[slug].astro` rendered inside the listing page's own
 * layout. Files are truth: three journaled writes through the instance.
 * // ponytail: the scaffold files are not undone by ⌘Z (no file-create undo
 * // op — same precedent as materialized components); the slot insert + bind
 * // are. Shapes follow the site's Astro (utils/siteAstro): content layer on ≥5, legacy below.
 */
import { contentLayerLoader, siteUsesContentLayer } from '@/utils/siteAstro';
import { contentOps } from '@/core/collections/content-ops';
import { detectPostRoute } from '@/utils/blogBinding';
import { importSpecifierFor } from '@/utils/localStructural';
import {
  POST_LAYOUT_FALLBACK_FILE, POST_LAYOUT_FILE, UTILITIES_FILE, planPostLayout, postRouteSource,
} from '@/core/post/postLayoutSource';
import { fetchLocalPageRoutes, fetchLocalPageSource } from '@/utils/localPageSync';
import { readLocalFile, writeLocalFile } from '@/utils/localElementSource';
import { detectPageLayout } from '@/utils/detectPageLayout';

export const BLOG_COLLECTION = 'blog';
const blogDef = (contentLayer: boolean) => `const blog = defineCollection({
${contentLayer ? `  ${contentLayerLoader('blog')},\n` : ''}  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date(),
    image: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});
`;
const GLOB_IMPORT = "import { glob } from 'astro/loaders';\n";
const withGlob = (config: string) => /\bglob\b[^;]*from ['"]astro\/loaders['"]/.test(config) ? config : GLOB_IMPORT + config;

/** `entry` appended to `export const collections = { … }` (null = no such object to extend). */
function withCollectionsEntry(config: string, entry: string): string | null {
  if (!/^export const collections = \{/m.test(config)) return null;
  return config.replace(/(export const collections = \{)([\s\S]*?)(\n?\};)/, (_m, open: string, inner: string, close: string) => {
    const body = inner.replace(/\s+$/, '');
    const sep = body.trim() === '' || body.endsWith(',') ? '' : ',';
    return `${open}${body}${sep}\n  ${entry},${close.startsWith('\n') ? close : `\n${close}`}`;
  });
}

/** The content config with a `blog` collection added (null = no config yet → a new file). */
export function addBlogToContentConfig(existing: string | null, contentLayer = siteUsesContentLayer()): string {
  const def = blogDef(contentLayer);
  if (existing === null) {
    return `import { defineCollection, z } from 'astro:content';\n${contentLayer ? GLOB_IMPORT : ''}\n${def}\nexport const collections = {\n  blog,\n};\n`;
  }
  if (/\bconst blog\s*=/.test(existing) || /\bblog\s*:/.test(existing)) return existing;
  let out = /from ['"]astro:content['"]/.test(existing) ? existing : `import { defineCollection, z } from 'astro:content';\n${existing}`;
  if (contentLayer) out = withGlob(out);
  const exp = out.match(/^export const collections = \{/m);
  if (!exp || exp.index === undefined) return `${out.replace(/\s+$/, '')}\n\n${def}\nexport const collections = {\n  blog,\n};\n`;
  return withCollectionsEntry(out.slice(0, exp.index) + `${def}\n` + out.slice(exp.index), 'blog')!;
}

/** Content layer: a collection exists for Astro only once declared (Astro 4 auto-generated it from the folder). */
export function addCollectionToContentConfig(existing: string | null, name: string): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
  const entry = `${key}: defineCollection({ ${contentLayerLoader(name)} })`;
  if (existing === null) return `import { defineCollection } from 'astro:content';\n${GLOB_IMPORT}\nexport const collections = {\n  ${entry},\n};\n`;
  const declared = new RegExp(`(^|[{,\\s])${key.replace(/[^\w$]/g, '\\$&')}\\s*[:,}]`, 'm');
  const collections = /export const collections = \{([\s\S]*?)\n?\};/.exec(existing)?.[1] ?? '';
  if (declared.test(collections)) return existing;
  let out = withGlob(existing);
  if (!/\bdefineCollection\b[^;]*from ['"]astro:content['"]/.test(out)) out = `import { defineCollection } from 'astro:content';\n${out}`;
  return withCollectionsEntry(out, entry) ?? `${out.replace(/\s+$/, '')}\n\nexport const collections = {\n  ${entry},\n};\n`;
}


import { legacyRouteLayout } from '@/core/post/legacyRoute';

/** A project file's bytes, or null when the instance has no such file. */
const readOrNull = (file: string) => readLocalFile(file).catch(() => null);

/** `created` = the files THIS module wrote (config + route); the post is contentOps' file. */
export type ScaffoldResult = { ok: true; collection: string; post: string; created: string[] } | { ok: false; reason: string };

export async function scaffoldBlogCollection({ pageFile, pageSource }: { pageFile: string; pageSource: string }): Promise<ScaffoldResult> {
  const collection = BLOG_COLLECTION;
  const routeFile = `src/pages/${collection}/[slug].astro`;
  const created: string[] = [];
  try {
    if ((await readOrNull(routeFile)) !== null) return { ok: false, reason: `${routeFile} already exists` };
    // Astro 5 name first, else the legacy (Astro 4) location — created there when neither exists on a legacy site.
    const configFile = siteUsesContentLayer() || (await readOrNull('src/content.config.ts')) !== null ? 'src/content.config.ts' : 'src/content/config.ts';
    const existing = await readOrNull(configFile);
    const next = addBlogToContentConfig(existing);
    if (next !== existing) { await writeLocalFile(configFile, next); created.push(configFile); }
    // contentOps owns the post's path + extension (.md / .mdx per project).
    await contentOps.createPost(collection, 'hello-world', {
      // `image: ''` — the card is bound to it; an empty value shows the image editor at once.
      title: 'Hello world', description: 'Your first post.', date: new Date().toISOString().slice(0, 10), image: '', draft: false,
    }, 'Welcome to your blog — this is your first post. Edit it in the Content tab.\n');
    await writePostRoute(collection, pageFile, pageSource);
    created.push(routeFile);
    return { ok: true, collection, post: 'hello-world', created };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'the scaffold could not be written' };
  }
}

/**
 * The project's PostLayout (design A1): reuse ours when present, write it
 * (wrapping the site layout `site`, a spec relative to `siteFrom`) when not.
 * A user's OWN `src/layouts/PostLayout.astro` is never overwritten — ours
 * goes to `src/layouts/sq/`. Also makes sure the utilities companion exists.
 * Returns the layout file.
 */
export async function ensurePostLayout(site: { name: string; importPath: string } | null, siteFrom: string): Promise<string> {
  const known = new Map<string, string | null>();
  for (const f of [POST_LAYOUT_FILE, POST_LAYOUT_FALLBACK_FILE, UTILITIES_FILE]) known.set(f, await readOrNull(f));
  const plan = planPostLayout((f) => known.get(f), site, siteFrom);
  if (!plan) throw new Error('src/layouts/PostLayout.astro and src/layouts/sq/PostLayout.astro are both your own files');
  for (const [file, text] of Object.entries(plan.writes)) await writeLocalFile(file, text);
  return plan.file;
}

/** Write `src/pages/<collection>/[slug].astro` through PostLayout and announce the new (dynamic) page. */
async function writePostRoute(collection: string, siteFrom: string, siteSource: string, announce = true): Promise<string> {
  const routeFile = `src/pages/${collection}/[slug].astro`;
  const layoutFile = await ensurePostLayout(detectPageLayout(siteSource), siteFrom);
  await writeLocalFile(routeFile, postRouteSource(collection, importSpecifierFor(routeFile, layoutFile)));
  if (announce && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sq:local-page-created', { detail: { route: `/${collection}/[slug]`, file: routeFile, editable: true, dynamic: true } }));
  }
  return routeFile;
}

/**
 * Posts are child pages only when a post route renders them. A collection
 * made in the Content tab, or one a BlogSlot binds to, used to get none — its
 * posts had nowhere to open (owner report 2026-09-28). Writes the route when
 * the project has no `/<collection>/[slug]` (or `[...slug]`); true = written.
 * Routes that cannot be listed → nothing written (never guess).
 */
export async function ensurePostRoute({ collection, projectPath, pageFile, pageSource }: {
  collection: string; projectPath: string; pageFile: string; pageSource: string;
}): Promise<boolean> {
  const routes = await fetchLocalPageRoutes(projectPath).catch(() => null);
  if (!routes) return false;
  const routeFile = `src/pages/${collection}/[slug].astro`;
  const current = await readOrNull(routeFile);
  if (detectPostRoute(collection, routes) || current !== null) {
    // An untouched route WE wrote before PostLayout → upgrade it in place.
    const legacy = current === null ? undefined : legacyRouteLayout(collection, current);
    if (legacy === undefined) return false;
    await writePostRoute(collection, routeFile, current!, false);
    return false;
  }
  await writePostRoute(collection, pageFile, pageSource);
  return true;
}

/**
 * A new files-truth collection (Content tab + AI create_collection): its first
 * entry creates the folder — the user's own content config is never touched —
 * and a post route laid out like the home page makes its posts openable (owner
 * report 2026-09-28). Returns the seed post's slug.
 */
export async function createLocalCollection(name: string, projectPath: string): Promise<string> {
  const slug = `untitled-${Date.now()}`;
  if (siteUsesContentLayer()) {
    const existing = await readOrNull('src/content.config.ts');
    const next = addCollectionToContentConfig(existing, name);
    if (next !== existing) await writeLocalFile('src/content.config.ts', next);
  }
  await contentOps.createPost(name, slug, { title: 'Untitled', date: new Date().toISOString().split('T')[0], description: '' }, '');
  const home = 'src/pages/index.astro';
  await ensurePostRoute({ collection: name, projectPath, pageFile: home, pageSource: (await fetchLocalPageSource(projectPath, home)) ?? '' });
  return slug;
}
