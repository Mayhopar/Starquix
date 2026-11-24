import { describe, expect, it } from 'vitest';
import { DEFAULT_CARD } from '@/utils/cardFields';
import { IMPORTED_CARD } from './fixtures/cards';
import { FEATURED_WORK, TWO_SLOTS, WORK_CARD } from './fixtures/lists';
import { assignCard } from '../cardSetup';
import { assignCards, entryPropOf, planCardDelete, planCardMove, planMissingCards, setCardCollection, usageCollections } from '../cardAssignment';

describe('setCardCollection', () => {
  it('replaces an existing CollectionEntry type in place', () => {
    const out = setCardCollection(IMPORTED_CARD, 'blog');
    expect(out).toContain('type Props = { work: CollectionEntry<"blog"> }');
    expect(out.match(/CollectionEntry/g)).toHaveLength(2); // the import + the one use
  });
  it('an untyped card gets the import and a Props line above its props destructure', () => {
    const out = setCardCollection(DEFAULT_CARD, 'works');
    expect(out.match(/import type \{ CollectionEntry \} from 'astro:content';/g)).toHaveLength(1);
    expect(out).toMatch(/type Props = \{ post\?: CollectionEntry<"works"> \};\nconst \{ post: postProp \} = Astro\.props;/);
  });
  it('a card already importing CollectionEntry (unused) does not get a second import', () => {
    const src = DEFAULT_CARD.replace('---\n', "---\nimport type { CollectionEntry } from 'astro:content';\n");
    expect(setCardCollection(src, 'works').match(/import type \{ CollectionEntry \}/g)).toHaveLength(1);
  });
  it('same collection → unchanged', () => {
    expect(setCardCollection(IMPORTED_CARD, 'works')).toBe(IMPORTED_CARD);
  });
  it('a card declaring its own Props without CollectionEntry is refused (user code)', () => {
    const own = DEFAULT_CARD.replace('const { post: postProp }', 'interface Props { post: any }\nconst { post: postProp }');
    expect(() => setCardCollection(own, 'works')).toThrow(/declares its own Props/);
  });
});

describe('usageCollections', () => {
  it('a file fetching ONE collection assigns every component it renders to it', () => {
    const files = {
      'src/components/WorkList.astro': `---\nimport { getCollection } from 'astro:content';\nimport WorkCard from './WorkCard.astro';\nconst works = await getCollection('works');\n---\n<ul>{works.map((w) => <WorkCard work={w} />)}</ul>\n`,
      'src/pages/blog.astro': `---\nimport { getCollection } from 'astro:content';\nimport WorksCard from '../components/WorksCard.astro';\nconst posts = (await getCollection('blog'));\n---\n{posts.map((post) => <WorksCard post={post} />)}\n`,
    };
    expect(usageCollections(files)).toEqual(new Map([
      ['src/components/WorkCard.astro', new Set(['works'])],
      ['src/components/WorksCard.astro', new Set(['blog'])],
    ]));
  });
  it('a file fetching two collections assigns nothing (ambiguous)', () => {
    const f = { 'src/pages/i.astro': `---\nimport A from '../components/A.astro';\nconst a = await getCollection('works'); const b = await getCollection('blog');\n---\n<A x={a[0]} />\n` };
    expect(usageCollections(f).size).toBe(0);
  });
});

