// The runtime: a files-truth project (its Astro folder in Dexie projectFiles,
// mirrored to disk) run by the desktop app and reached over IPC. The
// host-folder disk (`local_` ids, recents, a spawned astro dev) was removed
// 2026-09-10 — docs/plans/2026-09-10-remove-open-local-folder-design.md.

import { slugify } from './slugify';
import { isEditorInfraTag } from './treeUtils';
import { escapeRegex } from './regex';

/** The transport entry for a project: the synthetic `wc://<id>` path (a legacy
 *  name kept because journal payloads carry it). `name` is the id (the editor
 *  never shows it). */
export interface LocalProjectEntry { path: string; name: string }

/**
 * Files-truth projects (2026-08-28 unification): a `browser_` row whose truth
 * is its `projectFiles`. Registered here (not in the id — law: mode never
 * lives in the project id) so every "is this files-truth?" caller of
 * isLocalProjectId is right by construction.
 *
 * Synchronous at editor mount: the Dexie row is async, so a localStorage
 * mirror `sq:files-truth:{id}` is written on create/import and re-asserted
 * from the row by useFilesTruthMirror. A missing or unwritable mirror uses
 * the in-memory marker and reactive runtime resolution, without reloading.
 */
const filesTruthIds = new Set<string>();
const FILES_TRUTH_KEY = (id: string): string => `sq:files-truth:${id}`;

export function markFilesTruth(projectId: string): void {
  filesTruthIds.add(projectId);
  try { localStorage.setItem(FILES_TRUTH_KEY(projectId), '1'); } catch { /* private mode */ }
}

export function unmarkFilesTruth(projectId: string): void {
  filesTruthIds.delete(projectId);
  try { localStorage.removeItem(FILES_TRUTH_KEY(projectId)); } catch { /* private mode */ }
}

/** Is this a files-truth project (the only kind the editor opens)? False only
 *  until the Dexie row has been read (useFilesTruthMirror) or for an unknown id. */
export function isLocalProjectId(projectId: string): boolean {
  if (filesTruthIds.has(projectId)) return true;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FILES_TRUTH_KEY(projectId)) === '1') {
      filesTruthIds.add(projectId);
      return true;
    }
  } catch { /* private mode */ }
  return false;
}

/** The synthetic project path. Only ever echoed as `?path=` / `body.path`,
 *  which the in-instance route table ignores. */
export const filesTruthPath = (projectId: string): string => `wc://${projectId}`;

/** The project id inside a synthetic project path; null for anything else. */
export const projectIdFromPath = (path: string | null | undefined): string | null =>
  path?.startsWith('wc://') ? path.slice('wc://'.length) : null;

/** Deterministic doc-page id for a discovered route — both the doc seeding
 *  (useProjectSync) and the iframe-src mapping (Editor) derive it from the
 *  route with THIS function, so no id↔route table needs to be shared. */
export function localPageId(route: string): string {
  return route === '/' ? 'index' : route.slice(1).replace(/[^a-zA-Z0-9[\]_-]+/g, '-');
}

/** Canvas emptiness comes from the SCAN, with the Layers panel's test for
 *  "No elements on page": nothing but editor infrastructure (the page
 *  wrapper). A single drawn element IS content. Feeds ViewportFrame's isEmpty
 *  (no visible artboard, owner 2026-09-24). Never applies to the lone-component
 *  view (its scan is legitimately tiny). */
export function isLocalScanEmpty(scanned: ReadonlyArray<{ tagName: string }>, isComponentView: boolean): boolean {
  return !isComponentView && !scanned.some((el) => !isEditorInfraTag(el.tagName));
}

/** task-145: the doc page → iframe route mapping for local mode.
 *  A page with no backing file must NEVER fall back to another page's route —
 *  that alias rendered the index under a new page and edits there source-wrote
 *  the real index file (data loss). Order:
 *  1. static route whose localPageId matches
 *  2. discovered dynamic-instance path
 *  3. the dynamic route file itself
 *  4. a route-like page NAME (a just-created file the pages list hasn't refetched)
 *  5. '/' only while the pages list is still empty (boot)
 *  6. otherwise a reserved guaranteed-404 route — honest, nothing writable. */
