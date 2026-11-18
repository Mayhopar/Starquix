// task-240 Phase 3: pagination in the page code. numbered = Astro's real
// `getStaticPaths({ paginate })` in a `[...page].astro` route (the writer moves
// the file; emit re-bases the frontmatter's relative imports); load-more = one
// route, all posts rendered, the chrome component reveals the next pageSize.
import { describe, it, expect } from 'vitest';
import { emitBlogBinding, parseBlogBinding, rebaseRelativeImports, UNBOUND, type BlogBinding } from '../blogBinding';

const UNBOUND_PAGE = `---
import BlogSlot from '../components/BlogSlot.astro';
import Layout1 from '../layouts/Layout1.astro';
---

<Layout1>
  <BlogSlot />
</Layout1>
`;
const OPTS = { cardImport: '../components/BlogCard.astro' };
const bound: BlogBinding = { ...UNBOUND, collection: 'works', sort: 'date-desc', href: '/works/' };
const numbered: BlogBinding = { ...bound, pagination: { kind: 'numbered', pageSize: 3 } };
const loadMore: BlogBinding = { ...bound, pagination: { kind: 'load-more', pageSize: 4 } };

describe('numbered pagination', () => {
  it('emits getStaticPaths({ paginate }) + page.data + the Numbered chrome; parse round-trips', () => {
    const out = emitBlogBinding(UNBOUND_PAGE, numbered, OPTS)!;
    expect(out).toContain(`export async function getStaticPaths({ paginate }) {
  const posts = (await getCollection('works'))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
  return paginate(posts, { pageSize: 3 });
}
const { page } = Astro.props;`);
    expect(out).toContain("import BlogPaginationNumbered from '../components/BlogPaginationNumbered.astro';");
    expect(out).toContain('{page.data.map((post) => <a href={`/works/${post.slug}`} class="block" data-sq-post-slug={post.slug}><BlogCard post={post} /></a>)}');
    expect(out).toContain('<Fragment slot="pagination">\n      <BlogPaginationNumbered page={page} />\n    </Fragment>');
    expect(out).not.toContain('{posts.map(');
    expect(parseBlogBinding(out)).toEqual({ ...numbered, hasSlot: true, custom: false });
  });

  it('re-binding while numbered keeps the block (collection + page size change in place)', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, numbered, OPTS)!;
    const twice = emitBlogBinding(once, { ...numbered, collection: 'blog', pagination: { kind: 'numbered', pageSize: 6 } }, OPTS)!;
    expect(parseBlogBinding(twice)).toMatchObject({ collection: 'blog', pagination: { kind: 'numbered', pageSize: 6 } });
    expect(twice.match(/getStaticPaths/g)?.length).toBe(1);
    expect(twice.match(/<Fragment slot="pagination">/g)?.length).toBe(1);
  });

  it('switching back to none restores the plain statement, drops the chrome + its import', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, numbered, OPTS)!;
    const back = emitBlogBinding(once, bound, OPTS)!;
    expect(back).toBe(emitBlogBinding(UNBOUND_PAGE, bound, OPTS));
  });

  it('unbinding a numbered page restores the bare page', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, numbered, OPTS)!;
    expect(emitBlogBinding(once, UNBOUND, OPTS)).toBe(UNBOUND_PAGE);
  });

  it('a hand-edited getStaticPaths (no canonical paginate call) is custom', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, numbered, OPTS)!;
    const edited = once.replace('return paginate(posts, { pageSize: 3 });', 'return paginate(posts.filter(f), { pageSize: 3 });');
    expect(parseBlogBinding(edited).custom).toBe(true);
    expect(emitBlogBinding(edited, bound, OPTS)).toBeNull();
  });
});

describe('load-more pagination', () => {
  it('emits the LoadMore chrome with pageSize, all posts rendered; parse round-trips', () => {
    const out = emitBlogBinding(UNBOUND_PAGE, loadMore, OPTS)!;
    expect(out).toContain("import BlogPaginationLoadMore from '../components/BlogPaginationLoadMore.astro';");
    expect(out).toContain('{posts.map((post) => <a href={`/works/${post.slug}`} class="block" data-sq-post-slug={post.slug}><BlogCard post={post} /></a>)}');
    expect(out).toContain('<Fragment slot="pagination">\n      <BlogPaginationLoadMore pageSize={4} />\n    </Fragment>');
    expect(out).not.toContain('getStaticPaths');
    expect(parseBlogBinding(out)).toEqual({ ...loadMore, hasSlot: true, custom: false });
  });

  it('numbered → load-more → none transitions are clean', () => {
    const a = emitBlogBinding(UNBOUND_PAGE, numbered, OPTS)!;
    const b = emitBlogBinding(a, loadMore, OPTS)!;
    expect(parseBlogBinding(b).pagination).toEqual({ kind: 'load-more', pageSize: 4 });
    expect(b).not.toContain('BlogPaginationNumbered');
    const c = emitBlogBinding(b, bound, OPTS)!;
    expect(c).toBe(emitBlogBinding(UNBOUND_PAGE, bound, OPTS));
  });
});

describe('rebaseRelativeImports (the [...page] move changes the page depth)', () => {
  const PAGE = `---
import BlogSlot from '../components/BlogSlot.astro';
import Layout1 from "../layouts/Layout1.astro";
import local from './helpers.ts';
import { getCollection } from 'astro:content';
const x = '../not-an-import';
---
<Layout1><BlogSlot /></Layout1>
`;
  it('one folder deeper: ../ → ../../, ./ → ../; bare specifiers and the template untouched', () => {
    const out = rebaseRelativeImports(PAGE, 'src/pages/blog.astro', 'src/pages/blog/[...page].astro');
    expect(out).toContain("import BlogSlot from '../../components/BlogSlot.astro';");
    expect(out).toContain('import Layout1 from "../../layouts/Layout1.astro";');
    expect(out).toContain("import local from '../helpers.ts';");
    expect(out).toContain("import { getCollection } from 'astro:content';");
    expect(out).toContain("const x = '../not-an-import';");
    // and back is byte-exact
    expect(rebaseRelativeImports(out, 'src/pages/blog/[...page].astro', 'src/pages/blog.astro')).toBe(PAGE);
  });
  it('same depth: unchanged', () => {
    expect(rebaseRelativeImports(PAGE, 'src/pages/blog.astro', 'src/pages/news.astro')).toBe(PAGE);
  });
});
