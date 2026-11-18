/**
 * task-206: locate the <Media/> invocation in the post body by its rehype
 * body-line stamp, apply a pure mutate, save through contentOps.updatePost.
 * Frontmatter passes through UNCHANGED from the fetched post (never
 * re-serialized client-side — the local branch sends it structured).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePostBody } from '@/postmodel/postModel';

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: {
    fetchCollections: vi.fn(),
    updatePost: vi.fn().mockResolvedValue(undefined),
  },
}));

import { contentOps } from '@/core/collections/content-ops';
import { saveMediaEdit, componentAtLine } from '../saveMediaEdit';

const BODY = [
  'import Media from "../../components/sq/Media.astro";', // line 1
  '',                                                     // line 2
  'Intro paragraph.',                                     // line 3
  '',                                                     // line 4
  '<Media items={["a.png"]} class="col-span-8" />',       // line 5
  '',                                                     // line 6
  '<Media',                                               // line 7
  '  items={["b.png"]}',                                  // line 8
  '  class="col-span-12"',                                // line 9
  '/>',                                                   // line 10
  '',
].join('\n');

const FRONTMATTER = { title: 'T', date: '2026-01-01' };

function mockPost(body = BODY) {
  (contentOps.fetchCollections as ReturnType<typeof vi.fn>).mockResolvedValue([
    { name: 'works', posts: [{ slug: 'p1', frontmatter: FRONTMATTER, body, filePath: 'x' }], inferredFields: [] },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('componentAtLine', () => {
  const doc = parsePostBody(BODY, 'mdx');

  it('a non-component line (the import) → null', () => {
    expect(componentAtLine(doc, 1)).toBeNull();
  });

  it('single-line invocation at its stamped line', () => {
    expect(componentAtLine(doc, 5)?.source).toContain('a.png');
  });

  it('line INSIDE a multi-line invocation resolves to it', () => {
    for (const line of [7, 8, 9, 10]) expect(componentAtLine(doc, line)?.source).toContain('b.png');
  });

  it('out of range → null', () => {
    expect(componentAtLine(doc, 99)).toBeNull();
  });
});

describe('saveMediaEdit', () => {
  it('applies the mutate, saves with untouched frontmatter, returns the new source', async () => {
    mockPost();
    const result = await saveMediaEdit({
      collection: 'works',
      slug: 'p1',
      bodyLine: 5,
      mutate: (src) => src.replace('a.png', 'z.png'),
    });
    expect(result).toBe('<Media items={["z.png"]} class="col-span-8" />');
    const call = (contentOps.updatePost as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('works');
    expect(call[1]).toBe('p1');
    expect(call[2]).toBe(FRONTMATTER); // the SAME object, passed through
    expect(call[3]).toContain('z.png');
    expect(call[3]).toContain('b.png'); // other blocks byte-identical
    expect(call[3]).toContain('Intro paragraph.');
  });

  it('mutate refusal (null) leaves the file untouched and returns null', async () => {
    mockPost();
    const result = await saveMediaEdit({ collection: 'works', slug: 'p1', bodyLine: 5, mutate: () => null });
    expect(result).toBeNull();
    expect(contentOps.updatePost).not.toHaveBeenCalled();
  });

  it('line not covering a component block → null, no write', async () => {
    mockPost();
    const result = await saveMediaEdit({ collection: 'works', slug: 'p1', bodyLine: 3, mutate: (s) => s });
    expect(result).toBeNull();
    expect(contentOps.updatePost).not.toHaveBeenCalled();
  });

  it('unknown post → null', async () => {
    mockPost();
    const result = await saveMediaEdit({ collection: 'works', slug: 'nope', bodyLine: 5, mutate: (s) => s });
    expect(result).toBeNull();
  });
});