describe('assignCards', () => {
  const collections = ['works', 'blog'];
  it('type > name > usage > unassigned; conflict = typed but rendered with another collection', () => {
    const cards = {
      'src/components/FeaturedWork.astro': IMPORTED_CARD, // typed works
      'src/components/WorksCard.astro': DEFAULT_CARD, // name
      'src/components/BlogCard.astro': DEFAULT_CARD, // name: `blog` owns BlogCard (design C1)
      'src/components/WorkCard.astro': DEFAULT_CARD, // usage
      'src/components/ArticleCard.astro': DEFAULT_CARD, // nothing → unassigned
    };
    const usage = new Map([
      ['src/components/WorkCard.astro', new Set(['works'])],
      ['src/components/FeaturedWork.astro', new Set(['works', 'blog'])],
    ]);
    const a = assignCards({ components: cards, usage, collections });
    expect(a.get('src/components/FeaturedWork.astro')).toEqual({ card: true, collections: ['works'], typed: 'works', conflict: ['blog'] });
    expect(a.get('src/components/WorksCard.astro')).toEqual({ card: true, collections: ['works'], typed: null, conflict: [] });
    expect(a.get('src/components/BlogCard.astro')).toEqual({ card: true, collections: ['blog'], typed: null, conflict: [] });
    expect(a.get('src/components/WorkCard.astro')).toEqual({ card: true, collections: ['works'], typed: null, conflict: [] });
    expect(a.get('src/components/ArticleCard.astro')).toEqual({ card: true, collections: [], typed: null, conflict: [] });
  });
  it('a type wins over the name', () => {
    const a = assignCards({ components: { 'src/components/WorksCard.astro': setCardCollection(DEFAULT_CARD, 'blog') }, usage: new Map(), collections });
    expect(a.get('src/components/WorksCard.astro')!.collections).toEqual(['blog']);
  });
  it('a collection named in the type but missing on disk falls through to unassigned', () => {
    const a = assignCards({ components: { 'src/components/X.astro': setCardCollection(DEFAULT_CARD, 'gone') }, usage: new Map(), collections });
    expect(a.get('src/components/X.astro')).toEqual({ card: true, collections: [], typed: 'gone', conflict: [] });
  });
  it('a list belongs to the collection it fetches / is typed for; a component with no collection is absent', () => {
    const fetching = `---\nconst works = await getCollection('works');\n---\n{works.map((w) => <p>{w.data.title}</p>)}\n`;
    const typedList = `---\nimport type { CollectionEntry } from 'astro:content';\ntype Props = { works: CollectionEntry<"blog">[] };\nconst { works } = Astro.props;\n---\n<ul>{works.map((w) => <li />)}</ul>\n`;
    const a = assignCards({ components: { 'src/components/WorkList.astro': fetching, 'src/components/Featured.astro': typedList, 'src/components/Hero.astro': '<h1>Hi</h1>' }, usage: new Map(), collections });
    expect(a.get('src/components/WorkList.astro')).toEqual({ card: false, collections: ['works'], typed: 'works', conflict: [] });
    expect(a.get('src/components/Featured.astro')).toEqual({ card: false, collections: ['blog'], typed: 'blog', conflict: [] });
    expect(a.has('src/components/Hero.astro')).toBe(false);
  });
  it('page chrome rendered by a page that fetches a collection is NOT that collection\'s (no usage for non-cards)', () => {
    const main = `---\nimport '../styles.css';\n---\n<main><slot /></main>\n`;
    const a = assignCards({ components: { 'src/components/Main.astro': main }, usage: new Map([['src/components/Main.astro', new Set(['works'])]]), collections });
    expect(a.has('src/components/Main.astro')).toBe(false);
  });
});

