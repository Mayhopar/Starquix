// task-240 Phase 4: what a ⌘K BlogSlot insert does AFTER the tag landed —
// one collection → bind to it; none → scaffold one, then bind; many → leave
// unbound (the user picks in Blog Settings). Never a prompt. The post link is
// the writer's to resolve (bindLocalBlogSlot), never this module's.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Collection = { name: string; inferredFields: Array<{ name: string; type: string }> };
const h = vi.hoisted(() => ({ collections: [] as Array<{ name: string; inferredFields: Array<{ name: string; type: string }> }>, bind: vi.fn(), scaffold: vi.fn() }));
vi.mock('@/core/collections/content-ops', () => ({ contentOps: { fetchCollections: vi.fn(async () => h.collections) } }));
vi.mock('../localBlogBind', () => ({ bindLocalBlogSlot: (...a: unknown[]) => h.bind(...a) }));
vi.mock('../localBlogScaffold', () => ({ scaffoldBlogCollection: (...a: unknown[]) => h.scaffold(...a) }));
vi.mock('@/utils/localPageSync', async (orig) => ({
  ...(await orig<typeof import('@/utils/localPageSync')>()),
  fetchLocalPageSource: async () => "---\n---\n<BlogSlot />\n",
}));
vi.mock('react-hot-toast', () => { const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }); return { default: t }; });

import { bindInsertedBlogSlot } from '../localBlogInsert';
import { UNBOUND } from '@/utils/blogBinding';

const ARGS = { pageFile: 'src/pages/blog.astro', localProjectPath: 'wc://p', pushUndo: vi.fn() };
const SCAFFOLDED: Collection = { name: 'blog', inferredFields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'text' }, { name: 'date', type: 'date' }, { name: 'draft', type: 'boolean' }] };

beforeEach(() => {
  h.bind.mockReset().mockResolvedValue({ ok: true });
  // The scaffold writes the collection's files; the next fetchCollections reads them back.
  h.scaffold.mockReset().mockImplementation(async () => { h.collections = [SCAFFOLDED]; return { ok: true, collection: 'blog', post: 'hello-world', created: [] }; });
});

describe('bindInsertedBlogSlot', () => {
  it('exactly one collection → bound to it with the schema default sort', async () => {
    h.collections = [{ name: 'works', inferredFields: [{ name: 'date', type: 'date' }, { name: 'title', type: 'text' }] }];
    await bindInsertedBlogSlot(ARGS);
    expect(h.scaffold).not.toHaveBeenCalled();
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ pageFile: 'src/pages/blog.astro', binding: { ...UNBOUND, collection: 'works', sort: 'date-desc' } }));
  });

  it('no collection → scaffolds one, then binds to it with the schema read back from the files', async () => {
    h.collections = [];
    await bindInsertedBlogSlot(ARGS);
    expect(h.scaffold).toHaveBeenCalledWith({ pageFile: 'src/pages/blog.astro', pageSource: "---\n---\n<BlogSlot />\n" });
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ binding: { ...UNBOUND, collection: 'blog', sort: 'date-desc' } }));
  });

  it('several collections → left unbound, no scaffold', async () => {
    h.collections = [{ name: 'a', inferredFields: [] }, { name: 'b', inferredFields: [] }];
    await bindInsertedBlogSlot(ARGS);
    expect(h.scaffold).not.toHaveBeenCalled();
    expect(h.bind).not.toHaveBeenCalled();
  });

  it('a failed scaffold leaves the slot unbound (toast, no throw)', async () => {
    h.collections = [];
    h.scaffold.mockResolvedValue({ ok: false, reason: 'nope' });
    await expect(bindInsertedBlogSlot(ARGS)).resolves.toBeUndefined();
    expect(h.bind).not.toHaveBeenCalled();
  });
});