export function resolveLocalPagePath(opts: {
  currentPageId: string | null;
  currentPageName: string | null;
  pages: Array<{ route: string; dynamic?: boolean }>;
  dynamicInstances: Array<{ paths: string[] }>;
}): string {
  const { currentPageId, currentPageName, pages, dynamicInstances } = opts;
  const filePage = pages.find(p => localPageId(p.route) === currentPageId);
  if (filePage && !filePage.dynamic) return filePage.route;
  for (const inst of dynamicInstances) {
    const hit = inst.paths.find(p => localPageId(p) === currentPageId);
    if (hit) return hit;
  }
  if (filePage) return filePage.route;
  if (currentPageName?.startsWith('/')) return currentPageName;
  if (pages.length === 0) return '/';
  return `/__sq_missing_page/${currentPageId ?? 'page'}`;
}

/** task-133: the doc page → backing FILE mapping for structural writes.
 *  Same matching as resolveLocalPagePath but returns the project-relative
 *  src/pages file. A dynamic instance maps to the dynamic ROUTE file (the one
 *  file that renders every slug). Component view overrides with the
 *  component's own file. null = no backing file → no structural target
 *  (never alias another page's file — task-145 law). */
export function resolveLocalPageFile(opts: {
  currentPageId: string | null;
  pages: Array<{ route: string; file: string; dynamic?: boolean }>;
  dynamicInstances: Array<{ route: string; paths: string[] }>;
  componentViewFile?: string | null;
}): string | null {
  const { currentPageId, pages, dynamicInstances, componentViewFile } = opts;
  if (componentViewFile) return componentViewFile;
  if (!currentPageId) return null;
  const filePage = pages.find(p => localPageId(p.route) === currentPageId);
  if (filePage) return filePage.file;
  for (const inst of dynamicInstances) {
    if (inst.paths.some(p => localPageId(p) === currentPageId)) {
      return pages.find(pg => pg.route === inst.route)?.file ?? null;
    }
  }
  return null;
}

/** task-148: THE page-delete rule. Local page delete removes a REAL file and
 *  ⌘Z cannot unwrite it, so the confirm modal (what the user is told) and the
 *  endpoint (what actually gets rm'd) resolve the target through this ONE
 *  function — a drift between them would delete a file the user never saw.
 *  Refusals, all deliberate:
 *   - last page: a site needs one, and the doc's DELETE_PAGE refuses too
 *   - dynamic route: one file renders every instance — a per-slug delete is
 *     a content operation, not a page delete
 *   - md/mdx: listed but not editable (P0), so they stay out of a destructive
 *     path the editor cannot preview
 *   - unknown / ambiguous id: never guess which file to remove (task-145
 *     no-alias law, applied to rm). */
export interface LocalPageRef { route: string; file: string; dynamic?: boolean }
export type LocalPageDeletion =
  | { ok: true; route: string; file: string }
  | { ok: false; error: string };

export function resolveLocalPageDeletion(pages: LocalPageRef[], pageId: string): LocalPageDeletion {
  if (pages.length <= 1) {
    return { ok: false, error: 'This is the last page — a site needs at least one.' };
  }
  const matches = pages.filter(p => localPageId(p.route) === pageId);
  if (matches.length === 0) {
    return { ok: false, error: 'No page file matches this page — nothing to delete.' };
  }
  if (matches.length > 1) {
    return { ok: false, error: `More than one file matches this page (${matches.map(m => m.file).join(', ')}) — delete it from your editor.` };
  }
  const page = matches[0];
  if (page.dynamic) {
    return { ok: false, error: `${page.file} is a dynamic route — it renders every instance, so deleting it here is refused.` };
  }
  if (!page.file.endsWith('.astro')) {
    return { ok: false, error: `${page.file} is not a .astro page — delete it from your editor.` };
  }
  return { ok: true, route: page.route, file: page.file };
}