describe('planCardMove (drop a card on a collection = its listings render it)', () => {
  const BLOG_PAGE = `---\nimport { getCollection } from 'astro:content';\nimport BlogSlot from '../components/BlogSlot.astro';\nimport BlogCard from '../components/BlogCard.astro';\nconst posts = (await getCollection('blog'));\n---\n<BlogSlot>\n  <Fragment slot="posts">\n    {posts.map((post) => <a href={\`/blog/\${post.slug}\`} class="block"><BlogCard post={post} /></a>)}\n  </Fragment>\n</BlogSlot>\n`;
  const files = {
    'src/pages/blog.astro': BLOG_PAGE,
    'src/components/BlogCard.astro': DEFAULT_CARD,
    'src/components/BlogSlot.astro': '<div><slot name="posts" /></div>',
    'src/components/WorkCard.astro': IMPORTED_CARD.replace('const {work}', 'const {work}'),
  };
  it('the blog listing swaps BlogCard for WorkCard (import, tag, entry prop) and the card is typed blog', () => {
    const { writes, listings } = planCardMove(files, 'src/components/WorkCard.astro', 'blog');
    expect(listings).toEqual(['src/pages/blog.astro']);
    const page = writes['src/pages/blog.astro'];
    expect(page).toContain('<WorkCard work={post} />');
    expect(page).toContain("import WorkCard from '../components/WorkCard.astro';");
    expect(page).not.toContain('BlogCard');
    expect(page).toContain('<BlogSlot>'); // non-cards untouched
    expect(writes['src/components/WorkCard.astro']).toContain('CollectionEntry<"blog">');
  });
  it('a commented-out card tag does not keep the old card\'s import', () => {
    const page = BLOG_PAGE.replace('<BlogSlot>', '<!-- <BlogCard post={post} /> -->\n<BlogSlot>');
    const { writes } = planCardMove({ ...files, 'src/pages/blog.astro': page }, 'src/components/WorkCard.astro', 'blog');
    expect(writes['src/pages/blog.astro']).not.toContain('import BlogCard');
  });
  it('no page shows that collection → only the card, zero listings', () => {
    const { writes, listings } = planCardMove(files, 'src/components/WorkCard.astro', 'notes');
    expect(listings).toEqual([]);
    expect(Object.keys(writes)).toEqual(['src/components/WorkCard.astro']);
  });
  it('entryPropOf reads the prop name, renamed or not', () => {
    expect(entryPropOf(DEFAULT_CARD)).toBe('post');
    expect(entryPropOf(IMPORTED_CARD)).toBe('work');
  });
  it('a list typed for a collection feeds the cards it renders (WorkList → WorkCard)', () => {
    const list = `---\nimport type { CollectionEntry } from 'astro:content';\nimport WorkCard from './WorkCard.astro';\ntype Props = { works: CollectionEntry<"works">[] };\nconst { works } = Astro.props;\n---\n<ul>{works.map((w) => <WorkCard work={w} />)}</ul>\n`;
    expect(usageCollections({ 'src/components/WorkList.astro': list }).get('src/components/WorkCard.astro')).toEqual(new Set(['works']));
  });
});

describe('planCardMove — per listing (cards-any-collection L21)', () => {
  const BLOG_LIST = (card: string, imp: string) => `---\nimport { getCollection } from 'astro:content';\nimport ${card} from '../components/${imp}.astro';\nconst posts = await getCollection('blog');\n---\n{posts.map((post) => <${card} post={post} />)}\n`;
  it('onlyFile: only that listing is rewired; the card is assigned (block form, union type) — never a value guard', () => {
    const files = {
      'src/pages/blog.astro': BLOG_LIST('BlogCard', 'BlogCard'),
      'src/pages/news.astro': BLOG_LIST('BlogCard', 'BlogCard'),
      'src/components/BlogCard.astro': DEFAULT_CARD,
      'src/components/WorkCard.astro': IMPORTED_CARD,
    };
    const fields = [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }];
    const { writes, listings } = planCardMove(files, 'src/components/WorkCard.astro', 'blog', fields, { onlyFile: 'src/pages/blog.astro', current: 'works' });
    expect(listings).toEqual(['src/pages/blog.astro']);
    expect(writes['src/pages/news.astro']).toBeUndefined();
    expect(writes['src/components/WorkCard.astro']).toContain('CollectionEntry<"works"> | CollectionEntry<"blog">');
    expect(writes['src/components/WorkCard.astro']).toContain('// sq:fields');
    expect(writes['src/components/WorkCard.astro']).not.toContain('work.data.image && ');
  });
  it('a card already set up for the collection is not rewritten', () => {
    const files = { 'src/pages/blog.astro': BLOG_LIST('BlogCard', 'BlogCard'), 'src/components/BlogCard.astro': DEFAULT_CARD, 'src/components/WorkCard.astro': setCardCollection(IMPORTED_CARD, 'blog') };
    const { writes } = planCardMove(files, 'src/components/WorkCard.astro', 'blog', [], { onlyFile: 'src/pages/blog.astro', current: 'blog' });
    expect(Object.keys(writes)).toEqual(['src/pages/blog.astro']);
  });
});

