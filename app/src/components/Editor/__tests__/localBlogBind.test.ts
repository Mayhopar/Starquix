// bindLocalBlogSlot (task-240): the files-truth blog binding write. One
// whole-file restore-region write of the page (same channel as
// localLayoutApply), a whole-file inverse for ⌘Z, and an honest refusal —
// no write at all — when the page's fetch is hand-written (custom).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/ViteStructuralWriter', () => ({
  viteStructuralWriter: { writeRestoreRegion: vi.fn() },
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

const h = vi.hoisted(() => ({ move: vi.fn(), materialize: vi.fn(), routes: vi.fn(), ensureRoute: vi.fn(), files: {} as Record<string, string>, rewrite: vi.fn() }));
vi.mock('@/utils/localElementSource', () => ({
  readLocalFile: async (f: string) => { if (f in h.files) return h.files[f]; throw new Error('404'); },
  rewriteLocalFile: (...a: unknown[]) => h.rewrite(...a),
}));
vi.mock('../localBlogScaffold', () => ({ ensurePostRoute: (...a: unknown[]) => h.ensureRoute(...a) }));
vi.mock('@/utils/localPageSync', async (orig) => ({
  ...(await orig<typeof import('@/utils/localPageSync')>()),
  moveLocalPageFile: (...a: unknown[]) => h.move(...a),
  fetchLocalPageRoutes: (...a: unknown[]) => h.routes(...a),
}));
vi.mock('../localComponentInsert', () => ({ materializeLibraryComponent: (...a: unknown[]) => h.materialize(...a) }));

import toast from 'react-hot-toast';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { bindLocalBlogSlot, cardImportFor, paginatedPathFor, plainPathFor, reemitLocalBlogSlots } from '../localBlogBind';
import { emitBlogBinding, parseBlogBinding } from '@/utils/blogBinding';
import { fileLineSpan } from '../localLayoutApply';
import { UNBOUND } from '@/utils/blogBinding';
import { DEFAULT_CARD } from '@/utils/cardFields';
import { setProjectSources, _resetCardTitleLocksForTests } from '@/utils/cardTitleLock';
import { firstSlot, TWO_SLOTS, WORK_CARD } from '@/utils/__tests__/fixtures/lists';
import { _resetStructuralWriteInFlightForTests, releaseStructuralWrite, tryAcquireStructuralWrite } from '@/store/structuralWriteGuard';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const writeRestoreRegion = viteStructuralWriter.writeRestoreRegion as ReturnType<typeof vi.fn>;
const PAGE_FILE = 'src/pages/blog.astro';
const PAGE = "---\nimport BlogSlot from '../components/BlogSlot.astro';\n---\n\n<BlogSlot />\n";

function mockPageSource(content: string | null) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    content === null
      ? (new Response('nope', { status: 404 }) as Response)
      : (new Response(JSON.stringify({ content }), { status: 200 }) as Response),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  writeRestoreRegion.mockResolvedValue({ success: true, restoredLine: 1, file: PAGE_FILE });
  h.move.mockReset().mockImplementation((_p: string, from: string, to: string) => Promise.resolve({ from, to }));
  h.materialize.mockReset().mockResolvedValue({ ok: true, path: 'src/components/BlogPaginationNumbered.astro', body: '', reused: false, created: [] });
  h.routes.mockReset().mockResolvedValue([]);
  h.ensureRoute.mockReset().mockResolvedValue(false);
  h.files = {};
  h.rewrite.mockReset().mockResolvedValue({ created: true, changed: true });
});

describe('post link (href is the writer\'s to resolve)', () => {
  const written = () => writeRestoreRegion.mock.calls[0][2] as string;

  it('follows the project\'s CURRENT detail route on every write', async () => {
    mockPageSource(PAGE);
    h.routes.mockResolvedValue(['/', '/blog', '/works/[slug]']);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    expect(written()).toContain('<a href={`/works/${post.slug}`} class="block" data-sq-post-slug={post.slug}><WorksCard post={post} /></a>');
  });

  it('no detail route → the plain wrapper, whatever the binding carried', async () => {
    mockPageSource(PAGE);
    h.routes.mockResolvedValue(['/', '/blog']);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works', href: '/works/' } });
    expect(written()).toContain('<div data-sq-post-slug={post.slug}><WorksCard post={post} /></div>');
  });

  it('a collection with no post route gets one BEFORE the page is written, and the cards link to it (owner report 2026-09-28)', async () => {
    mockPageSource(PAGE);
    h.routes.mockResolvedValue(['/', '/blog']);
    h.ensureRoute.mockResolvedValue(true);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    expect(h.ensureRoute).toHaveBeenCalledWith(expect.objectContaining({ collection: 'works', projectPath: 'wc://p', pageFile: PAGE_FILE, pageSource: PAGE }));
    expect(h.ensureRoute.mock.invocationCallOrder[0]).toBeLessThan(writeRestoreRegion.mock.invocationCallOrder[0]);
    expect(written()).toContain('<a href={`/works/${post.slug}`}');
  });

  it('unbinding never creates a route', async () => {
    mockPageSource(PAGE);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND } });
    expect(h.ensureRoute).not.toHaveBeenCalled();
  });

  it('keeps the page\'s own link when the routes cannot be listed', async () => {
    mockPageSource(PAGE);
    h.routes.mockRejectedValue(new Error('offline'));
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works', href: '/works/' } });
    expect(written()).toContain('<a href={`/works/${post.slug}`}');
  });
});

