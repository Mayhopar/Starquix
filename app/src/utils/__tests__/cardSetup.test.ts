import { describe, expect, it } from 'vitest';
import { DEFAULT_CARD, entryVarOf } from '@/utils/cardFields';
import { readSetup, writeSetup, type Setup } from '../cardSetup';

const setup = (): Setup => new Map([
  ['works', new Map<string, string | null>([['preview1', 'preview1'], ['title', 'title'], ['year', 'year']])],
  ['blog', new Map<string, string | null>([['preview1', '!cover'], ['title', 'title'], ['year', null]])],
]);

describe('fields block', () => {
  it('a card without the block → null', () => {
    expect(readSetup(DEFAULT_CARD)).toBeNull();
  });
  it('write then read round-trips; the block sits at the end of the frontmatter with the f() helper', () => {
    const out = writeSetup(DEFAULT_CARD, setup());
    expect(readSetup(out)).toEqual(setup());
    expect(out).toContain('// sq:fields');
    expect(out).toContain("  'blog': { preview1: '!cover', title: 'title', year: null },");
    expect(out).toMatch(/const f = \(slot: string\): any => \{[^\n]*\(post as any\)\.collection[^\n]*\};\n---/);
    expect(entryVarOf(out)).toBe('post');
  });
  it('rewriting replaces the block in place (one block only)', () => {
    const once = writeSetup(DEFAULT_CARD, setup());
    const s2 = setup(); s2.get('blog')!.set('year', 'date');
    const twice = writeSetup(once, s2);
    expect(twice.match(/sq:fields/g)).toHaveLength(1);
    expect(readSetup(twice)!.get('blog')!.get('year')).toBe('date');
  });
  it('an empty setup round-trips', () => {
    const out = writeSetup(DEFAULT_CARD, new Map());
    expect(readSetup(out)).toEqual(new Map());
    expect(readSetup(writeSetup(out, setup()))).toEqual(setup());
  });
  it('a hand-edited block that no longer parses reads as "custom"', () => {
    const broken = writeSetup(DEFAULT_CARD, setup()).replace("'blog': {", "'blog': {{");
    expect(readSetup(broken)).toBe('custom');
  });
  it('collection keys with dashes are quoted', () => {
    const out = writeSetup(DEFAULT_CARD, new Map([['my-posts', new Map<string, string | null>([['title', 'title']])]]));
    expect(out).toContain("'my-posts': { title: 'title' },");
    expect(readSetup(out)!.has('my-posts')).toBe(true);
  });
});

import { IMPORTED_CARD } from './fixtures/cards';
import { promoteCard } from '../cardSetup';
import { fieldElements, setCardFieldVisible } from '@/utils/cardFields';

