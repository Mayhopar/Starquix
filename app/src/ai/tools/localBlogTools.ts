/**
 * Content/blog AI + MCP tools on the files-truth runtime (2026-10-05).
 *
 * The registry's blog tools were written for the retired doc runtime: they
 * read/wrote Yjs collections, blog-slot bindings and `:blogcard` overlays that
 * a files-truth site never renders — a bind "succeeded" and nothing changed
 * (owner report: MCP could not bind a blog). Here every tool routes through
 * the SAME writers the UI uses: the binding IS the page code
 * (bindLocalBlogSlot / parseBlogBinding), collections ARE src/content/<name>/
 * (contentOps + createLocalCollection), field bindings are bindLocalField. A
 * blog "slot" is a `<BlogSlot>` tag of the current page; a page may hold
 * several (task-244) — tools take an optional 1-based `slot` (default 1, so
 * old callers keep acting on the first one).
 */
import { contentOps } from '@/core/collections/content-ops';
import type { DiscoveredCollection, FieldType } from '@/core/collections/types';
import { defaultLocalFieldValue } from '@/core/collections/localFields';
import { bindLocalBlogSlot, CARD_FILE } from '@/components/Editor/localBlogBind';
import { createLocalCollection } from '@/components/Editor/localBlogScaffold';
import { bindLocalField } from '@/components/Editor/localFieldBind';
import { fetchLocalPages, fetchLocalPageSource } from '@/utils/localPageSync';
import { readLocalFile } from '@/utils/localElementSource';
import {
  filterToken, PAGINATION_CHROME, parseBlogBindings, parseFilterToken, slotSpans, sortFor, UNBOUND,
  type BlogBinding, type BlogPagination, type BlogSort,
} from '@/utils/blogBinding';
import { settleAcceptedWrites } from '@/utils/acceptedSource';
import type { ToolCallResult, ToolExecutionContext } from './commandTools';
import { fail, findScannedByKey, localProjectPathOf } from './localToolUtils';

/** Tools the files-truth runtime cannot honor (no file-level meaning) — hidden from the catalogue. */
export const LOCAL_HIDDEN_BLOG_TOOLS = new Set([
  'update_blog_card_classes',
  'rename_collection', 'rename_collection_field',
]);

/** How an agent gets a Blog list onto a page (owner 2026-11-11: an MCP agent found no tool for it and left an empty div). */
export const PLACE_BLOG_HINT = 'place one: place_component_instance {"componentPath":"BlogSlot","targetKey":"<key of the element to put it in>","collectionName":"<collection>"}';

const CARD_HINT = `Cards render ${CARD_FILE}. To restyle them: open_component {"file":"${CARD_FILE}"}, read_source_elements, update_element_by_key on its keys, then select_page back.`;

type Params = Record<string, unknown>;
type Handler = (ctx: ToolExecutionContext, params: Params) => Promise<unknown>;

const collections = (): Promise<DiscoveredCollection[]> => contentOps.fetchCollections();
const hasCollection = async (name: string) => (await collections()).some((c) => c.name === name);
const missingCollection = (name: string) => fail(`Collection "${name}" not found — read_collections.`);

async function currentBindings(ctx: ToolExecutionContext): Promise<
  { ok: true; path: string; file: string; bindings: BlogBinding[] } | { ok: false; message: string }
> {
  const path = localProjectPathOf(ctx);
  const file = ctx.getCurrentPageFile();
  if (!path || !file) return { ok: false, message: 'No page file is open — select_page a page first.' };
  const source = await fetchLocalPageSource(path, file);
  if (source === null) return { ok: false, message: `Could not read ${file}.` };
  return { ok: true, path, file, bindings: parseBlogBindings(source) };
}

/** The `slot`-th (1-based, default 1) BlogSlot of the current page. */
async function currentBinding(ctx: ToolExecutionContext, slot: unknown): Promise<
  { ok: true; path: string; file: string; binding: BlogBinding } | { ok: false; message: string }
> {
  const cur = await currentBindings(ctx);
  if (!cur.ok) return cur;
  const n = typeof slot === 'number' ? slot : 1;
  if (!cur.bindings.length) return { ok: false, message: `No <BlogSlot> on ${cur.file} — ${PLACE_BLOG_HINT} (or select_page the page that has one).` };
  const binding = cur.bindings[n - 1];
  if (!binding) return { ok: false, message: `${cur.file} has ${cur.bindings.length} blog slot(s) — slot ${n} does not exist (read_blog_slots).` };
  return { ok: true, path: cur.path, file: cur.file, binding };
}

function describeBinding(file: string, b: BlogBinding) {
  return {
    slotKey: file,
    slot: b.slot + 1,
    collectionName: b.collection,
    settings: { sortBy: b.sort, limit: b.limit, filter: filterToken(b.filter) || null, pagination: b.pagination.kind,
      postsPerPage: b.pagination.kind === 'none' ? null : b.pagination.pageSize, postLink: b.href ? `${b.href}[slug]` : null },
    wiredByHand: b.custom,
    cardFile: CARD_FILE,
    hint: CARD_HINT,
  };
}