describe('cardImportFor', () => {
  it('resolves ../components/BlogCard.astro relative to the page depth', () => {
    expect(cardImportFor('src/pages/blog.astro')).toBe('../components/BlogCard.astro');
    expect(cardImportFor('src/pages/blog/index.astro')).toBe('../../components/BlogCard.astro');
  });
});

describe('bindLocalBlogSlot', () => {
  it('writes the whole page through restore-region and pushes a whole-file inverse', async () => {
    mockPageSource(PAGE);
    const pushUndo = vi.fn();
    const res = await bindLocalBlogSlot({
      pageFile: PAGE_FILE, localProjectPath: 'wc://p', pushUndo,
      binding: { ...UNBOUND, collection: 'works', sort: 'date-desc' },
    });
    expect(res).toEqual({ ok: true });
    const [loc, lineCount, segment] = writeRestoreRegion.mock.calls[0];
    expect(loc).toEqual({ file: PAGE_FILE, line: 1, column: 1 });
    expect(lineCount).toBe(fileLineSpan(PAGE));
    expect(segment).toContain("const posts = (await getCollection('works'))");
    expect(pushUndo).toHaveBeenCalledWith(expect.objectContaining({
      structuralOp: {
        forward: [{ kind: 'restore-region', loc, lineCount: fileLineSpan(PAGE), segment }],
        inverse: [{ kind: 'restore-region', loc, lineCount: fileLineSpan(segment), segment: PAGE }],
      },
    }));
  });

  it('refuses a custom fetch without writing', async () => {
    mockPageSource(PAGE.replace('---\n\n', "const posts = (await getCollection('works')).filter(f);\n---\n\n"));
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'blog' } });
    expect(res.ok).toBe(false);
    expect(writeRestoreRegion).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });

  it('a no-op rewrite (same bytes) writes nothing and reports ok', async () => {
    mockPageSource(PAGE);
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: UNBOUND });
    expect(res).toEqual({ ok: true });
    expect(writeRestoreRegion).not.toHaveBeenCalled();
  });

  it('an unreadable page refuses without writing', async () => {
    mockPageSource(null);
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    expect(res.ok).toBe(false);
    expect(writeRestoreRegion).not.toHaveBeenCalled();
  });

  it('a failed write refuses and pushes no undo', async () => {
    mockPageSource(PAGE);
    writeRestoreRegion.mockResolvedValue({ success: false });
    const pushUndo = vi.fn();
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', pushUndo, binding: { ...UNBOUND, collection: 'works' } });
    expect(res.ok).toBe(false);
    expect(pushUndo).not.toHaveBeenCalled();
  });

  // Owner 2026-11-10: no refusal — it waits its turn behind the write in flight.
  it('another structural write in flight → the bind waits its turn, then writes', async () => {
    mockPageSource(PAGE);
    expect(tryAcquireStructuralWrite()).toBe(true);
    const pending = bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(writeRestoreRegion).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect((await pending).ok).toBe(true);
    expect(writeRestoreRegion).toHaveBeenCalled();
  });
});

// task-240 Phase 3: numbered pagination lives in Astro's `[...page].astro`
// route, so binding it MOVES the page file (journaled, undoable as a two-step
// record); load-more never moves. Both materialize the chrome component the
// page now imports when the project lacks it.
const NUMBERED = { ...UNBOUND, collection: 'works', sort: 'date-desc' as const, pagination: { kind: 'numbered' as const, pageSize: 3 } };
const CHROME = { name: 'BlogPaginationNumbered', path: 'src/components/library/BlogPaginationNumbered.astro', source: 'built-in' as const, html: '<nav />', category: 'Blog', props: [], slots: [], dependencies: [] };
const PAGED_FILE = 'src/pages/blog/[...page].astro';