describe('assignCards — any number of collections (cards-any-collection)', () => {
  it('a block-form card serves every collection in its block (that exists)', () => {
    const card = assignCard(IMPORTED_CARD, 'blog', [{ name: 'title', type: 'text' }], 'works');
    const a = assignCards({ components: { 'src/components/W.astro': card }, usage: new Map(), collections: ['works', 'blog'] });
    expect(a.get('src/components/W.astro')).toEqual({ card: true, collections: ['works', 'blog'], typed: 'works', conflict: [] });
  });
  it('a collection deleted on disk drops out (L9)', () => {
    const card = assignCard(IMPORTED_CARD, 'gone', [], 'works');
    expect(assignCards({ components: { 'src/components/W.astro': card }, usage: new Map(), collections: ['works'] }).get('src/components/W.astro')!.collections).toEqual(['works']);
  });
  it('conflict = rendered with a collection the card is not set up for (L10)', () => {
    const a = assignCards({ components: { 'src/components/W.astro': IMPORTED_CARD }, usage: new Map([['src/components/W.astro', new Set(['works', 'blog'])]]), collections: ['works', 'blog'] });
    expect(a.get('src/components/W.astro')!.conflict).toEqual(['blog']);
  });
});

describe('planCardMove — one BlogSlot of a multi-slot page (task-244 L19)', () => {
  it('picking a card for slot 1 swaps only that block; slot 0 and its import stay', () => {
    const typed = (src: string) => src.replace('CollectionEntry<"blog">', 'CollectionEntry<"works">');
    const files = {
      'src/pages/index.astro': TWO_SLOTS,
      'src/components/FeaturedWork.astro': typed(FEATURED_WORK),
      'src/components/WorkCard.astro': typed(WORK_CARD),
    };
    const { writes } = planCardMove(files, 'src/components/FeaturedWork.astro', 'works', [], { onlyFile: 'src/pages/index.astro', slot: 1, current: 'works' });
    const out = writes['src/pages/index.astro'];
    expect(out).toContain('{posts.map((post) => <div data-sq-post-slug={post.slug}><FeaturedWork work={post} /></div>)}');
    expect(out).toContain('<FeaturedWork work={post} /></a>)}'); // slot 1 now renders FeaturedWork
    expect(out).not.toContain('<WorkCard');
    expect(out).not.toContain('import WorkCard');
    expect(out.match(/import FeaturedWork/g)).toHaveLength(1);
    const back = planCardMove({ ...files, 'src/pages/index.astro': out }, 'src/components/WorkCard.astro', 'works', [], { onlyFile: 'src/pages/index.astro', slot: 0, current: 'works' }).writes['src/pages/index.astro'];
    expect(back).toContain('{posts.map((post) => <div data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}');
    expect(back).toContain('<FeaturedWork work={post} /></a>)}');
    expect(back).toContain('import FeaturedWork'); // still rendered by slot 1
  });
});