async function writeBinding(ctx: ToolExecutionContext, next: BlogBinding, path: string, file: string): Promise<ToolCallResult> {
  const kind = next.pagination.kind;
  const chromeComponent = kind === 'none' ? null : ctx.componentLibrary.find((c) => c.name === PAGINATION_CHROME[kind]) ?? null;
  const r = await bindLocalBlogSlot({ pageFile: file, localProjectPath: path, binding: next, pushUndo: ctx.pushStructuralUndo, chromeComponent, quiet: true, slot: next.slot });
  if (!r.ok) return fail(`The blog on ${file} was not changed — ${r.reason}`);
  return { success: true, message: next.collection ? `Blog on ${file} shows "${next.collection}"` : `Blog on ${file} unbound`, data: { slotKey: file } };
}

async function fieldType(name: string, prefer: string | null): Promise<string> {
  const all = await collections();
  for (const c of [...all.filter((x) => x.name === prefer), ...all.filter((x) => x.name !== prefer)]) {
    const f = c.inferredFields.find((x) => x.name === name);
    if (f) return f.type;
  }
  return 'text';
}

async function bindField(ctx: ToolExecutionContext, elementKey: string, fieldName: string | null, prefer: () => Promise<string | null>): Promise<ToolCallResult> {
  const el = findScannedByKey(ctx.getScannedElements(), elementKey);
  if (!el?.sourceLocation) return fail(`Element "${elementKey}" is not on the current canvas — read_source_elements for keys.`);
  const type = fieldName ? await fieldType(fieldName, await prefer()) : 'text';
  const r = await bindLocalField({ loc: el.sourceLocation, tagName: el.tagName, field: fieldName, fieldType: type, pushUndo: ctx.pushStructuralUndo });
  if (!r.ok) return fail(`Could not bind "${elementKey}" — ${r.reason}`);
  return { success: true, message: fieldName ? `"${elementKey}" now shows {post.data.${fieldName}}` : `"${elementKey}" is static text again` };
}

/** The BlogSlot place_component_instance just wrote at `line` of `file`, bound to `collectionName` —
 *  that slot, not the page's first (a page may already hold others). */
export async function bindPlacedBlogSlot(ctx: ToolExecutionContext, file: string, line: number, collectionName: string): Promise<ToolCallResult> {
  const path = localProjectPathOf(ctx);
  if (!path) return fail('No project is open.');
  await settleAcceptedWrites();
  const source = await fetchLocalPageSource(path, file);
  if (source === null) return fail(`Placed the BlogSlot but could not read ${file} — read_blog_slots, then bind_blog_collection.`);
  const lineOf = (i: number) => source.slice(0, i).split('\n').length;
  const slot = slotSpans(source).findIndex((s) => lineOf(s.start) <= line && line <= lineOf(s.end));
  const b = parseBlogBindings(source)[slot];
  const col = (await collections()).find((c) => c.name === collectionName);
  if (!b || !col) return fail(`Placed the BlogSlot but did not bind it — read_blog_slots, then bind_blog_collection.`);
  return writeBinding(ctx, { ...b, collection: collectionName, sort: sortFor(col.inferredFields, b.sort) }, path, file);
}

