import { load as yamlLoad, dump as yamlDump, JSON_SCHEMA } from 'js-yaml';
import type { DiscoveredCollection, PostMeta, ContentCollection, FieldType } from './types';
import { localFetch } from '../../utils/sqLocalBase';
import { acceptPostFileChange } from '@/services/durableEdits/postCrudAcceptance';
import type { MutationSnapshot } from '@/store/documentMutation';
import { acceptPostWrite } from '@/services/durableEdits/featureAcceptance';
import { acceptCollectionFieldChange } from '@/services/durableEdits/collectionAcceptance';
import { mergeText } from '@/services/durableEdits/rebase';
import { readOnlyFrontmatterKeys } from '@/postmodel/frontmatterCapabilities';
import { contentEntryOf } from './postFileName';
import { requiredFieldsIn } from './contentConfigSchema';
import { postSourceParts, changedFrontmatter, equalPostValue, prepareFrontmatterPatch, prepareFrontmatterRemoval, applyPreparedPostPatch, PostSourceConflict, type PostUpdateOptions } from '@/postmodel/frontmatterPatch';

// --- Frontmatter helpers ---
// Display parsing is real YAML (imported-adoption Task 2.2): arbitrary
// imported frontmatter — nested maps, block scalars, block lists — must not
// be mangled by a line parser. Existing-file writes use validated disjoint
// source patches; this representation is for display and change detection.

/**
 * A frontmatter value the editor will not edit: anything non-scalar beyond a
 * flat scalar array. Carries the value's own YAML so display shows the truth
 * and re-serialization reproduces it instead of destroying it.
 * FrontmatterForm renders these as read-only chips in extraKeys.
 */
export interface RawFrontmatterValue { raw: string }

export function isRawFrontmatterValue(v: unknown): v is RawFrontmatterValue {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && typeof (v as RawFrontmatterValue).raw === 'string'
    && Object.keys(v as object).length === 1;
}

function toDisplayValue(v: unknown): unknown {
  const scalar = (x: unknown) =>
    x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';
  if (scalar(v)) return v;
  if (Array.isArray(v) && v.every(scalar)) return v;
  return { raw: yamlDump(v).trimEnd() };
}

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  let parts: ReturnType<typeof postSourceParts>;
  try { parts = postSourceParts(raw); } catch { return { frontmatter: {}, body: raw }; }
  if (!parts.opener) return { frontmatter: {}, body: raw };
  const match = [raw, parts.yaml, parts.body];

  // JSON_SCHEMA on purpose: date-like values stay STRINGS (gap 18 — the field
  // inference and date inputs are built on string dates, never Date objects).
  try {
    const loaded = yamlLoad(match[1], { schema: JSON_SCHEMA });
    if (loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded)) {
      const frontmatter: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(loaded as Record<string, unknown>)) {
        frontmatter[k] = toDisplayValue(v);
      }
      return { frontmatter, body: match[2] };
    }
  } catch {
    // fall through to the legacy line parser — posts written by
    // serializeFrontmatter must keep parsing even when hand-edits broke YAML
  }
  return legacyParseFrontmatter(match[1], match[2]);
}

