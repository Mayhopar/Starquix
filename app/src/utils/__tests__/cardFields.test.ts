import { describe, expect, it } from 'vitest';
import { IMPORTED_CARD } from './fixtures/cards';
import { WORK_CARD } from './fixtures/lists';
import { cardCollectionOf, cardLinksItself, cardNameFor, DEFAULT_CARD, entryVarOf, isCardSource, scanCardFields, setCardFieldVisible } from '../cardFields';

// Mirrors preview-template/src/components/library/BlogCard.astro.
export const LIB_CARD = `---
const { post: postProp } = Astro.props;
const post = postProp ?? { data: { title: 'Sample post', description: 'A short description of this post.', date: '2026-01-01' } };
---
<article class="rounded-lg border border-gray-200 overflow-hidden flex flex-col bg-white">
  <div class="aspect-video bg-gray-100 flex items-center justify-center">
    <img src={post.data.image?.src ?? post.data.image} alt="" class="w-full h-full object-cover" />
  </div>
  <div class="p-4 bg-white h-full">
    <h3 class="font-semibold text-lg text-black">{post.data.title}</h3>
    <p class="text-gray-600 text-sm mt-1">{post.data.description}</p>
    <time class="text-gray-400 text-xs mt-2 block">{post.data.date}</time>
  </div>
</article>
`;

describe('scanCardFields', () => {
  it('reads plain, image and guarded field elements as on-card', () => {
    const guarded = LIB_CARD.replace('</time>', '</time>\n    {post.data.author && <p class="text-xs">{post.data.author}</p>}');
    expect(Object.fromEntries(scanCardFields(guarded))).toEqual({
      image: 'on-card', title: 'on-card', description: 'on-card', date: 'on-card', author: 'on-card',
    });
  });
  it('a field only used in custom code is custom', () => {
    const src = LIB_CARD.replace('{post.data.date}', '{formatDate(post.data.date)}');
    expect(scanCardFields(src).get('date')).toBe('custom');
  });
  it('a date in a picked format is still the date field element: on-card, its eye hides it (owner 2026-10-10)', () => {
    const src = LIB_CARD.replace('{post.data.date}', "{post.data.date && new Date(post.data.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}");
    expect(scanCardFields(src).get('date')).toBe('on-card');
    expect(scanCardFields(setCardFieldVisible(src, 'date', false)).get('date')).toBe('hidden');
  });
  it('ignores the frontmatter', () => {
    const src = LIB_CARD.replace('const post =', 'const t = post.data.secret;\nconst post =');
    expect(scanCardFields(src).has('secret')).toBe(false);
  });
});


describe('cardNameFor', () => {
  it('names a collection card in PascalCase', () => {
    expect(cardNameFor('works')).toBe('WorksCard');
    expect(cardNameFor('my-posts')).toBe('MyPostsCard');
    expect(cardNameFor('2024_notes')).toBe('C2024NotesCard');
    expect(cardNameFor('blog')).toBe('BlogCard');
  });
});

