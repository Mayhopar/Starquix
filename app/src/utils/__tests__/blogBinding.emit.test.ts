// emitBlogBinding: page source in, page source out. Bind adds imports + fetch
// + posts fragment; re-bind replaces the fetch in place; unbind restores the
// bare slot byte-for-byte; a custom fetch is refused (null) — never rewritten.
import { describe, it, expect } from 'vitest';
import { emitBlogBinding, parseBlogBinding, parseBlogBindings, UNBOUND } from '../blogBinding';
import { firstSlot, TWO_SLOTS } from './fixtures/lists';

const UNBOUND_PAGE = `---
import BlogSlot from '../components/BlogSlot.astro';
import Layout1 from '../layouts/Layout1.astro';
---

<Layout1>
  <BlogSlot />
</Layout1>
`;

const OPTS = { cardImport: '../components/BlogCard.astro' };
const bound = { ...UNBOUND, collection: 'works', sort: 'date-desc' as const, href: '/works/' };

describe('emitBlogBinding', () => {
  it('binding an unbound page adds the imports, the fetch and the posts fragment; parse round-trips', () => {
    const out = emitBlogBinding(UNBOUND_PAGE, bound, OPTS)!;
    expect(out).toContain("import { getCollection } from 'astro:content';");
    expect(out).toContain("import BlogCard from '../components/BlogCard.astro';");
    expect(out).toContain("const posts = (await getCollection('works'))\n  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());");
    expect(out).toContain('<BlogSlot>\n    <Fragment slot="posts">\n      {posts.map((post) => <a href={`/works/${post.slug}`} class="block" data-sq-post-slug={post.slug}><BlogCard post={post} /></a>)}\n    </Fragment>\n  </BlogSlot>');
    expect(parseBlogBinding(out)).toEqual({ ...bound, hasSlot: true, custom: false });
  });

  it('no detail route: the card is still wrapped and stamped (Go to post needs no route)', () => {
    const out = emitBlogBinding(UNBOUND_PAGE, { ...bound, href: null }, OPTS)!;
    expect(out).toContain('{posts.map((post) => <div data-sq-post-slug={post.slug}><BlogCard post={post} /></div>)}');
    expect(out).not.toContain('<a ');
    expect(parseBlogBinding(out)).toEqual({ ...bound, href: null, hasSlot: true, custom: false });
  });

  it('re-binding replaces the fetch statement in place and keeps everything else byte-for-byte', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, bound, OPTS)!;
    const twice = emitBlogBinding(once, { ...bound, collection: 'blog', limit: 6 }, OPTS)!;
    expect(parseBlogBinding(twice).collection).toBe('blog');
    expect(parseBlogBinding(twice).limit).toBe(6);
    expect(twice.split('getCollection').length).toBe(3); // one import mention + one call
    expect(twice.match(/<Layout1>/g)?.length).toBe(1);
    expect(twice.match(/<Fragment slot="posts">/g)?.length).toBe(1);
  });

  it('unbinding restores the bare slot and drops the now-unused imports', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, bound, OPTS)!;
    expect(emitBlogBinding(once, UNBOUND, OPTS)).toBe(UNBOUND_PAGE);
  });

  it('a self-closing slot with attributes keeps its attributes', () => {
    const page = UNBOUND_PAGE.replace('<BlogSlot />', '<BlogSlot class="mt-8" />');
    const out = emitBlogBinding(page, bound, OPTS)!;
    expect(out).toContain('<BlogSlot class="mt-8">');
    expect(emitBlogBinding(out, UNBOUND, OPTS)).toBe(page);
  });

  it('a page without frontmatter gets one; unbind removes it again', () => {
    const page = '<BlogSlot />\n';
    const out = emitBlogBinding(page, bound, OPTS)!;
    expect(out.startsWith("---\nimport { getCollection } from 'astro:content';\n")).toBe(true);
    expect(parseBlogBinding(out).collection).toBe('works');
    expect(emitBlogBinding(out, UNBOUND, OPTS)).toBe(page);
  });

  it('refuses (returns null) when the fetch is custom', () => {
    const custom = emitBlogBinding(UNBOUND_PAGE, bound, OPTS)!
      .replace("(await getCollection('works'))", "(await getCollection('works')).filter(f)");
    expect(emitBlogBinding(custom, { ...bound, limit: 3 }, OPTS)).toBeNull();
  });

  it('refuses a page without a BlogSlot', () => {
    expect(emitBlogBinding('---\n---\n<p>x</p>\n', bound, OPTS)).toBeNull();
  });
});

describe('emitBlogBinding — any collection card', () => {
  it('renders the card named by cardImport and drops the old card import', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, bound, OPTS)!;
    const works = emitBlogBinding(once, parseBlogBinding(once), { cardImport: '../components/WorksCard.astro' })!;
    expect(works).toContain("import WorksCard from '../components/WorksCard.astro';");
    expect(works).toContain('<WorksCard post={post} />');
    expect(works).not.toMatch(/BlogCard/);
    // only the card changed: same fetch, same link
    expect(works.replace(/WorksCard/g, 'BlogCard')).toBe(once);
  });
});