function legacyParseFrontmatter(block: string, body: string): { frontmatter: Record<string, unknown>; body: string } {
  const frontmatter: Record<string, unknown> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const str = line.slice(idx + 1).trim();
    if (str.startsWith('"') && str.endsWith('"')) {
      // Written by serializeFrontmatter as a JSON string — unescape the same
      // way; fall back to a bare slice for hand-written YAML.
      try {
        frontmatter[key] = JSON.parse(str);
      } catch {
        frontmatter[key] = str.slice(1, -1);
      }
    } else if (str.startsWith("'") && str.endsWith("'"))
      frontmatter[key] = str.slice(1, -1);
    else if (str.startsWith('[') && str.endsWith(']')) {
      const inner = str.slice(1, -1).trim();
      frontmatter[key] = inner === '' ? [] : inner.split(',').map(s => {
        const t = s.trim();
        return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
          ? t.slice(1, -1)
          : t;
      });
    }
    else if (str === 'true') frontmatter[key] = true;
    else if (str === 'false') frontmatter[key] = false;
    else frontmatter[key] = str;
  }
  return { frontmatter, body };
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => {
    // Read-only imported value: reproduce its own YAML verbatim.
    if (isRawFrontmatterValue(v)) {
      return yamlDump({ [k]: yamlLoad(v.raw, { schema: JSON_SCHEMA }) }).trimEnd();
    }
    if (v instanceof Date) return `${k}: ${v.toISOString().split('T')[0]}`;
    if (Array.isArray(v)) {
      return `${k}: [${v.map(item => JSON.stringify(String(item))).join(', ')}]`;
    }
    // JSON strings are valid YAML double-quoted scalars — newlines and quotes
    // arrive escaped instead of breaking the block (Enter-in-subtitle bug).
    if (typeof v === 'string') return `${k}: ${JSON.stringify(v)}`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** A key whose posts carry NO value yet reads as an image field by its name (`cover`, `coverImage`, `thumbnail`, …). */
const IMAGE_FIELD_NAME_RE = /image|img|photo|picture|cover|thumb|hero|banner|avatar|icon|logo|poster/i;

function inferFieldsFromPosts(posts: PostMeta[]): Array<{ name: string; type: string }> {
  const fieldMap = new Map<string, Set<string>>();
  for (const post of posts) {
    for (const [key, value] of Object.entries(post.frontmatter)) {
      // Raw (non-scalar imported) values are not editable fields — leaving
      // them out of the schema routes them to FrontmatterForm's extraKeys,
      // where they render as read-only chips.
      if (isRawFrontmatterValue(value)) continue;
      if (!fieldMap.has(key)) fieldMap.set(key, new Set());
      const types = fieldMap.get(key)!;
      // An EMPTY value ('' / null: the field exists, this post has none yet)
      // casts no vote — "+ Add field" writes '' into every post, and an image
      // field whose other posts are still empty must stay an image field.
      if (value === '' || value === null || value === undefined) continue;
      if (value instanceof Date) types.add('date');
      else if (typeof value === 'boolean') types.add('boolean');
      else if (typeof value === 'string') {
        // ISO date STRINGS too, not only Date instances — parseFrontmatter never
        // produces a Date, so `date: 2026-08-10` inferred as 'text' and local
        // (files-truth) date fields lost their date input (gap 18).
        if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value))
          types.add('date');
        else if (/\.(jpg|jpeg|png|gif|svg|webp|avif)$/i.test(value) || value.startsWith('/images/') || value.startsWith('/uploads/'))
          types.add('image');
        else if (/^https?:\/\//.test(value)) types.add('url');
        else types.add('text');
      }
      else if (Array.isArray(value)) types.add('list');
      else types.add('text');
    }
  }
  return Array.from(fieldMap.entries()).map(([name, types]) => ({
    name,
    type: types.size === 1 ? types.values().next().value! : types.size === 0 && IMAGE_FIELD_NAME_RE.test(name) ? 'image' : 'text',
  }));
}

/**
 * Frontmatter for a NEW post, shaped like the collection's EXISTING posts.
 * The old hardcoded {title, date, description} triple broke any files-truth
 * collection whose schema wants more — a required `pubDate` got no value →
 * InvalidContentEntryDataError → Astro's error overlay covered every route
 * ("everything stops displaying", 2026-08-14). Every inferred field gets a
 * type-correct default; dates get today because z.coerce.date('') is Invalid.
 * The reserved slug override is omitted so Astro derives it from the filename.
 * An empty collection has nothing to infer from → the triple stays.
 */
