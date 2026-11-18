import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Owner fixtures, verbatim from the owner site (2026-10-10, task-244). WorkCard/FeaturedWork: first 40 lines.
export const INDEX_PAGE = "---\nimport { getCollection } from 'astro:content';\nimport Layout from '../layouts/Main.astro';\nimport Main from '../components/Main.astro';\nimport FeaturedWorkList from '../components/FeaturedWorkList.astro';\nimport WorkList from '../components/WorkList.astro';\nimport { Image } from \"astro:assets\";\n\nconst works = await getCollection('works');\n\nconst featuredPosts = works.filter(work => work.data.featured)\nconst unfeaturedPosts = works.filter(work => !work.data.featured)\n\n---\n\n<Layout bodyClass=\"font-['SuisseIntl'] bg-red-500\" title=\"Oleg Mayhopar | Works\">\n\t<Main>\n\t\t<FeaturedWorkList works={featuredPosts}></FeaturedWorkList>\n\t\t<WorkList works={works}></WorkList>\n\t</Main>\n</Layout>";
export const WORK_LIST = "---\nimport type {CollectionEntry} from \"astro:content\"\n\nimport Work from \"./WorkCard.astro\"\n\ntype Props = {\n    works: CollectionEntry<\"works\">[]\n}\n\nconst {works} = Astro.props\nconst unfeaturedWorks = works\n    .filter(work => !work.data.featured)\n    .sort((a, b) => Number(b.data.date) - Number(a.data.date));\n---\n\n<div class=\"m-auto \nmax-w-[484px]\nlg:w-[640px] \ngrid \ngrid-cols-2 \ngrid-flow-row \ngap-20\nitems-start\nmt-64\n\n2xl:w-[768px]\npb-[16vh]\">\n    {unfeaturedWorks.map(work => <Work work={work}/>)}\n</div>";
export const FEATURED_WORK_LIST = "---\nimport type {CollectionEntry} from \"astro:content\"\n\nimport FeaturedWork from \"./FeaturedWork.astro\"\n\ntype Props = {\n    works: CollectionEntry<\"works\">[]\n}\n\nconst {works} = Astro.props\n\nconst featuredWorks = works\n    .filter(work => work.data.featured)\n    .sort((a, b) => Number(a.data.date) - Number(b.data.date));\n\n---\n\n<div class=\"featured-wrapper\nmx-auto\npt-[2vh]\nlg:w-[640px]\n2xl:w-[768px]\nzoom-in\">\n    {featuredWorks.map(work => <FeaturedWork work={work} />)}\n</div>";
export const WORK_CARD = "---\nimport {type CollectionEntry, getEntryBySlug} from \"astro:content\"\nimport { Image } from \"astro:assets\"\n\ntype Props = {\n    work: CollectionEntry<\"blog\">\n}\n\nconst {work} = Astro.props;\n\n---\n<article class=\"lg:hover:scale-[1.015] transition-all\">\n    <a\n        href={`/works/${work.slug}`}\n        class=\"px-2 group\"\n    >\n        <div class=\"folder relative transition-all\">\n            <div class=\"folder-tab\n            absolute\n            -top-[13px]\n            left-0\n            drop-shadow-[0_2px_0px_#94DCFF]\n            z-10\">\n                <svg width=\"61\" height=\"13\" viewBox=\"0 0 61 13\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <path d=\"M0 11C0 4.92487 4.92487 0 11 0H43.0608C45.5445 0 47.8874 1.15363 49.4018 3.12231L54.5982 9.87769C56.1126 11.8464 58.4555 13 60.9392 13H0V11Z\" fill=\"#94DCFF\"/>\n                </svg>\n            </div>\n            <div class=\"folder-back\n            relative\n            aspect-[3/2]\n            w-full\n            h-full\n            bg-[#94DCFF]\n            rounded-tl-[0px]\n            rounded-tr-[8px]\n            rounded-br-[8px]\n            rounded-bl-[8px]\n            z-10\">\n                \n                {work.data.preview1 && <Image src={work.data.preview1}";
export const FEATURED_WORK = "---\nimport {type CollectionEntry, getEntryBySlug} from \"astro:content\"\nimport { Image } from \"astro:assets\"\n\ntype Props = {\n    work: CollectionEntry<\"blog\">\n}\n\nconst {work} = Astro.props\nconst show = { subtitle: false, date: false };\n---\n<article class=\"w-full\nmt-[16vh]\nmb-20\nlg:hover:scale-[1.01] \ntransition-all \nlg:hover:duration-75 \nlg:hover:ease-in \nease-out \nduration-150\n\n2xl:mb-10\">\n    <a\n        href={`/works/${work.slug}`}\n        aria-label={`Read more about ${work.data.title}`}\n        class=\"grow\"\n    >\n        {work.data.image && <Image\n            src={work.data.image}\n            alt={work.data.title}\n            width={1340}\n            format=\"webp\"\n            class=\"w-full aspect-thumbnail object-cover mb-0 rounded-md lg:rounded-xl\"\n            transition:name={\"cover:\" + work.data.title}\n        >\n        </Image>}\n        <div class=\"flex\n        flex-row \n        gap-x-2\n        max-w-[484px] ";
export const OWNER_BLOG_SLOT = "---\n/**\n * @category Blog\n * @name BlogSlot\n * @sq-chrome 2\n * @default-children BlogCard:posts, BlogPaginationNumbered:pagination\n */\nimport BlogCard from './BlogCard.astro';\n---\n<section class=\"w-full mx-auto pt-[16vh] pb-[20vh] lg:w-[640px] 2xl:w-[768px] flex flex-col\">\n  <div class=\"grid grid-cols-1 gap-y-12 w-full basis-full col-span-full\" data-blog-source=\"posts\">\n    <slot name=\"posts\">\n      <BlogCard />\n    </slot>\n  </div>\n  <div class=\"w-full basis-full col-span-full\" data-blog-source=\"pagination\">\n    <slot name=\"pagination\" />\n  </div>\n</section>\n";

