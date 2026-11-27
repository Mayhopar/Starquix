// emitBlogBinding: page source in, page source out. Bind adds imports + fetch
// + posts fragment; re-bind replaces the fetch in place; unbind restores the
// bare slot byte-for-byte; a custom fetch is refused (null) — never rewritten.
import { describe, it, expect } from 'vitest';
import { cardTagsOf, emitBlogBinding, parseBlogBinding, parseBlogBindings, renameCardTags, stampPostCards, UNBOUND, type BlogBinding, type EmitOptions } from '../blogBinding';
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

// Instance overrides live as props on the card tag (utils/propOverrides.ts) and the editor writes them FIRST;
// the page's own markup on the wrapper is the user's too. A re-emit owns only the fetch, the list, the link and
// the card's entry prop — it must never drop the rest (investigation 2026-11-23: a Blog Settings change or the
// quiet upgrade wiped every override of the blog card).
describe('re-emit keeps what the page added to the card tag and its wrapper', () => {
  const reemit = (page: string, patch: Partial<BlogBinding> = {}, opts: EmitOptions = OPTS) => emitBlogBinding(page, { ...parseBlogBinding(page), ...patch }, opts);
  const once = emitBlogBinding(UNBOUND_PAGE, bound, OPTS)!;
  const CARD_TAG = '<BlogCard h2Class={"font-[\\"KTF_Rublena\\"] text-4xl"} imgClass="hidden" post={post} />';
  const edited = once.replace('<BlogCard post={post} />', CARD_TAG).replace('class="block"', 'class="block no-underline"');

  it('the same settings are a no-op', () => {
    expect(reemit(edited)).toBe(edited);
  });

  it('a settings change keeps the card tag and the wrapper class', () => {
    const out = reemit(edited, { limit: 5 })!;
    expect(out).toContain(CARD_TAG);
    expect(out).toContain('class="block no-underline"');
    expect(parseBlogBinding(out).limit).toBe(5);
  });

  it('a new detail route updates the link and keeps the rest of the wrapper', () => {
    const out = reemit(edited, { href: '/blog/' })!;
    expect(out).toContain(`<a href={\`/blog/\${post.slug}\`} class="block no-underline" data-sq-post-slug={post.slug}>${CARD_TAG}</a>`);
  });

  it('a wrapper of another kind keeps the page\'s attributes and the card tag (the link and its `block` go)', () => {
    const out = reemit(edited, { href: null })!;
    expect(out).toContain(`<div class="no-underline" data-sq-post-slug={post.slug}>${CARD_TAG}</div>`);
  });

  it("another card takes the page's props with it (the Blog Settings card picker's rule)", () => {
    const out = reemit(edited, {}, { cardImport: '../components/WorksCard.astro' })!;
    expect(out).toContain(CARD_TAG.replace('<BlogCard', '<WorksCard'));
    expect(out).toContain("import WorksCard from '../components/WorksCard.astro';");
    expect(out).not.toContain('import BlogCard');
  });

  it('a self-linking card gets the box-less wrapper and loses it again (contents follows cardLinks)', () => {
    const div = reemit(edited, { href: null })!;
    const linked = reemit(div, {}, { ...OPTS, cardLinks: true })!;
    expect(linked).toContain(`<div class="contents no-underline" data-sq-post-slug={post.slug}>${CARD_TAG}</div>`);
    const unlinked = reemit(linked)!;
    expect(unlinked).toContain(`<div class="no-underline" data-sq-post-slug={post.slug}>${CARD_TAG}</div>`);
  });

  it('a prop with a division or a multi-line card tag is kept byte-for-byte', () => {
    const multi = once.replace('<BlogCard post={post} />', '<BlogCard\n        ratio={16 / 9}\n        post={post}\n      />');
    expect(cardTagsOf(multi)).toEqual(['BlogCard']);
    expect(reemit(multi)).toBe(multi);
    expect(reemit(multi, { limit: 3 })).toContain('<BlogCard\n        ratio={16 / 9}\n        post={post}\n      />');
  });

  it('markup the binding did not write makes the slot hand-wired: never rewritten', () => {
    const own = once.replace('<BlogCard post={post} />', '<span class="badge">New</span><BlogCard post={post} />');
    expect(parseBlogBinding(own).custom).toBe(true);
    expect(reemit(own, { custom: false, limit: 3 })).toBeNull();
  });

  it('a wrapper class holding a project font keeps working quotes (font-["Inter"])', () => {
    const font = once.replace('class="block"', `class='flex font-["Inter"]'`);
    expect(reemit(font)).toContain(`class='block flex font-["Inter"]'`);
    expect(reemit(font, { href: null })).toContain(`<div class='flex font-["Inter"]' data-sq-post-slug={post.slug}>`);
  });

  it('a list named like the arrow parameter is still the list (numbered switch)', () => {
    const p = once.replace('const posts = ', 'const p = ').replace('{posts.map(', '{p.map(');
    expect(parseBlogBinding(p)).toMatchObject({ custom: false, postsVar: 'p' });
    expect(reemit(p, { pagination: { kind: 'numbered', pageSize: 6 } })).toContain('{page.data.map((post) => <a');
  });

  it('a card imported under another name stays as it is: no second import', () => {
    const aliased = once.replace("import BlogCard from '../components/BlogCard.astro';", "import Card from '../components/WorksCard.astro';")
      .replace('<BlogCard post={post} />', '<Card h2Class="x" post={post} />');
    expect(reemit(aliased, {}, { cardImport: '../components/WorksCard.astro' })).toBe(aliased);
  });

  it('a map body in parentheses (as Prettier prints it) is still the binding\'s own', () => {
    const pretty = edited.replace('{posts.map((post) => <a', '{posts.map((post) => (<a').replace('</a>)}', '</a>))}');
    expect(parseBlogBinding(pretty).custom).toBe(false);
    expect(reemit(pretty)).toBe(pretty);
  });

  it('a card name with _ or $ and an entry written `post={ post }` are still the card', () => {
    expect(cardTagsOf('<Blog_Card h2Class="x" post={ post } /><Blog$Card post={post}></Blog$Card>')).toEqual(['Blog_Card', 'Blog$Card']);
  });

  it('the card tag is found whatever the attribute order', () => {
    expect(cardTagsOf(edited)).toEqual(['BlogCard']);
  });
});