export function newPostFrontmatter(posts: PostMeta[]): Record<string, unknown> {
  const today = new Date().toISOString().split('T')[0];
  const fields = inferFieldsFromPosts(posts);
  if (fields.length === 0) return { title: '', date: today, description: '' };
  // Empty title on purpose: the editor autofocuses it and the first title
  // save renames the file from untitled-* to the slug.
  const fm: Record<string, unknown> = { title: '' };
  for (const f of fields) {
    // Even '' overrides Astro's generated slug, making every new post collide.
    // Explicit user values still pass unchanged through create/update/rename.
    if (f.name === 'title' || f.name === 'slug') continue;
    fm[f.name] =
      f.type === 'date' ? today
      : f.type === 'boolean' ? false
      : f.type === 'list' ? []
      : '';
  }
  return fm;
}

function sortPostsByDateDesc(posts: PostMeta[]): void {
  posts.sort((a, b) => {
    const da = a.frontmatter.date ? new Date(String(a.frontmatter.date)).getTime() : 0;
    const db = b.frontmatter.date ? new Date(String(b.frontmatter.date)).getTime() : 0;
    return db - da;
  });
}

function collectionsFromFiles(files: Record<string, string>): DiscoveredCollection[] {
  const byCollection = new Map<string, PostMeta[]>();
  for (const [filePath, raw] of Object.entries(files)) {
    // Slug may contain '/' — real themes nest entries (imported-adoption C1/C3:
    // astro-paper src/content/posts/<sub>/, astro-sphere per-post folders).
    // Loose files at the content ROOT (src/content/about.md) stay dropped.
    const entry = contentEntryOf(filePath);
    if (!entry) continue;
    const { frontmatter, body } = parseFrontmatter(raw);
    const readOnlyPropertyKeys = readOnlyFrontmatterKeys(raw, frontmatter);
    const posts = byCollection.get(entry.collection) || [];
    posts.push({ slug: entry.slug, frontmatter, body, filePath, ...(readOnlyPropertyKeys.length ? { readOnlyPropertyKeys } : {}) });
    byCollection.set(entry.collection, posts);
  }
  return Array.from(byCollection.entries()).map(([name, posts]) => {
    sortPostsByDateDesc(posts);
    return { name, posts, inferredFields: inferFieldsFromPosts(posts) };
  });
}

// --- Local-mode (task-138) files-truth operations ---
// Editor arms this with the project's transport path (`wc://<id>`); reads go
// through the instance's /__sq/local/content route overlaid with the accepted
// journal, writes through the durable acceptance owners. The project's own
// files ARE the durable source of truth by design.

let localContentPath: string | null = null;

export function setLocalContentSource(dirPath: string | null): void {
  localContentPath = dirPath;
}

/** True when the editor armed a files-truth project (files are truth).
 *  The UI predicate for the files-truth field ops below — a local project has
 *  no Yjs collection, so `collectionId` alone reads as "read-only" there. */
export function hasLocalContentSource(): boolean {
  return localContentPath !== null;
}

/** The content config's path + bytes (Astro 5 name first, then the legacy location), or null when the project has none. */
export const CONTENT_CONFIG_FILES = ['src/content.config.ts', 'src/content/config.ts'] as const;
export async function readLocalContentConfig(): Promise<{ file: string; content: string } | null> {
  for (const file of CONTENT_CONFIG_FILES) {
    const r = await localFetch(`/__sq/local/file?file=${encodeURIComponent(file)}&probe=1`);
    if (r.status === 404 || r.headers.get('x-sq-missing') === '1') continue;
    if (r.ok) return { file, content: await r.text() };
    throw new Error(`The content config could not be read (${r.status}).`);
  }
  return null;
}

/** The fields `collection`'s own schema requires — a post cannot drop them. No config or no declaration → none. */
export async function readRequiredLocalFields(collection: string): Promise<string[]> {
  const config = await readLocalContentConfig();
  return config ? requiredFieldsIn(config.content, collection) : [];
}