describe('planCardDelete — deleting a card a Blog list renders swaps the card (owner 2026-10-10)', () => {
  const typed = (src: string, c: string) => src.replace('CollectionEntry<"blog">', `CollectionEntry<"${c}">`);
  const BLOG_PAGE = `---\nimport { getCollection } from 'astro:content';\nimport BlogSlot from '../components/BlogSlot.astro';\nimport WorkCard from '../components/WorkCard.astro';\nconst posts = (await getCollection('blog'));\n---\n<BlogSlot>\n  <Fragment slot="posts">\n    {posts.map((post) => <div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}\n  </Fragment>\n</BlogSlot>\n`;
  const assignments = (m: Record<string, string[]>) => new Map(Object.entries(m).map(([f, c]) => [f, { card: true, collections: c, typed: c[0] ?? null, conflict: [] }]));

  it('another card serving the slot collection takes its place; the card file is deleted — one batch', () => {
    const files = { 'src/pages/index.astro': TWO_SLOTS, 'src/components/FeaturedWork.astro': typed(FEATURED_WORK, 'works'), 'src/components/WorkCard.astro': typed(WORK_CARD, 'works') };
    const w = planCardDelete(files, ['src/components/WorkCard.astro'], assignments({ 'src/components/FeaturedWork.astro': ['works'], 'src/components/WorkCard.astro': ['works'] }), () => []);
    expect(w['src/components/WorkCard.astro']).toBeNull();
    expect(w['src/pages/index.astro']).not.toContain('WorkCard');
    expect(w['src/pages/index.astro'].match(/<FeaturedWork work=\{post\} \/>/g)).toHaveLength(2);
  });

  it('the last card for that collection → the Blog\'s basic BlogCard (added from the library when missing)', () => {
    const files = { 'src/pages/blog.astro': BLOG_PAGE, 'src/components/WorkCard.astro': WORK_CARD };
    const w = planCardDelete(files, ['src/components/WorkCard.astro'], assignments({ 'src/components/WorkCard.astro': ['blog'] }), () => []);
    expect(w['src/components/WorkCard.astro']).toBeNull();
    expect(w['src/pages/blog.astro']).toContain('<BlogCard post={post} />');
    expect(w['src/pages/blog.astro']).toContain("import BlogCard from '../components/BlogCard.astro';");
    expect(w['src/components/BlogCard.astro']).toContain('@name BlogCard');
  });

  it('two cards deleted together: one never replaces the other — both lists fall back to BlogCard, one batch', () => {
    const files = { 'src/pages/index.astro': TWO_SLOTS, 'src/components/FeaturedWork.astro': typed(FEATURED_WORK, 'works'), 'src/components/WorkCard.astro': typed(WORK_CARD, 'works') };
    const w = planCardDelete(files, ['src/components/WorkCard.astro', 'src/components/FeaturedWork.astro'], assignments({ 'src/components/FeaturedWork.astro': ['works'], 'src/components/WorkCard.astro': ['works'] }), () => []);
    expect(w['src/components/WorkCard.astro']).toBeNull();
    expect(w['src/components/FeaturedWork.astro']).toBeNull();
    expect(w['src/pages/index.astro']).not.toMatch(/WorkCard|FeaturedWork/);
    expect(w['src/pages/index.astro'].match(/<BlogCard post=\{post\} \/>/g)).toHaveLength(2);
  });

  it('a card no list renders is just deleted', () => {
    const w = planCardDelete({ 'src/components/WorkCard.astro': WORK_CARD }, ['src/components/WorkCard.astro'], assignments({}), () => []);
    expect(w).toEqual({ 'src/components/WorkCard.astro': null });
  });
});

describe('planMissingCards — a slot whose card file is gone heals (owner site 2026-10-10)', () => {
  it('both slots of / switch to the basic BlogCard when their cards were deleted; nothing else changes', () => {
    const files = { 'src/pages/index.astro': TWO_SLOTS };
    const w = planMissingCards(files, () => false, new Map(), () => [{ name: 'title', type: 'text' }]);
    expect(w['src/pages/index.astro'].match(/<BlogCard post=\{post\} \/>/g)).toHaveLength(2);
    expect(w['src/pages/index.astro']).not.toMatch(/WorkCard|FeaturedWork/);
    expect(w['src/components/BlogCard.astro']).toContain('@name BlogCard');
  });
  it('cards that exist → no writes', () => {
    expect(planMissingCards({ 'src/pages/index.astro': TWO_SLOTS }, () => true, new Map(), () => [])).toEqual({});
  });
});

describe('a swap never maps fields blind (live 2026-10-10: title became null)', () => {
  it('fields of the slot collection unknown → that slot is left as it is (healed on a later pass)', () => {
    const w = planMissingCards({ 'src/pages/index.astro': TWO_SLOTS }, () => false, new Map(), () => []);
    expect(w).toEqual({});
  });
});