describe('field eyes (per collection card, owner 2026-10-09)', () => {
  it('eye off: the element is wrapped in a show guard and `show` records false; scan reads hidden', () => {
    const out = setCardFieldVisible(LIB_CARD, 'description', false);
    expect(out).toContain('const show = { description: false };');
    expect(out).toContain('    {show.description && <p class="text-gray-600 text-sm mt-1">{post.data.description}</p>}');
    expect(scanCardFields(out).get('description')).toBe('hidden');
    expect(scanCardFields(out).get('title')).toBe('on-card');
  });
  it('eye on again: value flips back, markup kept (styling survives); idempotent wrap', () => {
    const off = setCardFieldVisible(LIB_CARD, 'description', false);
    const on = setCardFieldVisible(off, 'description', true);
    expect(on).toContain('const show = { description: true };');
    expect(on.match(/show\.description &&/g)).toHaveLength(1);
    expect(scanCardFields(on).get('description')).toBe('on-card');
    expect(setCardFieldVisible(setCardFieldVisible(on, 'description', false), 'description', true)).toBe(on);
  });
  it('a second field joins the same show object', () => {
    const out = setCardFieldVisible(setCardFieldVisible(LIB_CARD, 'description', false), 'date', false);
    expect(out).toContain('const show = { description: false, date: false };');
  });
  it('an image that is the only child of its box hides with the box', () => {
    const out = setCardFieldVisible(LIB_CARD, 'image', false);
    expect(out).toMatch(/\{show\.image && <div class="aspect-video[^"]*">\s*<img [^\n]*\/>\s*<\/div>\}/);
    expect(scanCardFields(out).get('image')).toBe('hidden');
  });
  it('a guarded element takes the eye inside its braces (valid JSX), once', () => {
    const src = LIB_CARD.replace('</time>', '</time>\n    {post.data.author && <p class="text-xs">{post.data.author}</p>}');
    const off = setCardFieldVisible(src, 'author', false);
    expect(off).toContain('{show.author && post.data.author && <p class="text-xs">{post.data.author}</p>}');
    expect(scanCardFields(off).get('author')).toBe('hidden');
    expect(setCardFieldVisible(setCardFieldVisible(off, 'author', true), 'author', false)).toBe(off);
  });
  it('a field with no element (absent / custom code) is left alone', () => {
    expect(setCardFieldVisible(LIB_CARD, 'author', false)).toBe(LIB_CARD);
  });
});

describe('imported cards', () => {
  it('reads fields through any entry name and Astro <Image>', () => {
    expect(entryVarOf(IMPORTED_CARD)).toBe('work');
    expect(Object.fromEntries(scanCardFields(IMPORTED_CARD))).toEqual({ image: 'on-card', title: 'on-card', description: 'on-card' });
  });
  it('eyes work on an imported card (multi-line element, <Image>)', () => {
    const off = setCardFieldVisible(IMPORTED_CARD, 'description', false);
    expect(off).toContain('const show = { description: false };');
    expect(off).toMatch(/\{show\.description && <p class="description[\s\S]*?<\/p>\}/);
    expect(scanCardFields(off).get('description')).toBe('hidden');
    const img = setCardFieldVisible(IMPORTED_CARD, 'image', false);
    expect(img).toMatch(/\{show\.image && <Image[\s\S]*?<\/Image>\}/);
    expect(scanCardFields(img).get('image')).toBe('hidden');
  });
  it('the collection a card serves', () => {
    expect(cardCollectionOf(IMPORTED_CARD)).toBe('works');
    expect(cardCollectionOf(DEFAULT_CARD)).toBeNull();
  });
});

describe('never a made-up element (owner 2026-10-11)', () => {
  it('eye on for a field the card has no element for leaves the card unchanged', () => {
    expect(setCardFieldVisible(LIB_CARD, 'author', true)).toBe(LIB_CARD);
    expect(setCardFieldVisible(IMPORTED_CARD, 'role', true, 'text')).toBe(IMPORTED_CARD);
    expect(setCardFieldVisible(LIB_CARD, 'cover', true, 'image')).toBe(LIB_CARD);
  });
  it('the eye still hides and shows an element the card has', () => {
    const off = setCardFieldVisible(LIB_CARD, 'date', false);
    expect(scanCardFields(off).get('date')).toBe('hidden');
    expect(scanCardFields(setCardFieldVisible(off, 'date', true)).get('date')).toBe('on-card');
  });
});

describe('isCardSource — one card per collection, lists are not cards', () => {
  it('a component handed ONE entry as a prop is a card (ours and imported)', () => {
    expect(isCardSource(DEFAULT_CARD)).toBe(true);
    expect(isCardSource(IMPORTED_CARD)).toBe(true);
  });
  it('a list that fetches the collection itself is not', () => {
    const list = `---\nimport { getCollection } from 'astro:content';\nconst works = await getCollection('works');\n---\n<ul>{works.map((work) => <li><h2>{work.data.title}</h2></li>)}</ul>\n`;
    expect(isCardSource(list)).toBe(false);
  });
  it('a component with no entry prop is not', () => {
    expect(isCardSource('---\nconst work = { data: { title: "x" } };\n---\n<h1>{work.data.title}</h1>\n')).toBe(false);
  });
});

import { fieldElements } from '../cardFields';
import { writeSetup } from '../cardSetup';
const BLOCK_CARD = writeSetup(
  DEFAULT_CARD
    .replace('<img src={post.data.image?.src ?? post.data.image}', "{f('image') && <img src={f('image')?.src ?? f('image')}")
    .replace('class="w-full h-full object-cover" />', 'class="w-full h-full object-cover" />}')
    .replace('{post.data.title}', "{f('title')}")
    .replace('<p class="text-gray-600 text-sm mt-1">{post.data.description}</p>', "{f('description') && <p class=\"text-gray-600 text-sm mt-1\">{f('description')}</p>}")
    .replace('{post.data.date}', "{f('date')}"),
  new Map([['blog', new Map<string, string | null>([['image', null], ['title', 'title'], ['description', '!subtitle'], ['date', 'date']])]]),
);

describe('block form', () => {
  it('is a card', () => expect(isCardSource(BLOCK_CARD)).toBe(true));
  it('field elements are its slots (guarded, plain, image)', () => {
    expect(fieldElements(BLOCK_CARD).map((e) => e.field)).toEqual(['image', 'title', 'description', 'date']);
  });
  it('scanCardFields reports slots as on-card', () => {
    expect([...scanCardFields(BLOCK_CARD).keys()]).toEqual(['image', 'title', 'description', 'date']);
  });
  it('entryVarOf finds the entry through the helper when no plain read is left', () => {
    expect(entryVarOf(BLOCK_CARD.replace(/\bpost\b/g, 'work').replace(/postProp/g, 'workProp'))).toBe('work');
  });
});

describe('cardLinksItself (task-244 L11)', () => {
  it('a content-layer card links by its entry id (Astro >=5, or after the on-open Astro upgrade)', () => {
    expect(cardLinksItself("---\nconst { work } = Astro.props;\n---\n<a href={`/works/${work.id}`}>{work.data.title}</a>\n")).toBe(true);
  });
  it('a card whose href uses ${x.slug} links itself; the default card does not', () => {
    expect(cardLinksItself(WORK_CARD)).toBe(true);
    expect(cardLinksItself(DEFAULT_CARD)).toBe(false);
    expect(cardLinksItself(LIB_CARD)).toBe(false);
  });
});