async function localFetchCollections(dirPath: string): Promise<DiscoveredCollection[]> {
  const readDisk = async (): Promise<Record<string, string> | null> => {
    const resp = await localFetch(`/__sq/local/content?path=${encodeURIComponent(dirPath)}`);
    return resp.ok ? ((await resp.json()) as { files: Record<string, string> }).files : null;
  };
  const projectId = dirPath.slice(5);
  const { inspectAcceptedProject } = await import('@/services/durableEdits/acceptance');
  const { withProjectedSource, projectedSourceFiles } = await import('@/services/durableEdits/projectedSource');
  // The disk is read INSIDE the window, after the journal rows are frozen: a
  // row the worker materialized by then is on disk, a still-pending row is
  // projected. Reading the disk first left a post accepted-but-not-yet-written
  // invisible (2026-09-16: the auto-bound BlogSlot's Collection showed "None"
  // because every refetch fired by createPost landed in that ~100ms gap).
  const files = await inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision, async () => {
    const files = await readDisk();
    if (!files) return null;
    for (const change of projectedSourceFiles(projectId)) if (change.file.startsWith('src/content/') && /\.mdx?$/.test(change.file)) {
      if (change.afterSource === null) delete files[change.file]; else files[change.file] = change.afterSource;
    }
    return files;
  }));
  return files ? collectionsFromFiles(files) : [];
}

/** Surgical deletion with the same semantic and source validation as edits. */
export function removeFrontmatterKey(raw: string, key: string): string | null {
  const patch = prepareFrontmatterRemoval(raw, key);
  return patch.edits.length ? applyPreparedPostPatch(raw, patch) : null;
}

/** A fresh read protects the transport gap; the successful editor baseline
 * separates the editor's own changes from outside ones (an agent): those merge,
 * and where both touched the same property or characters the outside (newer)
 * version stays — agent multiplayer, owner 2026-11-08 (ledger D). */