describe('renameCardTags (the card picker / missing-card swap)', () => {
  it('renames the tag and its entry prop by span: override props before the entry, `>` in a value, all kept', () => {
    const tpl = '{posts.map((post) => <a href="/x"><BlogCard pHtml={"Hi <b>there</b>"} h2Class="text-4xl" post={post} /></a>)}';
    expect(renameCardTags(tpl, 'BlogCard', 'WorkCard', 'post', 'work'))
      .toBe('{posts.map((post) => <a href="/x"><WorkCard pHtml={"Hi <b>there</b>"} h2Class="text-4xl" work={post} /></a>)}');
  });
  it('a gone card: the {post} entry wins over an earlier identifier-valued prop', () => {
    expect(renameCardTags('<WorkCard variant={v} post={post} />', 'WorkCard', 'BlogCard', null, 'post')).toBe('<BlogCard variant={v} post={post} />');
  });
  it('a gone card (no source to read): its entry is the prop passing a bare identifier, not the first braced prop', () => {
    expect(renameCardTags('<Old h2Class={"text-4xl"} post={post} />', 'Old', 'BlogCard', null, 'post'))
      .toBe('<BlogCard h2Class={"text-4xl"} post={post} />');
  });
});

describe('stampPostCards: a loop the binding did not write gets its cards\' post stamp', () => {
  const slot = (posts: string) => `---\nconst posts = await getCollection('blog');\n---\n<BlogSlot>\n  <Fragment slot="posts">\n    ${posts}\n  </Fragment>\n</BlogSlot>\n`;
  const W = (id: string) => `<div class="contents" data-sq-post-slug={${id}}>`;

  it('an AI loop (live: starquix.app/blog) — a JSX comment, then one card per branch of a ternary', () => {
    const loop = '{/* highlight posts render the wide card */}\n    {posts.map((post) => isHighlight(post) ? <BlogCardHighlight post={post} href={`/blog/${post.id}`} /> : <BlogCard post={post} href={`/blog/${post.id}`} />)}';
    const out = stampPostCards(slot(loop), true);
    expect(out).toBe(slot(`{/* highlight posts render the wide card */}\n    {posts.map((post) => isHighlight(post) ? ${W('post.id')}<BlogCardHighlight post={post} href={\`/blog/\${post.id}\`} /></div> : ${W('post.id')}<BlogCard post={post} href={\`/blog/\${post.id}\`} /></div>)}`));
    expect(stampPostCards(out, true)).toBe(out); // idempotent: a stamped tag is left alone
  });

  it('a `)` in a comment or a nested {…} inside the callback does not close it', () => {
    expect(stampPostCards(slot('{posts.map((p) => /* wide) */ fmt({ a: 1 }) && <A post={p} />)}'), false))
      .toBe(slot(`{posts.map((p) => /* wide) */ fmt({ a: 1 }) && ${W('p.slug')}<A post={p} /></div>)}`));
  });

  it('any entry name, extra params, a chained call, a multi-line card', () => {
    expect(stampPostCards(slot('{posts.map((p, i) => <A post={p} />)}'), false)).toBe(slot(`{posts.map((p, i) => ${W('p.slug')}<A post={p} /></div>)}`));
    expect(stampPostCards(slot('{posts.map(p => <A post={p} />).slice(0, 3)}'), false)).toBe(slot(`{posts.map(p => ${W('p.slug')}<A post={p} /></div>).slice(0, 3)}`));
    expect(stampPostCards(slot('{posts.map((post) => (\n      <a href="/x"><A post={post} /></a>\n    ))}'), false))
      .toBe(slot(`{posts.map((post) => (\n      ${W('post.slug')}<a href="/x"><A post={post} /></a></div>\n    ))}`));
  });

  it('leaves alone: the binding\'s own loop, a tag outside the map callback, a non-BlogSlot posts fragment', () => {
    const bound = slot('{posts.map((post) => <div class="contents" data-sq-post-slug={post.slug}><A post={post} /></div>)}');
    expect(stampPostCards(bound, false)).toBe(bound);
    expect(stampPostCards(slot('{posts.length ? posts.map((p) => <A post={p} />) : <p>No (posts) yet</p>}'), false))
      .toBe(slot(`{posts.length ? posts.map((p) => ${W('p.slug')}<A post={p} /></div>) : <p>No (posts) yet</p>}`));
    const other = '<Other>\n  <Fragment slot="posts">{posts.map((p) => <A post={p} />)}</Fragment>\n</Other>\n';
    expect(stampPostCards(other, false)).toBe(other);
  });
});