// A converted two-list page (task-244 design §2 shape).
export const TWO_SLOTS = `---
import { getCollection } from 'astro:content';
import BlogSlot from '../components/BlogSlot.astro';
import FeaturedWork from '../components/FeaturedWork.astro';
import WorkCard from '../components/WorkCard.astro';
const posts = (await getCollection('works', (p) => p.data.featured))
  .sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf());
const posts2 = (await getCollection('works', (p) => !p.data.featured))
  .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
  .slice(0, 4);
---
<main>
  <BlogSlot sectionClass="" postsClass="a">
    <Fragment slot="posts">
      {posts.map((post) => <div data-sq-post-slug={post.slug}><FeaturedWork work={post} /></div>)}
    </Fragment>
  </BlogSlot>
  <BlogSlot sectionClass="" postsClass="b">
    <Fragment slot="posts">
      {posts2.map((post) => <a href={\`/works/\${post.slug}\`} class="block" data-sq-post-slug={post.slug}><WorkCard work={post} /></a>)}
    </Fragment>
  </BlogSlot>
</main>
`;

/** The shipped library BlogSlot (preview-template). */
export const LIB_BLOG_SLOT = readFileSync(resolve(__dirname, '../../../../../preview-template/src/components/library/BlogSlot.astro'), 'utf8');

/** The owner's site as the converter / open pass read it: the page, its two lists, their cards, BlogSlot, Main. */
export const OWNER_FILES: Record<string, string> = {
  'src/pages/index.astro': INDEX_PAGE,
  'src/components/WorkList.astro': WORK_LIST,
  'src/components/FeaturedWorkList.astro': FEATURED_WORK_LIST,
  'src/components/WorkCard.astro': WORK_CARD,
  'src/components/FeaturedWork.astro': FEATURED_WORK,
  'src/components/BlogSlot.astro': OWNER_BLOG_SLOT,
  'src/components/Main.astro': '<main><slot /></main>',
};

/** 1-based line + column of the `nth` occurrence of `needle` in `src`. */
export function lineOf(src: string, needle: string, nth = 0): { line: number; column: number } {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = src.indexOf(needle, at + 1);
  const before = src.slice(0, at).split('\n');
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** The first `<BlogSlot …>…` block of a page (its bytes, for "untouched" checks). */
export const firstSlot = (src: string) => src.slice(src.indexOf('<BlogSlot'), src.indexOf('</BlogSlot>'));

