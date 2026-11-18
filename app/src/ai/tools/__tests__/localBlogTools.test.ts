// Content/blog AI + MCP tools on files-truth (owner report 2026-10-05: MCP
// "bound" a blog and nothing changed — the tools wrote Yjs doc state a
// files-truth site never renders). Each tool must route through the UI's
// file writers; doc-only tools are hidden.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: {
    fetchCollections: vi.fn(),
    createPost: vi.fn(),
    addLocalCollectionField: vi.fn(),
    removeLocalCollectionField: vi.fn(),
    deleteCollection: vi.fn(),
    deletePost: vi.fn(),
    writeContentConfig: vi.fn(),
  },
}));
vi.mock('@/components/Editor/localBlogBind', () => ({ bindLocalBlogSlot: vi.fn(), CARD_FILE: 'src/components/BlogCard.astro' }));
vi.mock('@/components/Editor/localBlogScaffold', () => ({ ensurePostRoute: vi.fn(), createLocalCollection: vi.fn() }));
vi.mock('@/components/Editor/localFieldBind', () => ({ bindLocalField: vi.fn() }));
vi.mock('@/utils/localElementSource', async (orig) => ({ ...(await orig<object>()), readLocalFile: vi.fn(), writeLocalFile: vi.fn() }));
vi.mock('@/utils/localPageSync', async (orig) => ({ ...(await orig<object>()), fetchLocalPageSource: vi.fn(), fetchLocalPages: vi.fn() }));
vi.mock('@/services/durableEdits/fileAcceptance', async (orig) => ({ ...(await orig<object>()), acceptFileChanges: vi.fn(), finishAcceptedFiles: vi.fn() }));
vi.mock('@/services/durableEdits/projectedSource', async (orig) => ({ ...(await orig<object>()), readProjectedSourceState: vi.fn() }));
vi.mock('@/services/pendingProjectMutations', async (orig) => ({ ...(await orig<object>()), getActiveSaveProjectId: () => 'browser_blog_site' }));
vi.mock('@/services/durableEdits/commandReceipts', async (orig) => ({ ...(await orig<object>()), readSourceState: vi.fn() }));
vi.mock('@/components/Editor/localComponentInsert', () => ({ insertLocalComponent: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { contentOps } from '@/core/collections/content-ops';
import { bindLocalBlogSlot } from '@/components/Editor/localBlogBind';
import { createLocalCollection } from '@/components/Editor/localBlogScaffold';
import { readSourceState } from '@/services/durableEdits/commandReceipts';
import { bindLocalField } from '@/components/Editor/localFieldBind';
import { readLocalFile } from '@/utils/localElementSource';
import { fetchLocalPageSource } from '@/utils/localPageSync';
import { markFilesTruth, filesTruthPath } from '@/utils/localMode';
import { acceptFileChanges, finishAcceptedFiles } from '@/services/durableEdits/fileAcceptance';
import { readProjectedSourceState } from '@/services/durableEdits/projectedSource';
import { insertLocalComponent } from '@/components/Editor/localComponentInsert';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import { TWO_SLOTS } from '@/utils/__tests__/fixtures/lists';

const ID = 'browser_blog_site';
const PATH = filesTruthPath(ID);
const PAGE = 'src/pages/blog.astro';
const UNBOUND_PAGE = `---\nimport BlogSlot from '../components/BlogSlot.astro';\n---\n<BlogSlot />\n`;
const BLOG = { name: 'blog', posts: [{ slug: 'a' }], inferredFields: [{ name: 'title', type: 'text' }, { name: 'date', type: 'date' }, { name: 'image', type: 'image' }] };
const WORKS = { name: 'works', posts: [], inferredFields: [{ name: 'title', type: 'text' }] };

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
type Tools = Record<string, ExecTool>;

function ctx(scanned: Array<{ key: string; tagName: string; sourceLocation?: { file: string; line: number; column: number } }> = []) {
  const c = makeCtx({ currentPageId: 'blog', getCurrentPageFile: () => PAGE, getScannedElements: () => scanned as never });
  c.doc.getMap('meta').set('projectId', ID);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  markFilesTruth(ID);
  m(contentOps.fetchCollections).mockResolvedValue([BLOG, WORKS]);
  m(bindLocalBlogSlot).mockResolvedValue({ ok: true });
  m(bindLocalField).mockResolvedValue({ ok: true });
  m(createLocalCollection).mockResolvedValue('untitled-1');
  m(fetchLocalPageSource).mockResolvedValue(UNBOUND_PAGE);
});

describe('files-truth blog tools', () => {
  it('read_collections lists the collections ON DISK, not the doc', async () => {
    const r = await (generateCommandTools(ctx()) as Tools).read_collections.execute({}) as unknown as { collections: Array<{ name: string }> };
    expect(r.collections.map(c => c.name)).toEqual(['blog', 'works']);
  });

  it('read_blog_slots parses the current page file', async () => {
    const r = await (generateCommandTools(ctx()) as Tools).read_blog_slots.execute({}) as unknown as { slots: Array<{ slotKey: string; collectionName: string | null }> };
    expect(r.slots).toEqual([expect.objectContaining({ slotKey: PAGE, collectionName: null })]);
    expect(fetchLocalPageSource).toHaveBeenCalledWith(PATH, PAGE);
  });

  it('bind_blog_collection rewrites the page through bindLocalBlogSlot (no doc dispatch)', async () => {
    const c = ctx();
    const r = await (generateCommandTools(c) as Tools).bind_blog_collection.execute({ slotKey: 'x', collectionName: 'blog' });
    expect(r.success).toBe(true);
    expect(bindLocalBlogSlot).toHaveBeenCalledWith(expect.objectContaining({
      pageFile: PAGE, localProjectPath: PATH, binding: expect.objectContaining({ collection: 'blog', sort: 'date-desc' }),
    }));
    expect(c.dispatch).not.toHaveBeenCalled();
  });

  it('bind_blog_collection refuses an unknown collection and a page without a BlogSlot', async () => {
    const tools = generateCommandTools(ctx()) as Tools;
    expect((await tools.bind_blog_collection.execute({ slotKey: 'x', collectionName: 'nope' })).success).toBe(false);
    m(fetchLocalPageSource).mockResolvedValue('<main />');
    expect((await tools.bind_blog_collection.execute({ slotKey: 'x', collectionName: 'blog' })).success).toBe(false);
    expect(bindLocalBlogSlot).not.toHaveBeenCalled();
  });

  it('update_blog_settings maps sort/pagination onto the binding and names ignored layout keys', async () => {
    m(fetchLocalPageSource).mockResolvedValue(`---\nimport { getCollection } from 'astro:content';\nimport BlogSlot from '../components/BlogSlot.astro';\nconst posts = (await getCollection('blog'));\n---\n<BlogSlot />\n`);
    const r = await (generateCommandTools(ctx()) as Tools).update_blog_settings.execute({ slotKey: 'x', sortBy: 'title-asc', pagination: 'numbered', postsPerPage: 6, columns: 3 });
    expect(r.success).toBe(true);
    expect(bindLocalBlogSlot).toHaveBeenCalledWith(expect.objectContaining({
      binding: expect.objectContaining({ collection: 'blog', sort: 'title-asc', pagination: { kind: 'numbered', pageSize: 6 } }),
    }));
    expect(r.message).toMatch(/columns ignored/);
  });

  it('update_blog_settings filter "!field" = only NOT field (task-244 L13)', async () => {
    m(fetchLocalPageSource).mockResolvedValue(`---\nimport { getCollection } from 'astro:content';\nimport BlogSlot from '../components/BlogSlot.astro';\nconst posts = (await getCollection('blog'));\n---\n<BlogSlot />\n`);
    await (generateCommandTools(ctx()) as Tools).update_blog_settings.execute({ slotKey: 'x', filter: '!featured' });
    expect(bindLocalBlogSlot).toHaveBeenCalledWith(expect.objectContaining({ binding: expect.objectContaining({ filter: { field: 'featured', not: true } }) }));
  });

  it('create_collection writes a first post + post route (the Content-tab gesture)', async () => {
    m(contentOps.fetchCollections).mockResolvedValue([]);
    const r = await (generateCommandTools(ctx()) as Tools).create_collection.execute({ name: 'notes' });
    expect(r.success).toBe(true);
    expect(createLocalCollection).toHaveBeenCalledWith('notes', PATH);
  });

  it('add/delete field and delete collection use the files-truth content ops (the delete hands ⌘Z its posts)', async () => {
    const c = ctx(); const undoEntry = {}; c.claimSnapshot = vi.fn(() => undoEntry as never);
    const tools = generateCommandTools(c) as Tools;
    await tools.add_collection_field.execute({ collectionName: 'blog', fieldName: 'tags', fieldType: 'list' });
    expect(contentOps.addLocalCollectionField).toHaveBeenCalledWith('blog', 'tags', [], 'list');
    await tools.delete_collection_field.execute({ collectionName: 'blog', fieldName: 'tags' });
    expect(contentOps.removeLocalCollectionField).toHaveBeenCalledWith('blog', 'tags');
    await tools.delete_collection.execute({ collectionName: 'works' });
    expect(c.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(contentOps.deleteCollection).toHaveBeenCalledWith('works', undoEntry);
  });

  it('delete_post hands ⌘Z the post (owner: delete anything AND undo)', async () => {
    const c = ctx(); const undoEntry = {}; c.claimSnapshot = vi.fn(() => undoEntry as never);
    const r = await (generateCommandTools(c) as Tools).delete_post.execute({ collectionName: 'blog', slug: 'hello' });
    expect(r.success).toBe(true);
    expect(c.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(contentOps.deletePost).toHaveBeenCalledWith('blog', 'hello', undoEntry);
  });

  it('set_post_page_binding binds the scanned element through bindLocalField', async () => {
    const loc = { file: 'src/pages/blog/[slug].astro', line: 9, column: 5 };
    const c = makeCtx({ currentPageId: 'p', getCurrentPageFile: () => loc.file, getScannedElements: () => [{ key: 'k1', tagName: 'h1', classes: '', sourceLocation: loc }] as never });
    c.doc.getMap('meta').set('projectId', ID);
    const r = await (generateCommandTools(c) as Tools).set_post_page_binding.execute({ pageId: 'p', elementKey: 'k1', fieldName: 'title' });
    expect(r.success).toBe(true);
    expect(bindLocalField).toHaveBeenCalledWith(expect.objectContaining({ loc, tagName: 'h1', field: 'title', fieldType: 'text' }));
  });

  it('doc-only tools are hidden on files-truth', () => {
    const tools = generateCommandTools(ctx());
    for (const t of ['update_blog_card_classes', 'push_blog_card_to_source', 'reset_blog_card', 'rename_collection', 'rename_collection_field']) {
      expect(tools[t]).toBeUndefined();
    }
  });
});

describe('several BlogSlots on a page (task-244 L26)', () => {
  beforeEach(() => { m(fetchLocalPageSource).mockResolvedValue(TWO_SLOTS); });

  it('read_blog_slots lists every slot with its 1-based slot number', async () => {
    const r = await (generateCommandTools(ctx()) as Tools).read_blog_slots.execute({}) as unknown as { slots: Array<{ slot: number; collectionName: string; settings: { filter: string | null } }> };
    expect(r.slots.map((x) => [x.slot, x.collectionName, x.settings.filter])).toEqual([[1, 'works', 'featured'], [2, 'works', '!featured']]);
  });

  it('no slot → the first (old callers unchanged); slot 2 → the second', async () => {
    m(contentOps.fetchCollections).mockResolvedValue([{ ...WORKS, inferredFields: [{ name: 'title', type: 'text' }, { name: 'date', type: 'date' }] }]);
    const tools = generateCommandTools(ctx()) as Tools;
    await tools.update_blog_settings.execute({ slotKey: 'x', sortBy: 'title-asc' });
    expect(bindLocalBlogSlot).toHaveBeenLastCalledWith(expect.objectContaining({ slot: 0, binding: expect.objectContaining({ postsVar: 'posts', sort: 'title-asc' }) }));
    await tools.update_blog_settings.execute({ slotKey: 'x', sortBy: 'title-asc', slot: 2 });
    expect(bindLocalBlogSlot).toHaveBeenLastCalledWith(expect.objectContaining({ slot: 1, binding: expect.objectContaining({ postsVar: 'posts2', sort: 'title-asc' }) }));
    await tools.unbind_blog_slot.execute({ slotKey: 'x', slot: 2 });
    expect(bindLocalBlogSlot).toHaveBeenLastCalledWith(expect.objectContaining({ slot: 1, binding: expect.objectContaining({ collection: null }) }));
  });

  it('a slot past the last one is refused', async () => {
    const r = await (generateCommandTools(ctx()) as Tools).bind_blog_collection.execute({ slotKey: 'x', collectionName: 'works', slot: 3 });
    expect(r.success).toBe(false);
    expect(bindLocalBlogSlot).not.toHaveBeenCalled();
  });
});

describe('open_component', () => {
  it('opens the master view through the Assets-panel event', async () => {
    m(readSourceState).mockResolvedValue('<article />');
    const seen: unknown[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('sq:local-component-view', h);
    const r = await (generateCommandTools(ctx()) as Tools).open_component.execute({ file: 'src/components/BlogCard.astro', __scanTimeoutMs: 1 });
    window.removeEventListener('sq:local-component-view', h);
    expect(r.success).toBe(true);
    expect(seen).toEqual([{ file: 'src/components/BlogCard.astro' }]);
  });

  it('file null shows the page through the File-tab path (the Assets tab never shows one)', async () => {
    const toPage = vi.fn();
    window.addEventListener('sq:go-to-page', toPage);
    const r = await (generateCommandTools(ctx()) as Tools).open_component.execute({ file: null, __scanTimeoutMs: 1 });
    window.removeEventListener('sq:go-to-page', toPage);
    expect(r.success).toBe(true);
    expect(toPage).toHaveBeenCalledTimes(1);
  });

  it('refuses pages and missing files', async () => {
    m(readSourceState).mockResolvedValue(null);
    const tools = generateCommandTools(ctx()) as Tools;
    expect((await tools.open_component.execute({ file: 'src/pages/index.astro' })).success).toBe(false);
    expect((await tools.open_component.execute({ file: 'src/components/Nope.astro' })).success).toBe(false);
  });
});

describe('edit_file / write_file (journaled files-truth source writes)', () => {
  // The accepted change set is what the durable journal learns — a raw
  // write-file left the projection stale and refused the next class edit.
  async function accepted(read: string | null, args: Record<string, unknown>, tool: 'edit_file' | 'write_file' = 'edit_file') {
    m(readProjectedSourceState).mockResolvedValue(read);
    let changes: unknown = null;
    m(acceptFileChanges).mockImplementation(async (_f: string, input: () => Promise<unknown>) => { changes = await input(); return { projectId: ID, revision: 1 }; });
    m(finishAcceptedFiles).mockResolvedValue({ status: 'materialized' });
    const r = await (generateCommandTools(ctx()) as Tools)[tool].execute(args);
    return { r, changes };
  }

  it('edit_file accepts ONE file change through the durable journal (never a raw write)', async () => {
    const { writeLocalFile } = await import('@/utils/localElementSource');
    const { r, changes } = await accepted("import '../styles/a.css';\n<body>\n", { path: 'src/layouts/Layout1.astro', oldString: "import '../styles/a.css';", newString: "import '../fonts.css';\nimport '../styles/a.css';" });
    expect(r.success).toBe(true);
    expect(changes).toEqual([{ file: 'src/layouts/Layout1.astro', beforeSource: "import '../styles/a.css';\n<body>\n", afterSource: "import '../fonts.css';\nimport '../styles/a.css';\n<body>\n" }]);
    expect(acceptFileChanges).toHaveBeenCalledWith(`wc://${ID}`, expect.any(Function), undefined, undefined, undefined);
    expect(writeLocalFile).not.toHaveBeenCalled();
  });

  it('edit_file refuses missing / ambiguous matches; both refuse paths outside src/', async () => {
    m(acceptFileChanges).mockImplementation(async (_f: string, input: () => Promise<unknown>) => { await input(); return { projectId: ID, revision: 1 }; });
    const tools = generateCommandTools(ctx()) as Tools;
    m(readProjectedSourceState).mockResolvedValue('<p>a</p><p>a</p>');
    expect((await tools.edit_file.execute({ path: 'src/x.astro', oldString: 'zzz', newString: 'b' })).success).toBe(false);
    expect((await tools.edit_file.execute({ path: 'src/x.astro', oldString: '<p>a</p>', newString: 'b' })).success).toBe(false);
    expect((await tools.write_file.execute({ path: '.sq/sq-astro-wrapper.config.mjs', content: '' })).success).toBe(false);
    expect((await tools.write_file.execute({ path: 'src/../package.json', content: '' })).success).toBe(false);
    expect((await tools.write_file.execute({ path: 'public/x.txt', content: '' })).success).toBe(false);
    expect(finishAcceptedFiles).not.toHaveBeenCalled(); // nothing was ever written
  });

  it('write_file creates a new file (before = null)', async () => {
    const { r, changes } = await accepted(null, { path: 'src/components/New.astro', content: '<div />\n' }, 'write_file');
    expect(r).toMatchObject({ success: true, message: 'Created src/components/New.astro' });
    expect(changes).toEqual([{ file: 'src/components/New.astro', beforeSource: null, afterSource: '<div />\n' }]);
  });

  it('reports a retained (not yet written) edit as not done', async () => {
    m(readProjectedSourceState).mockResolvedValue('a');
    m(acceptFileChanges).mockImplementation(async (_f: string, input: () => Promise<unknown>) => { await input(); return { projectId: ID, revision: 1 }; });
    m(finishAcceptedFiles).mockResolvedValue({ status: 'retained', error: new Error('Source differs') });
    const r = await (generateCommandTools(ctx()) as Tools).write_file.execute({ path: 'src/a.astro', content: 'b' });
    expect(r.success).toBe(false);
  });
});

// Owner 2026-11-11: an MCP agent made a `blog` collection + posts, found NO tool that creates a
// <BlogSlot> (read_blog_slots → 0, bind_blog_collection needs one) and left an empty
// placeholder div. place_component_instance "BlogSlot" puts one INTO an element and binds it.
describe('placing a Blog list (BlogSlot) from a tool', () => {
  const SLOT = { name: 'BlogSlot', path: 'library/BlogSlot.astro', source: 'built-in', html: '<section></section>', category: 'Blog', props: [], slots: [], dependencies: [] };
  const HOLDER = { key: `${PAGE}:4:1`, tagName: 'div', sourceLocation: { file: PAGE, line: 4, column: 1 } };
  // After the insert: a slot already on the page (line 5) and the new one inside the div (line 7).
  const AFTER = `---\nimport BlogSlot from '../components/BlogSlot.astro';\n---\n<div id="blog">\n<BlogSlot />\n</div>\n<div>\n  <BlogSlot />\n</div>\n`;
  function placeCtx() {
    const c = ctx([HOLDER]);
    (c as unknown as { componentLibrary: unknown[] }).componentLibrary = [SLOT];
    return c;
  }
  beforeEach(() => {
    m(insertLocalComponent).mockResolvedValue({ ok: true, file: PAGE, insertedLine: 8 });
    m(fetchLocalPageSource).mockResolvedValue(AFTER);
  });

  it('lands inside targetKey and binds the NEW slot (not the first) to collectionName', async () => {
    const r = await (generateCommandTools(placeCtx()) as Tools).place_component_instance.execute({ componentPath: 'BlogSlot', targetKey: HOLDER.key, collectionName: 'blog' });
    expect(r.success).toBe(true);
    expect(insertLocalComponent).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ key: HOLDER.key }) }));
    expect(bindLocalBlogSlot).toHaveBeenCalledWith(expect.objectContaining({ pageFile: PAGE, slot: 1, binding: expect.objectContaining({ collection: 'blog', slot: 1 }) }));
    expect(r.message).toMatch(/blog/);
  });

  it('refuses an unknown targetKey or collection before writing anything', async () => {
    const tools = generateCommandTools(placeCtx()) as Tools;
    expect((await tools.place_component_instance.execute({ componentPath: 'BlogSlot', targetKey: 'src/pages/blog.astro:99:1' })).success).toBe(false);
    expect((await tools.place_component_instance.execute({ componentPath: 'BlogSlot', collectionName: 'nope' })).success).toBe(false);
    expect(insertLocalComponent).not.toHaveBeenCalled();
  });

  it('a page without a BlogSlot: the bind refusal names the tool that places one', async () => {
    m(fetchLocalPageSource).mockResolvedValue('<main />');
    const r = await (generateCommandTools(ctx()) as Tools).bind_blog_collection.execute({ slotKey: 'x', collectionName: 'blog' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/place_component_instance.*BlogSlot/);
  });
});