export function preparePostUpdate(raw: string, frontmatter: Record<string, unknown>, body: string, options?: PostUpdateOptions) {
  const current = parseFrontmatter(raw);
  const before = options?.baseline ?? current;
  const unresolved = options?.unresolvedAttempts ?? [];
  const changes = changedFrontmatter(before.frontmatter, frontmatter);
  const affected = new Set(Object.keys(changes));
  const has = (fields: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(fields, key);
  const sameField = (left: Record<string, unknown>, right: Record<string, unknown>, key: string) =>
    has(left, key) === has(right, key) && equalPostValue(left[key], right[key]);
  for (const attempt of unresolved) {
    for (const key of new Set([...Object.keys(before.frontmatter), ...Object.keys(attempt.frontmatter)])) {
      if (!sameField(before.frontmatter, attempt.frontmatter, key)) affected.add(key);
    }
  }
  // A key the candidate dropped since the baseline is removed (Delete on a property). Only against a
  // baseline: a caller without one (structural undo's `{}`) sends values, not the whole frontmatter.
  if (options?.baseline) for (const key of Object.keys(before.frontmatter)) if (!has(frontmatter, key)) affected.add(key);
  const removals: string[] = [];
  for (const key of affected) {
    if (!sameField(current.frontmatter, before.frontmatter, key)
      && !sameField(current.frontmatter, frontmatter, key)
      && !unresolved.some(attempt => attempt.canReconcileCandidate && sameField(current.frontmatter, attempt.frontmatter, key))) {
      if (unresolved.length) throw new PostSourceConflict(); // its bytes are unknown: stay strict
      delete changes[key]; // changed outside since the baseline: the newer value stays (D5)
      continue;
    }
    if (has(frontmatter, key)) Object.defineProperty(changes, key, { value: frontmatter[key], enumerable: true });
    else removals.push(key);
  }
  // Any uncertain whole-file mutation can leave a partial body, even when
  // its intended edit only touched a property. Verify it before releasing work.
  const bodyAffected = !options?.baseline || body !== before.body || unresolved.length > 0;
  let nextBody = bodyAffected ? body : undefined;
  if (bodyAffected && current.body !== before.body && current.body !== body
    && !unresolved.some(attempt => attempt.canReconcileCandidate && attempt.body === current.body)) {
    // An outside writer (an agent in the terminal) changed the body since the
    // editor's baseline: the editor's own changes land around it, and the same
    // characters keep the outside (newer) text (D3). An unresolved write stays strict.
    if (unresolved.length) throw new PostSourceConflict();
    nextBody = mergeText(before.body, body, current.body);
  }
  const patch = prepareFrontmatterPatch(raw, changes);
  for (const key of removals) patch.edits.push(...prepareFrontmatterRemoval(raw, key).edits);
  patch.edits.sort((a, b) => a.start - b.start);
  return { patch, nextBody };
}

// --- Public API ---

const NO_PROJECT = 'No project is open — the content files are not available yet.';

/** The armed project path (`wc://<id>`), or the no-project refusal. */
function armedProject(): string {
  if (!localContentPath) throw new Error(NO_PROJECT);
  return localContentPath;
}

export const contentOps = {
  async fetchCollections(): Promise<DiscoveredCollection[]> {
    // No project armed yet (the editor arms it on open): nothing to list.
    return localContentPath ? localFetchCollections(localContentPath) : [];
  },

  async createPost(collection: string, slug: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
    await acceptPostFileChange(armedProject(), collection, { action: 'create', slug, frontmatter, body });
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  async updatePost(collection: string, slug: string, frontmatter: Record<string, unknown>, body: string, options?: PostUpdateOptions): Promise<void> {
    // Capture the owner before an await; a project switch must never retarget a write.
    const dir = armedProject();
    await acceptPostWrite(dir.slice(5), collection, slug, frontmatter, body, options);
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  /** Renames consume accepted bytes. */
  async renamePost(collection: string, oldSlug: string, newSlug: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
    await acceptPostFileChange(armedProject(), collection, { action: 'rename', slug: oldSlug, newSlug, frontmatter, body });
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  /** `snapshot` = the editor's claimed undo: ⌘Z brings the exact bytes back (owner: delete anything AND undo). */
  async deletePost(collection: string, slug: string, snapshot?: MutationSnapshot): Promise<void> {
    await acceptPostFileChange(armedProject(), collection, { action: 'delete', slug }, snapshot);
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  async deleteCollection(collection: string, snapshot?: MutationSnapshot): Promise<void> {
    await acceptPostFileChange(armedProject(), collection, { action: 'delete-collection' }, snapshot);
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  /**
   * "+ Add field" (gap 18): write the new key with a default value into every
   * post file of the collection that lacks it — inferFieldsFromPosts then
   * discovers it. The post patches and a surgical schema declaration are
   * accepted in one durable revision; source materialization follows
   * asynchronously. No project armed → no-op.
   */
  async addLocalCollectionField(collection: string, name: string, defaultValue: unknown, type: FieldType = 'text'): Promise<void> {
    const dir = localContentPath;
    if (!dir) return;
    await acceptCollectionFieldChange(dir, collection, { action: 'add', name, defaultValue, type });
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  /**
   * Field delete (gap 18): remove the key from every post file in the
   * collection via surgical edits (and undeclare it in the content config).
   * Posts without the key are left untouched. No project armed → no-op.
   */
  async removeLocalCollectionField(collection: string, name: string, snapshot?: MutationSnapshot): Promise<void> {
    const dir = localContentPath;
    if (!dir) return;
    await acceptCollectionFieldChange(dir, collection, { action: 'remove', name }, snapshot);
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  /** Appends `.optional()` to the field's declaration in the content config (posts untouched). */
  async makeLocalCollectionFieldOptional(collection: string, name: string, snapshot?: MutationSnapshot): Promise<void> {
    const dir = localContentPath;
    if (!dir) return;
    await acceptCollectionFieldChange(dir, collection, { action: 'optional', name }, snapshot);
    window.dispatchEvent(new Event('sq:content-changed'));
  },

  /**
   * Files-truth never rewrites the user's own content config with a generated
   * one (it would corrupt arbitrary Astro projects); the schema follows a field
   * through surgical edits instead (contentConfigSchema). Kept as a no-op for
   * the doc-era callers.
   */
  async writeContentConfig(_collections: ContentCollection[]): Promise<void> {},
};
