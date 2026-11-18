// Files-truth blog binding (task-240): the binding IS the page's Astro code.
// parseBlogBinding reads it back; anything it cannot classify is `custom`
// and the UI never rewrites it.
import { describe, it, expect } from 'vitest';
import { parseBlogBinding, parseBlogBindings, detectPostRoute, emitPostsExpression, slotAtLine } from '../blogBinding';
import { lineOf, TWO_SLOTS } from './fixtures/lists';

const UNBOUND = `---
import BlogSlot from '../components/BlogSlot.astro';
import Layout1 from '../layouts/Layout1.astro';
---

<Layout1>
  <BlogSlot />
</Layout1>
`;

const BOUND = `---
import { getCollection } from 'astro:content';
import BlogSlot from '../components/BlogSlot.astro';
import BlogCard from '../components/BlogCard.astro';
import Layout1 from '../layouts/Layout1.astro';
const posts = (await getCollection('works', (p) => p.data.featured))
  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
  .slice(0, 12);
---

<Layout1>
  <BlogSlot>
    <Fragment slot="posts">
      {posts.map((post) => <a href={\`/works/\${post.slug}\`} class="block" data-sq-post-slug={post.slug}><BlogCard post={post} /></a>)}
    </Fragment>
  </BlogSlot>
</Layout1>
`;

describe('parseBlogBinding', () => {
  it('an unbound slot: collection null, no source ranges', () => {
    expect(parseBlogBinding(UNBOUND)).toEqual({
      hasSlot: true, collection: null, filter: null, sort: null, limit: null,
      pagination: { kind: 'none' }, href: null, custom: false, slot: 0, postsVar: 'posts', slotCount: 1,
    });
  });

  it('reads every canonical setting back', () => {
    expect(parseBlogBinding(BOUND)).toEqual({
      hasSlot: true, collection: 'works', filter: { field: 'featured' }, sort: 'date-desc',
      limit: 12, pagination: { kind: 'none' }, href: '/works/', custom: false, slot: 0, postsVar: 'posts', slotCount: 1,
    });
  });

  it('a hand-written fetch it cannot classify is custom, never rewritten', () => {
    const custom = BOUND.replace("(await getCollection('works', (p) => p.data.featured))", "(await getCollection('works')).filter(myFilter)");
    const b = parseBlogBinding(custom);
    expect(b.collection).toBe('works');
    expect(b.custom).toBe(true);
  });

  it('no BlogSlot tag: hasSlot false', () => {
    expect(parseBlogBinding('---\n---\n<p>x</p>\n').hasSlot).toBe(false);
  });

  it('whitespace variants of the canonical shape are still canonical', () => {
    const squashed = BOUND.replace("(await getCollection('works', (p) => p.data.featured))\n  .sort", "(await getCollection('works', (p) => p.data.featured)).sort");
    expect(parseBlogBinding(squashed).custom).toBe(false);
  });
});

describe('detectPostRoute', () => {
  it('finds the collection detail route from the page routes', () => {
    expect(detectPostRoute('works', ['/', '/blog', '/works/[slug]'])).toBe('/works/');
    expect(detectPostRoute('works', ['/', '/works/[...slug]'])).toBe('/works/');
  });
  it('no detail route → null (nothing is created unprompted)', () => {
    expect(detectPostRoute('works', ['/', '/blog'])).toBeNull();
    expect(detectPostRoute('works', ['/works'])).toBeNull();
  });
});

describe('filter "not" (task-244 L13)', () => {
  it('`(p) => !p.data.featured` parses to { field, not: true }, canonical', () => {
    const page = BOUND.replace('(p) => p.data.featured', '(p) => !p.data.featured');
    const b = parseBlogBinding(page);
    expect(b.filter).toEqual({ field: 'featured', not: true });
    expect(b.custom).toBe(false);
  });

  it('emitPostsExpression writes `!` for not', () => {
    expect(emitPostsExpression({ collection: 'works', filter: { field: 'featured', not: true }, sort: null, limit: null }))
      .toBe("(await getCollection('works', (p) => !p.data.featured))");
  });

  it('a positive filter has no `not` key (byte-identical round trip, L25)', () => {
    expect(parseBlogBinding(BOUND).filter).toStrictEqual({ field: 'featured' });
  });
});

describe('multi-slot pages (task-244 L2/L18/L24)', () => {
  it('every BlogSlot parses with its own fetch', () => {
    const [a, b, ...rest] = parseBlogBindings(TWO_SLOTS);
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ slot: 0, postsVar: 'posts', collection: 'works', filter: { field: 'featured' }, sort: 'date-asc', limit: null, href: null, custom: false });
    expect(b).toMatchObject({ slot: 1, postsVar: 'posts2', collection: 'works', filter: { field: 'featured', not: true }, sort: 'date-desc', limit: 4, href: '/works/', custom: false });
  });

  it('a slot mapping a non-canonical const is custom; the other slot is not', () => {
    const page = TWO_SLOTS.replace("const posts2 = (await getCollection('works', (p) => !p.data.featured))", "const posts2 = (await getCollection('works')).filter(mine)");
    const [a, b] = parseBlogBindings(page);
    expect(a.custom).toBe(false);
    expect(b).toMatchObject({ custom: true, postsVar: 'posts2' });
  });

  it('an unbound second slot is UNBOUND with the next free postsN', () => {
    const page = TWO_SLOTS.replace(/  <BlogSlot sectionClass="" postsClass="b">[\s\S]*?<\/BlogSlot>/, '  <BlogSlot />');
    const [, b] = parseBlogBindings(page);
    expect(b).toMatchObject({ hasSlot: true, collection: null, custom: false, slot: 1, postsVar: 'posts3' }); // posts2 is still declared
    const clean = page.replace(/const posts2 = [\s\S]*?;\n/, '');
    expect(parseBlogBindings(clean)[1].postsVar).toBe('posts2');
  });

  it('an unrelated const the fragment does not map is never read (L24)', () => {
    const page = TWO_SLOTS.replace('---\n<main>', 'const posts9 = something();\n---\n<main>');
    expect(parseBlogBindings(page).map((b) => b.postsVar)).toEqual(['posts', 'posts2']);
  });

  it('parseBlogBinding is the first slot', () => {
    expect(parseBlogBinding(TWO_SLOTS)).toEqual(parseBlogBindings(TWO_SLOTS)[0]);
    expect(parseBlogBinding(BOUND)).toEqual(parseBlogBindings(BOUND)[0]);
  });
});

describe('the selected slot (task-244 L18)', () => {
  const line = (needle: string) => lineOf(TWO_SLOTS, needle).line;
  it('a line inside (or on) a BlogSlot block picks that slot; no line → the first', () => {
    expect(slotAtLine(TWO_SLOTS, line('<BlogSlot sectionClass="" postsClass="b">'))).toBe(1);
    expect(slotAtLine(TWO_SLOTS, line('<WorkCard work'))).toBe(1);
    expect(slotAtLine(TWO_SLOTS, line('<FeaturedWork work'))).toBe(0);
    expect(slotAtLine(TWO_SLOTS, null)).toBe(0);
    expect(parseBlogBindings(TWO_SLOTS)[slotAtLine(TWO_SLOTS, line('<WorkCard work'))]).toMatchObject({ postsVar: 'posts2', slot: 1, slotCount: 2 });
  });
});