describe('the binding keeps its card (owner 2026-10-09: a card moved onto a collection)', () => {
  it('re-emitting a page bound to a card that takes `work` keeps that card and prop', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, bound, { cardImport: '../components/WorkCard.astro', cardProp: 'work' })!;
    expect(once).toContain('<WorkCard work={post} />');
    expect(once).toContain("import WorkCard from '../components/WorkCard.astro';");
    const again = emitBlogBinding(once, bound, { cardImport: '../components/WorkCard.astro', cardProp: 'work' })!;
    expect(again).toBe(once);
  });
  it('re-binding from a `work` card to BlogCard drops the old card import', () => {
    const once = emitBlogBinding(UNBOUND_PAGE, bound, { cardImport: '../components/WorkCard.astro', cardProp: 'work' })!;
    const back = emitBlogBinding(once, bound, OPTS)!;
    expect(back).toContain('<BlogCard post={post} />');
    expect(back).not.toContain('WorkCard');
  });
});

describe('a card that links itself is never wrapped in <a> (task-244 L11)', () => {
  it('cardLinks: true → <div data-sq-post-slug> even with a detail route', () => {
    const out = emitBlogBinding(UNBOUND_PAGE, bound, { cardImport: '../components/WorkCard.astro', cardProp: 'work', cardLinks: true })!;
    expect(out).toContain('{posts.map((post) => <div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}'); // no box: the card lays out as before (live 2026-10-10: a flow-root wrapper broke margin collapse)
    expect(out).not.toContain('<a ');
  });
});

describe('multi-slot emit (task-244 L17/L18/L22/L23)', () => {
  const WORK = { cardImport: '../components/WorkCard.astro', cardProp: 'work' };

  it('re-binding slot 1 changes only posts2 and slot 1; slot 0 bytes identical', () => {
    const b = parseBlogBindings(TWO_SLOTS)[1];
    const out = emitBlogBinding(TWO_SLOTS, { ...b, sort: 'title-asc', limit: null }, WORK, 1)!;
    expect(out).toContain("const posts2 = (await getCollection('works', (p) => !p.data.featured))\n  .sort((a, b) => a.data.title.localeCompare(b.data.title));");
    expect(out).toContain("const posts = (await getCollection('works', (p) => p.data.featured))\n  .sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf());");
    expect(firstSlot(out)).toBe(firstSlot(TWO_SLOTS));
    expect(parseBlogBindings(out)[1]).toMatchObject({ sort: 'title-asc', limit: null, custom: false, postsVar: 'posts2' });
    expect(out).toContain("import FeaturedWork from '../components/FeaturedWork.astro';");
    expect(out).toContain('<BlogSlot sectionClass="" postsClass="b">');
  });

  it('binding an unbound 2nd slot names its const posts2; a 3rd gets posts3', () => {
    const one = TWO_SLOTS.replace(/const posts2 = [\s\S]*?;\n/, '').replace(/  <BlogSlot sectionClass="" postsClass="b">[\s\S]*?<\/BlogSlot>/, '  <BlogSlot />\n  <BlogSlot />');
    const bound = { ...UNBOUND, collection: 'works', sort: 'date-desc' as const };
    const two = emitBlogBinding(one, bound, WORK, 1)!;
    expect(two).toContain("const posts2 = (await getCollection('works'))");
    expect(two).toContain('{posts2.map((post) => <div data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}');
    const three = emitBlogBinding(two, bound, WORK, 2)!;
    expect(three).toContain("const posts3 = (await getCollection('works'))");
    expect(parseBlogBindings(three).map((b) => [b.postsVar, b.collection, b.custom])).toEqual([['posts', 'works', false], ['posts2', 'works', false], ['posts3', 'works', false]]);
  });

  it('numbered pagination on a 2-slot page is refused (null)', () => {
    const b = parseBlogBindings(TWO_SLOTS)[0];
    expect(emitBlogBinding(TWO_SLOTS, { ...b, pagination: { kind: 'numbered', pageSize: 3 } }, WORK, 0)).toBeNull();
  });

  it('unbinding slot 1 removes posts2 (unreferenced) and keeps slot 0; a still-referenced posts2 stays', () => {
    const out = emitBlogBinding(TWO_SLOTS, UNBOUND, WORK, 1)!;
    expect(out).not.toContain('posts2');
    expect(out).toContain('<BlogSlot sectionClass="" postsClass="b" />');
    expect(firstSlot(out)).toBe(firstSlot(TWO_SLOTS));
    expect(out).not.toContain('import WorkCard'); // its card is no longer rendered
    const used = TWO_SLOTS.replace('<main>', '<main>\n  <p>{posts2.length}</p>');
    expect(emitBlogBinding(used, UNBOUND, WORK, 1)).toContain('const posts2 = ');
  });

  it('a slot index past the last slot is refused', () => {
    expect(emitBlogBinding(TWO_SLOTS, UNBOUND, WORK, 2)).toBeNull();
  });
});

describe('getCollection import spelled differently', () => {
  it('a page importing getCollection with double quotes / other names gets no second import', () => {
    const page = UNBOUND_PAGE.replace('---\nimport BlogSlot', '---\nimport { getCollection, type CollectionEntry } from "astro:content";\nimport BlogSlot');
    const out = emitBlogBinding(page, bound, OPTS)!;
    expect(out.match(/getCollection[,\s}]/g)?.length).toBe(1);
    expect(out).not.toContain("import { getCollection } from 'astro:content';");
  });
});