describe('promoteCard', () => {
  it("imported card: work.data.x → f('x') guarded; <Image> → <img src={f(x)?.src ?? f(x)}>; identity setup for its collection", () => {
    const out = promoteCard(IMPORTED_CARD, 'works');
    expect(out).toMatch(/\{f\('image'\) && <img\b[^>]*src=\{f\('image'\)\?\.src \?\? f\('image'\)\}/);
    expect(out).not.toMatch(/<\/?Image\b(?! \})/);
    expect(out).toContain("{f('title')}");
    expect(out).not.toMatch(/\{f\('title'\) &&/);
    expect(out).toMatch(/\{f\('description'\) && <p\b/);
    expect(readSetup(out)).toEqual(new Map([['works', new Map([['image', 'image'], ['title', 'title'], ['description', 'description']])]]));
    expect(out).toContain('alt={work.data.title}');
    expect(out).toContain('(work as any).collection]');
    expect(fieldElements(out).map((e) => e.field)).toEqual(['image', 'title', 'description']);
  });
  it("an eye (show.x false) becomes '!x' and the show line is gone", () => {
    const eyed = setCardFieldVisible(DEFAULT_CARD, 'description', false);
    const out = promoteCard(eyed, 'blog');
    expect(out).not.toContain('const show');
    expect(out).not.toContain('show.description');
    expect(out).toContain(`{f('description') && <p class="text-gray-600 text-sm mt-1">{f('description')}</p>}`);
    expect(readSetup(out)!.get('blog')!.get('description')).toBe('!description');
  });
  it('an eyed image box loses the eye, keeps the box', () => {
    const out = promoteCard(setCardFieldVisible(DEFAULT_CARD, 'image', false), 'blog');
    expect(out).not.toContain('show.');
    expect(out).toMatch(/<div class="aspect-video[^"]*">\s*\{f\('image'\) && <img src=\{f\('image'\)\?\.src \?\? f\('image'\)\}/);
  });
  it('a value-guarded element keeps one guard', () => {
    const guarded = DEFAULT_CARD.replace('</time>', '</time>\n    {post.data.author && <p class="text-xs">{post.data.author}</p>}');
    expect(promoteCard(guarded, 'blog')).toContain(`{f('author') && <p class="text-xs">{f('author')}</p>}`);
  });
  it('an unassigned card promotes with NO rows', () => {
    expect(readSetup(promoteCard(DEFAULT_CARD, null))).toEqual(new Map());
  });
  it('already block form → unchanged', () => {
    const once = promoteCard(IMPORTED_CARD, 'works');
    expect(promoteCard(once, 'works')).toBe(once);
  });
});

import { autoSetup, assignCard, cardCollectionsOf } from '../cardSetup';

describe('autoSetup (design §4)', () => {
  const slots = [{ name: 'preview1', kind: 'image' as const }, { name: 'title', kind: 'text' as const }, { name: 'year', kind: 'text' as const }, { name: 'role', kind: 'text' as const }];
  it('same name+kind → mapped; image → first image field; title → title; rest null', () => {
    const blog = [{ name: 'title', type: 'text' }, { name: 'cover', type: 'image' }, { name: 'year', type: 'text' }];
    expect(autoSetup(slots, blog)).toEqual(new Map([['preview1', 'cover'], ['title', 'title'], ['year', 'year'], ['role', null]]));
  });
  it('no title field → title maps to the first text field; no image field → image slot null', () => {
    const notes = [{ name: 'heading', type: 'text' }];
    expect(autoSetup(slots, notes)).toEqual(new Map([['preview1', null], ['title', 'heading'], ['year', null], ['role', null]]));
  });
  it('an image field never fills a text slot of the same name', () => {
    expect(autoSetup([{ name: 'cover', kind: 'text' }], [{ name: 'cover', type: 'image' }]).get('cover')).toBeNull();
  });
});

const BLOG_FIELDS = [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }, { name: 'date', type: 'date' }];

describe('assignCard', () => {
  it('works card → also blog: promoted, works row identity, blog row auto, type is the union', () => {
    const out = assignCard(IMPORTED_CARD, 'blog', BLOG_FIELDS, 'works');
    expect(readSetup(out)!.get('blog')).toEqual(new Map([['image', null], ['title', 'title'], ['description', null]]));
    expect(readSetup(out)!.get('works')!.get('image')).toBe('image');
    expect(out).toContain('CollectionEntry<"works"> | CollectionEntry<"blog">');
    expect(cardCollectionsOf(out)).toEqual(['works', 'blog']);
  });
  it('already assigned → unchanged (no undo entry)', () => {
    expect(assignCard(IMPORTED_CARD, 'works', [], 'works')).toBe(IMPORTED_CARD);
    const two = assignCard(IMPORTED_CARD, 'blog', BLOG_FIELDS, 'works');
    expect(assignCard(two, 'blog', BLOG_FIELDS, 'works')).toBe(two);
  });
  it('unassigned card whose slots all exist in the collection → plain form, just the type line', () => {
    const fields = ['image', 'title', 'description', 'date'].map((name) => ({ name, type: name === 'image' ? 'image' : 'text' }));
    const out = assignCard(DEFAULT_CARD, 'news', fields, null);
    expect(readSetup(out)).toBeNull();
    expect(out).toContain('CollectionEntry<"news">');
  });
  it('unassigned card that does NOT fit → promoted with one row', () => {
    const out = assignCard(DEFAULT_CARD, 'blog', BLOG_FIELDS, null);
    expect([...(readSetup(out) as Setup).keys()]).toEqual(['blog']);
    expect(out).toContain('CollectionEntry<"blog">');
  });
  it('a slot hidden in every existing row stays hidden in a new row, even when the new collection has that field (owner 2026-10-11)', () => {
    const src = `---
import {type CollectionEntry} from "astro:content"
type Props = { work: CollectionEntry<"blog"> }
const {work} = Astro.props
// sq:fields — what each collection shows in this card ('!x' = x hidden); Starquix keeps it in sync
const fields = {
  'blog': { title: 'title', year: 'year', date: '!date' },
};
const f = (slot: string): any => { const s = (fields as Record<string, Record<string, string | null>>)[work.collection]; const k = s ? s[slot] : slot; return k && k[0] !== '!' ? (work.data as Record<string, any>)[k] : undefined; };
---
<article><h1>{f('title')}</h1>{f('year') && <p>{f('year')}</p>}{f('date') && <p class="text-sm">{f('date')}</p>}</article>
`;
    const out = assignCard(src, 'works', [{ name: 'title', type: 'text' }, { name: 'year', type: 'text' }, { name: 'date', type: 'date' }], 'blog');
    const works = readSetup(out) as Setup;
    expect(works.get('works')!.get('date')).toBe('!date');
    expect(works.get('works')!.get('year')).toBe('year');
    expect(works.get('works')!.get('title')).toBe('title');
  });
  it('a third collection adds a row; the type union grows', () => {
    const two = assignCard(IMPORTED_CARD, 'blog', BLOG_FIELDS, 'works');
    const three = assignCard(two, 'notes', [{ name: 'title', type: 'text' }], 'works');
    expect(cardCollectionsOf(three)).toEqual(['works', 'blog', 'notes']);
    expect(three).toContain('CollectionEntry<"works"> | CollectionEntry<"blog"> | CollectionEntry<"notes">');
  });
  it('a hand-edited block is refused', () => {
    const custom = assignCard(IMPORTED_CARD, 'blog', BLOG_FIELDS, 'works').replace("'blog': {", "'blog': {{");
    expect(() => assignCard(custom, 'notes', [], 'works')).toThrow(/edited by hand/);
  });
});

import { setSlotField, setFieldVisibleIn, fieldStatesIn } from '../cardSetup';

describe('per-collection edits', () => {
  const two = () => assignCard(IMPORTED_CARD, 'blog', BLOG_FIELDS, 'works');
  it('setSlotField maps one slot in ONE collection', () => {
    const out = setSlotField(two(), 'blog', 'description', 'subtitle');
    expect(readSetup(out)!.get('blog')!.get('description')).toBe('subtitle');
    expect(readSetup(out)!.get('works')!.get('description')).toBe('description');
  });
  it('fieldStatesIn: per collection field → on-card / hidden', () => {
    const out = setSlotField(two(), 'blog', 'description', 'subtitle');
    expect(fieldStatesIn(out, 'blog')).toEqual(new Map([['title', 'on-card'], ['subtitle', 'on-card']]));
  });
  it("eye off keeps the mapping ('!x'); eye on restores it", () => {
    const shown = setSlotField(two(), 'blog', 'description', 'subtitle');
    const off = setFieldVisibleIn(shown, 'blog', 'subtitle', false, 'text');
    expect(readSetup(off)!.get('blog')!.get('description')).toBe('!subtitle');
    expect(fieldStatesIn(off, 'blog').get('subtitle')).toBe('hidden');
    expect(setFieldVisibleIn(off, 'blog', 'subtitle', true, 'text')).toBe(shown);
  });
  it('eye on for a field no slot shows → unchanged: never a made-up element (owner 2026-10-11)', () => {
    expect(setFieldVisibleIn(two(), 'blog', 'date', true, 'date')).toBe(two());
  });
  it('the title slot can never be unmapped or hidden', () => {
    expect(() => setSlotField(two(), 'blog', 'title', null)).toThrow(/title/);
    expect(() => setFieldVisibleIn(two(), 'blog', 'title', false, 'text')).toThrow(/title/);
  });
});

describe('deleted element (owner 2026-10-11)', () => {
  it('a row whose element was deleted is no longer a field of the card', () => {
    const two = assignCard(IMPORTED_CARD, 'blog', [{ name: 'title', type: 'text' }, { name: 'description', type: 'text' }], 'works');
    const deleted = two.replace(/\{f\('description'\) && <p[\s\S]*?<\/p>\}/, '');
    expect(fieldStatesIn(two, 'works').has('description')).toBe(true);
    expect(fieldStatesIn(deleted, 'works').has('description')).toBe(false);
  });
});

describe('L19', () => {
  it('a deleted slot element leaves every row on the next setup write', () => {
    const two = assignCard(IMPORTED_CARD, 'blog', BLOG_FIELDS, 'works');
    const gone = two.replace(/\{f\('description'\) && <p[\s\S]*?<\/p>\}/, '');
    const out = setSlotField(gone, 'blog', 'title', 'subtitle');
    expect([...(readSetup(out) as Setup).values()].every((r) => !r.has('description'))).toBe(true);
  });
});