describe('paginatedPathFor / plainPathFor', () => {
  it('maps a listing file to its [...page] route and back', () => {
    expect(paginatedPathFor('src/pages/blog.astro')).toBe('src/pages/blog/[...page].astro');
    expect(paginatedPathFor('src/pages/blog/index.astro')).toBe('src/pages/blog/[...page].astro');
    expect(paginatedPathFor('src/pages/index.astro')).toBe('src/pages/[...page].astro');
    expect(plainPathFor('src/pages/blog/[...page].astro')).toBe('src/pages/blog.astro');
    expect(plainPathFor('src/pages/[...page].astro')).toBe('src/pages/index.astro');
  });
});

describe('bindLocalBlogSlot — pagination', () => {
  it('numbered: materializes the chrome, writes the re-based page at the OLD path, then moves it; two-step undo', async () => {
    mockPageSource(PAGE);
    const pushUndo = vi.fn();
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', pushUndo, binding: NUMBERED, chromeComponent: CHROME });
    expect(res).toEqual({ ok: true });
    expect(h.materialize).toHaveBeenCalledWith(CHROME, 'wc://p');
    expect(h.move).toHaveBeenCalledWith('wc://p', PAGE_FILE, PAGED_FILE);
    // Write BEFORE move: a route move full-reloads the iframe and a bridge
    // write in that window is never delivered (live-measured 2026-09-12).
    expect(writeRestoreRegion.mock.invocationCallOrder[0]).toBeLessThan(h.move.mock.invocationCallOrder[0]);
    const [loc, lineCount, segment] = writeRestoreRegion.mock.calls[0];
    expect(loc).toEqual({ file: PAGE_FILE, line: 1, column: 1 });
    expect(lineCount).toBe(fileLineSpan(PAGE));
    expect(segment).toContain("import BlogSlot from '../../components/BlogSlot.astro';");
    expect(segment).toContain("import WorksCard from '../../components/WorksCard.astro';");
    expect(segment).toContain("import BlogPaginationNumbered from '../../components/BlogPaginationNumbered.astro';");
    expect(segment).toContain('return paginate(posts, { pageSize: 3 });');
    expect(pushUndo).toHaveBeenCalledWith(expect.objectContaining({ structuralOp: {
      forward: [
        { kind: 'restore-region', loc, lineCount: fileLineSpan(PAGE), segment },
        { kind: 'page-move', folder: 'wc://p', from: PAGE_FILE, to: PAGED_FILE },
      ],
      // Undo ALSO writes before it moves: restore the bytes where the file is
      // now (the paged path), then move it back.
      inverse: [
        { kind: 'restore-region', loc: { file: PAGED_FILE, line: 1, column: 1 }, lineCount: fileLineSpan(segment), segment: PAGE },
        { kind: 'page-move', folder: 'wc://p', from: PAGED_FILE, to: PAGE_FILE },
      ],
    } }));
  });

  it('numbered → none: moves the file back and writes the plain page at the old path', async () => {
    const paged = emitBlogBinding(
      "---\nimport BlogSlot from '../../components/BlogSlot.astro';\n---\n\n<BlogSlot />\n",
      NUMBERED, { cardImport: '../../components/BlogCard.astro' },
    )!;
    mockPageSource(paged);
    const res = await bindLocalBlogSlot({ pageFile: PAGED_FILE, localProjectPath: 'wc://p', binding: { ...NUMBERED, pagination: { kind: 'none' } } });
    expect(res).toEqual({ ok: true });
    expect(h.move).toHaveBeenCalledWith('wc://p', PAGED_FILE, PAGE_FILE);
    const [loc, , segment] = writeRestoreRegion.mock.calls[0];
    expect(loc.file).toBe(PAGED_FILE); // written where the file still is, then moved back
    expect(segment).toContain("import BlogSlot from '../components/BlogSlot.astro';");
    expect(parseBlogBinding(segment).pagination).toEqual({ kind: 'none' });
    expect(segment).not.toContain('getStaticPaths');
  });

  it('load-more: no move, same file, chrome materialized', async () => {
    mockPageSource(PAGE);
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...NUMBERED, pagination: { kind: 'load-more', pageSize: 4 } }, chromeComponent: { ...CHROME, name: 'BlogPaginationLoadMore' } });
    expect(res).toEqual({ ok: true });
    expect(h.move).not.toHaveBeenCalled();
    expect(h.materialize).toHaveBeenCalledTimes(1);
    expect(writeRestoreRegion.mock.calls[0][0]).toEqual({ file: PAGE_FILE, line: 1, column: 1 });
    expect(writeRestoreRegion.mock.calls[0][2]).toContain('<BlogPaginationLoadMore pageSize={4} />');
  });

  it('a refused move restores the original bytes (the page is never left paginated at a plain path)', async () => {
    mockPageSource(PAGE);
    h.move.mockRejectedValue(new Error('already exists'));
    const pushUndo = vi.fn();
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', pushUndo, binding: NUMBERED });
    expect(res.ok).toBe(false);
    expect(writeRestoreRegion).toHaveBeenCalledTimes(2);
    const [loc, lineCount, segment] = writeRestoreRegion.mock.calls[1];
    expect(loc).toEqual({ file: PAGE_FILE, line: 1, column: 1 });
    expect(lineCount).toBe(fileLineSpan(writeRestoreRegion.mock.calls[0][2] as string));
    expect(segment).toBe(PAGE);
    expect(toast.error).toHaveBeenCalled();
  });

  it('a refused materialize writes and moves nothing', async () => {
    mockPageSource(PAGE);
    h.materialize.mockResolvedValue({ ok: false, reason: 'could not read the built-in source' });
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: NUMBERED, chromeComponent: CHROME });
    expect(res.ok).toBe(false);
    expect(h.move).not.toHaveBeenCalled();
    expect(writeRestoreRegion).not.toHaveBeenCalled();
  });

  it('a failed write never moves the file (no half-migrated page)', async () => {
    mockPageSource(PAGE);
    writeRestoreRegion.mockResolvedValue({ success: false });
    const pushUndo = vi.fn();
    const res = await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', pushUndo, binding: NUMBERED });
    expect(res.ok).toBe(false);
    expect(h.move).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
  });
});


