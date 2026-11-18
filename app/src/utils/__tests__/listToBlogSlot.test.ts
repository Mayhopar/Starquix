// task-244: simple imported list components (WorkList, FeaturedWorkList)
// become BlogSlots on the page that renders them; anything else is left as
// it is (design docs/plans/2026-10-10-one-reusable-list-design.md §3/§5).
import { describe, expect, it } from 'vitest';
import { convertListsToBlogSlots } from '../listToBlogSlot';
import { parseBlogBindings } from '../blogBinding';
import { DEFAULT_CARD } from '../cardFields';
import { INDEX_PAGE, LIB_BLOG_SLOT, OWNER_BLOG_SLOT, OWNER_FILES, WORK_LIST } from './fixtures/lists';

const OPTS = { blogSlotLibrary: LIB_BLOG_SLOT };
const INDEX = 'src/pages/index.astro';
const OWNER = { ...OWNER_FILES, 'src/components/BlogCard.astro': DEFAULT_CARD };
const run = (files: Record<string, string> = OWNER) => convertListsToBlogSlots(files, OPTS);
const withList = (list: string, files: Record<string, string> = OWNER) => run({ ...files, 'src/components/WorkList.astro': list });
const skippedReason = (r: ReturnType<typeof run>, list: string) => r.skipped.find((s) => s.list === list)?.reason;

describe('convertListsToBlogSlots — the owner site', () => {
  const r = run();
  const page = r.writes[INDEX];

  it('/ becomes two BlogSlots with their own fetch, card and layout classes (design §2)', () => {
    expect(r.converted).toEqual([
      { page: INDEX, list: 'src/components/FeaturedWorkList.astro', slot: 0 },
      { page: INDEX, list: 'src/components/WorkList.astro', slot: 1 },
    ]);
    expect(r.skipped).toEqual([]);
    expect(page).toContain("const posts = (await getCollection('works', (p) => p.data.featured))\n  .sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf());");
    expect(page).toContain("const posts2 = (await getCollection('works', (p) => !p.data.featured))\n  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());");
    expect(page).toContain('\t\t<BlogSlot sectionClass="" postsClass="featured-wrapper mx-auto pt-[2vh] lg:w-[640px] 2xl:w-[768px] zoom-in">\n\t\t  <Fragment slot="posts">\n\t\t    {posts.map((post) => <div class="contents" data-sq-post-slug={post.slug}><FeaturedWork work={post} /></div>)}\n\t\t  </Fragment>\n\t\t</BlogSlot>');
    expect(page).toContain('<BlogSlot sectionClass="" postsClass="m-auto max-w-[484px] lg:w-[640px] grid grid-cols-2 grid-flow-row gap-20 items-start mt-64 2xl:w-[768px] pb-[16vh]">');
    expect(page).toContain('{posts2.map((post) => <div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}');
    expect(page).not.toContain('<a ');
  });

  it('imports: BlogSlot + both cards in, both lists out; dead fetch consts removed (L4)', () => {
    for (const name of ['BlogSlot', 'FeaturedWork', 'WorkCard']) expect(page).toContain(`import ${name} from '../components/${name}.astro';`);
    expect(page).not.toMatch(/WorkList/);
    expect(page).not.toMatch(/featuredPosts|unfeaturedPosts|const works\b/);
    expect(page).toContain("import { getCollection } from 'astro:content';");
    expect(page).toContain('import { Image } from "astro:assets";');
    expect(page).not.toMatch(/\n\n\n/);
  });

  it('parses back as two canonical slots (round trip with the Blog Settings parser)', () => {
    expect(parseBlogBindings(page).map((b) => [b.postsVar, b.collection, b.filter, b.sort, b.custom])).toEqual([
      ['posts', 'works', { field: 'featured' }, 'date-asc', false],
      ['posts2', 'works', { field: 'featured', not: true }, 'date-desc', false],
    ]);
  });

  it('the project BlogSlot is plumbed in the same batch; the converted lists nothing imports any more are deleted (L8, owner 2026-10-10)', () => {
    expect(r.writes['src/components/BlogSlot.astro']).toContain('class={Astro.props.postsClass ?? "grid grid-cols-1 gap-y-12 w-full basis-full col-span-full"}');
    expect(Object.keys(r.writes).sort()).toEqual(['src/components/BlogSlot.astro', 'src/components/FeaturedWorkList.astro', 'src/components/WorkList.astro', INDEX]);
    expect(r.writes['src/components/WorkList.astro']).toBeNull();
    expect(r.writes['src/components/FeaturedWorkList.astro']).toBeNull();
  });

  it('idempotent: its own output converts nothing', () => {
    const again = run({ ...OWNER, ...r.writes });
    expect(again.writes).toEqual({});
    expect(again.converted).toEqual([]);
  });

  it('a fetch const still used elsewhere is kept (L4)', () => {
    const used = run({ ...OWNER, [INDEX]: INDEX_PAGE.replace('<Main>', '<Main>\n\t\t<p>{works.length}</p>') }).writes[INDEX];
    expect(used).toContain("const works = await getCollection('works');");
    expect(used).not.toMatch(/featuredPosts/);
  });
});