/** THE id→transport-path resolution. null = not (yet) a files-truth project —
 *  the Dexie mirror has not resolved, or the id is unknown. */
export function findLocalProjectEntry(projectId: string): LocalProjectEntry | null {
  if (isLocalProjectId(projectId)) return { path: filesTruthPath(projectId), name: projectId };
  return null;
}

/** THE src/pages file → route mapping (client twin of sq-project-fs.js
 *  routeForPageFile — parity-tested). */
export function routeForPageFile(relFile: string): string {
  const rel = relFile.replace(/\\/g, '/').replace(/^src\/pages\//, '');
  const dot = rel.lastIndexOf('.');
  const slash = rel.lastIndexOf('/');
  let route = '/' + (dot > slash ? rel.slice(0, dot) : rel);
  // task-240: `[...page].astro` (pagination) is its parent route — one static page.
  route = route.replace(/\/\[\.\.\.page\]$/, '') || '/';
  return route.endsWith('/index') ? route.slice(0, -'/index'.length) || '/' : route;
}

/** Client twin of sq-project-fs.js discoverLocalPages over a PATH LIST — the
 *  files-truth seed reads the Dexie projectFiles keys before any instance
 *  is up (no network on first render). Same order, same fields. */
export function discoverPagesFromPaths(paths: string[]): LocalPageRef[] & Array<{ editable: boolean }> {
  const pages: Array<LocalPageRef & { editable: boolean }> = [];
  for (const raw of paths) {
    const file = raw.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!file.startsWith('src/pages/')) continue;
    const ext = file.slice(file.lastIndexOf('.'));
    if (!['.astro', '.md', '.mdx'].includes(ext)) continue;
    const route = routeForPageFile(file);
    const page: LocalPageRef & { editable: boolean } = { route, file, editable: ext === '.astro' };
    if (route.includes('[')) page.dynamic = true;
    pages.push(page);
  }
  return pages.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));
}

/** Thrown/shown only on the race before the files-truth mirror resolves. */
export const PROJECT_NOT_READY = 'Project files are not ready yet.';

/** task-143: THE dynamic-route matcher — '[param]' → one segment, '[...rest]'
 *  → anything. Shared by slug discovery (useLocalInstance) and the usage
 *  picker (FillBlock) so the matching semantics can't drift. Tolerates a
 *  trailing slash. */
export function dynamicRoutePattern(route: string): RegExp {
  return new RegExp(
    '^' + route.split(/(\[[^\]]*\])/).map(seg =>
      seg.startsWith('[...') ? '.+' : seg.startsWith('[') ? '[^/]+' : escapeRegex(seg),
    ).join('') + '/?$',
  );
}

/** task-143: where component default-image bytes live (importable, so astro
 *  <Image> gets ImageMetadata). Written by the server endpoint, sniffed by
 *  the Fill block's surface classification — ONE constant for both. */
export const SQ_DEFAULTS_DIR = 'src/assets/sq-defaults';

/**
 * "Go to post" target for a LOCAL page: a seeded dynamic-instance page is
 * named by its route ('/works/timepad-redesign', or deeper — owner's
 * '/test collection/posts/untitled-1' from src/pages/test collection/posts/
 * [...slug].astro). The LAST segment is the slug; the collection must be
 * named by one of the segments before it and hold a post with that
 * slugified slug. Null for every other page.
 */
export function localPostTargetFor(
  pageName: string | null | undefined,
  collections: ReadonlyArray<{ name: string; posts: ReadonlyArray<{ slug: string }> }>,
): { collection: string; slug: string } | null {
  const segments = (pageName ?? '').split('/').filter(Boolean).map(seg => { try { return decodeURIComponent(seg); } catch { return seg; } });
  if (segments.length < 2) return null;
  const last = segments.pop()!;
  const named = new Set(segments.map(slugify));
  for (const collection of collections) {
    if (!named.has(slugify(collection.name))) continue;
    const post = collection.posts.find(p => slugify(p.slug) === slugify(last));
    if (post) return { collection: collection.name, slug: post.slug };
  }
  return null;
}