/** Every blog/content tool this module answers on files-truth, by name (reads and writes). */
export const LOCAL_BLOG_HANDLERS: Record<string, Handler> = {
  read_collections: async (_ctx, params) => {
    const name = params.collectionName as string | undefined;
    const all = (await collections()).filter((c) => !name || c.name === name);
    return { collections: all.map((c) => ({ name: c.name, fields: c.inferredFields, postCount: c.posts.length })) };
  },
  read_blog_slots: async (ctx) => {
    const cur = await currentBindings(ctx);
    if (!cur.ok) return { error: cur.message };
    const slots = cur.bindings.map((b) => describeBinding(cur.file, b));
    return { slots, count: slots.length, ...(slots.length ? {} : { hint: `No <BlogSlot> on ${cur.file} — ${PLACE_BLOG_HINT}.` }) };
  },
  read_blog_card_template: async () => {
    const source = await readLocalFile(CARD_FILE).catch(() => null);
    if (source === null) return { error: `${CARD_FILE} does not exist — bind a blog first.` };
    return { file: CARD_FILE, source, hint: CARD_HINT };
  },
  read_post_page: async (ctx) => {
    const path = localProjectPathOf(ctx);
    if (!path) return { error: 'No project is open.' };
    const postPages = (await fetchLocalPages(path)).filter((p) => /\[\.{0,3}slug\]/.test(p.route));
    return {
      postPages,
      hint: 'A post page is a route file rendering one post. Edit it like any page (select_page, update_element_by_key); its layout is the file it imports — open_component that file to restyle it. Bind an element to a field with set_post_page_binding.',
    };
  },
  create_collection: async (ctx, params) => {
    const { name } = params as { name: string };
    const path = localProjectPathOf(ctx);
    if (!path) return fail('No project is open.');
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) return fail(`"${name}" is not a valid folder name (letters, digits, - and _).`);
    if (await hasCollection(name)) return fail(`Collection "${name}" already exists.`);
    await createLocalCollection(name, path);
    return { success: true, message: `Created collection "${name}" (src/content/${name}/, one untitled post — delete_post it once real posts exist). Fields are the keys your posts' frontmatter uses. To show its posts on a page: ${PLACE_BLOG_HINT.replace('<collection>', name)}.` };
  },
  bind_blog_collection: async (ctx, params) => {
    const { collectionName } = params as { collectionName: string };
    const [cur, all] = await Promise.all([currentBinding(ctx, params.slot), collections()]);
    if (!cur.ok) return fail(cur.message);
    if (cur.binding.custom) return fail(`The blog on ${cur.file} is wired by hand — edit its fetch in the file.`);
    const col = all.find((c) => c.name === collectionName);
    if (!col) return missingCollection(collectionName);
    const b = cur.binding;
    return writeBinding(ctx, {
      ...b, collection: collectionName, sort: sortFor(col.inferredFields, b.sort), href: null,
      filter: b.filter && col.inferredFields.some((f) => f.name === b.filter!.field && f.type === 'boolean') ? b.filter : null,
    }, cur.path, cur.file);
  },
  unbind_blog_slot: async (ctx, params) => {
    const cur = await currentBinding(ctx, params.slot);
    if (!cur.ok) return fail(cur.message);
    return writeBinding(ctx, { ...UNBOUND, slot: cur.binding.slot }, cur.path, cur.file);
  },
  update_blog_settings: async (ctx, params) => {
    const p = params as { pagination?: BlogPagination['kind']; postsPerPage?: number; sortBy?: BlogSort; limit?: number | null; filter?: string | null };
    const cur = await currentBinding(ctx, params.slot);
    if (!cur.ok) return fail(cur.message);
    const b = cur.binding;
    if (!b.collection) return fail(`The blog on ${cur.file} is not bound — bind_blog_collection first.`);
    const kind = p.pagination ?? b.pagination.kind;
    const pageSize = p.postsPerPage ?? (b.pagination.kind === 'none' ? 3 : b.pagination.pageSize);
    const pagination: BlogPagination = kind === 'none' ? { kind } : { kind, pageSize };
    const res = await writeBinding(ctx, {
      ...b, pagination,
      ...(p.sortBy ? { sort: p.sortBy } : {}),
      ...(p.limit !== undefined ? { limit: p.limit } : {}),
      ...(p.filter !== undefined ? { filter: parseFilterToken(p.filter) } : {}),
    }, cur.path, cur.file);
    const ignored = ['layout', 'columns', 'gap', 'postLinkMode'].filter((k) => params[k] !== undefined);
    if (res.success && ignored.length) res.message += ` (${ignored.join(', ')} ignored — grid columns/gap are classes on the list element: update_element_by_key)`;
    return res;
  },
  add_collection_field: async (_ctx, params) => {
    const { collectionName, fieldName, fieldType: type } = params as { collectionName: string; fieldName: string; fieldType: FieldType };
    if (!(await hasCollection(collectionName))) return missingCollection(collectionName);
    await contentOps.addLocalCollectionField(collectionName, fieldName, defaultLocalFieldValue(type), type);
    return { success: true, message: `Added "${fieldName}" to every post in "${collectionName}"` };
  },
  delete_collection_field: async (_ctx, params) => {
    const { collectionName, fieldName } = params as { collectionName: string; fieldName: string };
    if (!(await hasCollection(collectionName))) return missingCollection(collectionName);
    await contentOps.removeLocalCollectionField(collectionName, fieldName);
    return { success: true, message: `Removed "${fieldName}" from the posts in "${collectionName}"` };
  },
  delete_collection: async (ctx, params) => {
    const { collectionName } = params as { collectionName: string };
    if (!(await hasCollection(collectionName))) return missingCollection(collectionName);
    ctx.takeSnapshot(); // ⌘Z brings every post back
    await contentOps.deleteCollection(collectionName, ctx.claimSnapshot?.());
    return { success: true, message: `Deleted collection "${collectionName}" and its posts` };
  },
  bind_content_field: async (ctx, params) => {
    const { elementKey, fieldName } = params as { elementKey: string; fieldName: string };
    // The page's bound collection only breaks a field-name tie — read it only when a field is named.
    return bindField(ctx, elementKey, fieldName || null, async () => {
      const cur = await currentBinding(ctx, 1).catch(() => null);
      return cur?.ok ? cur.binding.collection : null;
    });
  },
  set_post_page_binding: async (ctx, params) => {
    const { elementKey, fieldName } = params as { elementKey: string; fieldName: string };
    const collection = (ctx.getCurrentPageFile() ?? '').match(/^src\/pages\/([^/]+)\/\[/)?.[1] ?? null;
    return bindField(ctx, elementKey, fieldName || null, async () => collection);
  },
};