describe('convertListsToBlogSlots — not simple → left as it is (L3)', () => {
  it('an extra attribute or children on the usage', () => {
    const extra = run({ ...OWNER, [INDEX]: INDEX_PAGE.replace('<WorkList works={works}>', '<WorkList works={works} class="x">') });
    expect(skippedReason(extra, 'src/components/WorkList.astro')).toMatch(/attribute|children/);
    expect(extra.writes[INDEX]).toContain('<WorkList works={works} class="x"></WorkList>');
    const kids = run({ ...OWNER, [INDEX]: INDEX_PAGE.replace('<WorkList works={works}></WorkList>', '<WorkList works={works}><p>hi</p></WorkList>') });
    expect(skippedReason(kids, 'src/components/WorkList.astro')).toMatch(/attribute|children/);
  });

  it('a list with two derived consts', () => {
    const two = WORK_LIST.replace('---\n\n<div', 'const extra = works.slice(0, 2);\n---\n\n<div');
    expect(skippedReason(withList(two), 'src/components/WorkList.astro')).toMatch(/logic/);
  });

  it('a sort on another field (year) — L16', () => {
    const year = WORK_LIST.replace('Number(b.data.date) - Number(a.data.date)', 'b.data.year - a.data.year');
    expect(skippedReason(withList(year), 'src/components/WorkList.astro')).toMatch(/sort/);
  });

  it('filters on two different fields (page + list) — L14', () => {
    const page = INDEX_PAGE.replace('<WorkList works={works}>', '<WorkList works={hidden}>').replace("const featuredPosts", 'const hidden = works.filter(work => work.data.hidden)\nconst featuredPosts');
    expect(skippedReason(run({ ...OWNER, [INDEX]: page }), 'src/components/WorkList.astro')).toMatch(/filter/);
  });

  it('a root that is not a <div>', () => {
    const ul = WORK_LIST.replace('<div class="m-auto', '<ul class="m-auto').replace('</div>', '</ul>');
    expect(skippedReason(withList(ul), 'src/components/WorkList.astro')).toMatch(/root/);
  });

  it('a card that is not a relative import', () => {
    const aliased = WORK_LIST.replace('"./WorkCard.astro"', '"@/components/WorkCard.astro"');
    expect(skippedReason(withList(aliased), 'src/components/WorkList.astro')).toMatch(/card/);
  });

  it('the converted lists of the same page still convert when another one is skipped', () => {
    const year = WORK_LIST.replace('Number(b.data.date) - Number(a.data.date)', 'b.data.year - a.data.year');
    const r = withList(year);
    expect(r.converted.map((c) => c.list)).toEqual(['src/components/FeaturedWorkList.astro']);
    expect(r.writes[INDEX]).toContain('<WorkList works={works}></WorkList>');
    expect(r.writes[INDEX]).toContain("const works = await getCollection('works');");
    expect(r.writes[INDEX]).toContain("import WorkList from '../components/WorkList.astro';");
  });
});

describe('convertListsToBlogSlots — the BlogSlot component (L7/L9)', () => {
  it('no BlogSlot.astro → the library file is written in the same batch (and a BlogCard it imports)', () => {
    const { 'src/components/BlogSlot.astro': _slot, 'src/components/BlogCard.astro': _card, ...files } = OWNER;
    const r = run(files);
    expect(r.writes['src/components/BlogSlot.astro']).toBe(LIB_BLOG_SLOT);
    expect(r.writes['src/components/BlogCard.astro']).toBe(DEFAULT_CARD);
    expect(r.converted).toHaveLength(2);
  });

  it('a hand-edited BlogSlot → nothing converted, every usage skipped "BlogSlot is custom"', () => {
    const r = run({ ...OWNER, 'src/components/BlogSlot.astro': OWNER_BLOG_SLOT.replace(' data-blog-source="posts"', '') });
    expect(r.converted).toEqual([]);
    expect(r.writes).toEqual({});
    expect(r.skipped.map((s) => s.reason)).toEqual(['BlogSlot is custom', 'BlogSlot is custom']);
  });

  it('nothing to convert → the BlogSlot is not touched', () => {
    const r = run({ 'src/pages/about.astro': '<p>hi</p>', 'src/components/BlogSlot.astro': OWNER_BLOG_SLOT });
    expect(r.writes).toEqual({});
  });
});

describe('convertListsToBlogSlots — the same list on two pages (L5)', () => {
  it('each usage converts on its own page; the list goes once its last usage did', () => {
    const other = 'src/pages/works/all.astro';
    const page = `---\nimport { getCollection } from 'astro:content';\nimport WorkList from '../../components/WorkList.astro';\nconst works = await getCollection('works');\n---\n<WorkList works={works} />\n`;
    const r = run({ ...OWNER, [other]: page });
    expect(r.converted.map((c) => c.page)).toEqual([INDEX, INDEX, other]);
    expect(r.writes[other]).toContain("import WorkCard from '../../components/WorkCard.astro';");
    expect(r.writes[other]).toContain('{posts.map((post) => <div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}');
    expect(r.writes['src/components/WorkList.astro']).toBeNull();
  });
});