describe('the collection\'s own card', () => {
  const written = () => writeRestoreRegion.mock.calls[0][2] as string;

  it('binding a slot to works renders WorksCard and creates it from the project\'s BlogCard first', async () => {
    mockPageSource(PAGE);
    h.files = { 'src/components/BlogCard.astro': 'PROJECT CARD post.data' };
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    expect(written()).toContain("import WorksCard from '../components/WorksCard.astro';");
    expect(written()).toContain('<WorksCard post={post} />');
    expect(h.rewrite).toHaveBeenCalledWith('src/components/WorksCard.astro', expect.any(Function));
    const compute = h.rewrite.mock.calls[0][1] as (b: string | null) => string;
    expect(compute(null)).toBe('PROJECT CARD post.data');
    expect(compute('MINE')).toBe('MINE'); // an existing card is never overwritten
    expect(h.rewrite.mock.invocationCallOrder[0]).toBeLessThan(writeRestoreRegion.mock.invocationCallOrder[0]);
  });

  it('no BlogCard in the project → the library card', async () => {
    mockPageSource(PAGE);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    expect((h.rewrite.mock.calls[0][1] as (b: string | null) => string)(null)).toBe(DEFAULT_CARD.replace('@name BlogCard', '@name WorksCard'));
  });

  it('unbinding creates no card', async () => {
    mockPageSource(PAGE);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND } });
    expect(h.rewrite).not.toHaveBeenCalled();
  });
});

describe('a card that links itself (task-244 L11)', () => {
  it('the writer reads the assigned card and wraps it in a <div>, never an <a>, even with a detail route', async () => {
    _resetCardTitleLocksForTests();
    setProjectSources({ files: { 'src/components/WorkCard.astro': WORK_CARD.replace('CollectionEntry<"blog">', 'CollectionEntry<"works">') }, collections: ['works'] });
    mockPageSource(PAGE);
    h.routes.mockResolvedValue(['/', '/works/[slug]']);
    await bindLocalBlogSlot({ pageFile: PAGE_FILE, localProjectPath: 'wc://p', binding: { ...UNBOUND, collection: 'works' } });
    expect(writeRestoreRegion.mock.calls[0][2]).toContain('<div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>');
    _resetCardTitleLocksForTests();
  });
});

describe('quiet re-emit over every slot (task-244 L20)', () => {
  it('a custom slot is skipped; the other slot still upgrades; slot 0 bytes untouched', async () => {
    _resetCardTitleLocksForTests();
    setProjectSources({ files: { 'src/components/WorkCard.astro': WORK_CARD }, collections: ['works', 'blog'] }); // typed "blog": still the slot's card
    const custom = TWO_SLOTS.replace("const posts = (await getCollection('works', (p) => p.data.featured))", "const posts = (await getCollection('works')).filter(mine)");
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: custom }), { status: 200 }));
    h.routes.mockResolvedValue(['/']); // no detail route: slot 1's <a> becomes the plain wrapper
    expect(await reemitLocalBlogSlots({ pageFile: 'src/pages/index.astro', localProjectPath: 'wc://p' })).toEqual({ ok: true });
    expect(writeRestoreRegion).toHaveBeenCalledTimes(1);
    const out = writeRestoreRegion.mock.calls[0][2] as string;
    expect(firstSlot(out)).toBe(firstSlot(custom));
    expect(out).toContain("const posts = (await getCollection('works')).filter(mine)");
    expect(out).not.toContain('<a href');
    expect(out).toContain('<div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>');
    _resetCardTitleLocksForTests();
  });
});

