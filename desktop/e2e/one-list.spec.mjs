// One reusable list (task-244): an imported site's simple list components
// arrive as BlogSlots; Blog Settings acts on the SELECTED slot only; ⌘Z
// restores the page byte-exact. The site = the release fixture + the owner's
// shape (two lists of one collection, self-linking cards typed for another
// collection — app/src/utils/__tests__/fixtures/lists.ts).
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, select, logs, launch, setupEnv, fixture } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

const card = (cls) => `---
import type { CollectionEntry } from "astro:content";
type Props = { work: CollectionEntry<"blog"> };
const { work } = Astro.props;
---
<article class="${cls}"><a href={\`/works/\${work.slug}\`}><h2>{work.data.title}</h2></a></article>
`;
const list = (card, filter, sort, cls) => `---
import type {CollectionEntry} from "astro:content"
import Card from "./${card}.astro"
type Props = {
    works: CollectionEntry<"works">[]
}
const {works} = Astro.props
const shown = works
    .filter(work => ${filter}work.data.featured)
    .sort((a, b) => ${sort});
---
<div class="${cls}">
    {shown.map(work => <Card work={work}/>)}
</div>
`;
const SITE = {
  'src/content/works/one.md': '---\ntitle: One\ndate: 2024-01-01\nfeatured: true\n---\nOne.\n',
  'src/content/works/two.md': '---\ntitle: Two\ndate: 2024-02-01\nfeatured: true\n---\nTwo.\n',
  'src/content/works/three.md': '---\ntitle: Three\ndate: 2024-03-01\nfeatured: false\n---\nThree.\n',
  'src/components/FeaturedWork.astro': card('w-full mt-[16vh] mb-20'),
  'src/components/WorkCard.astro': card('p-2'),
  'src/components/FeaturedWorkList.astro': list('FeaturedWork', '', 'Number(a.data.date) - Number(b.data.date)', 'featured-wrapper mx-auto'),
  'src/components/WorkList.astro': list('WorkCard', '!', 'Number(b.data.date) - Number(a.data.date)', 'grid grid-cols-2 gap-20'),
  'src/pages/index.astro': `---
import { getCollection } from 'astro:content';
import Layout from '../layouts/Layout.astro';
import FeaturedWorkList from '../components/FeaturedWorkList.astro';
import WorkList from '../components/WorkList.astro';
const works = await getCollection('works');
const featuredPosts = works.filter(work => work.data.featured)
---
<Layout title="Works">
\t<main>
\t\t<FeaturedWorkList works={featuredPosts}></FeaturedWorkList>
\t\t<WorkList works={works}></WorkList>
\t</main>
</Layout>
`,
};
async function listSite(dir) {
  await fs.cp(fixture, dir, { recursive: true, filter: f => !f.includes('node_modules') });
  for (const [file, text] of Object.entries(SITE)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
}

/** The n-th BlogSlot via its Layers row (the slot's placement root → Blog Settings). */
async function blogSettingsFor(page, n) {
  await page.getByText('BlogSlot', { exact: true }).nth(n).click();
  await expect(page.getByLabel('Collection', { exact: true })).toBeVisible();
}

test('L1/L18: two imported lists → two BlogSlots, each edited on its own; ⌘Z restores', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-one-list-'));
  let app;
  try {
    const dir = path.join(temp, 'site'); await listSite(dir);
    const env = setupEnv(temp);
    let page; ({ app, page } = await launch(env));
    const id = await importFixture(page, 'One list', dir);
    const read = f => fs.readFile(path.join(temp, 'projects', id, f), 'utf8');
    const frame = preview(page);
    const articles = frame.locator('article');
    await expect(articles.first()).toBeVisible({ timeout: BOOT });
    await expect.poll(() => read('src/pages/index.astro').catch(() => ''), { timeout: 30_000 }).toContain('{posts2.map((post) =>');
    const original = await read('src/pages/index.astro');
    expect(original).not.toContain('WorkList');

    // Slot 1 (featured) and slot 2 (the grid) each show their own fetch + card.
    await select(page, articles.first()); // expands the Layers tree down to both BlogSlot rows
    await blogSettingsFor(page, 0);
    await expect(page.getByLabel('Filter', { exact: true })).toHaveValue('featured');
    await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('date-asc');
    await expect(page.getByLabel('Card', { exact: true })).toHaveValue('src/components/FeaturedWork.astro');
    await blogSettingsFor(page, 1);
    await expect(page.getByLabel('Filter', { exact: true })).toHaveValue('!featured');
    await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('date-desc');
    await expect(page.getByLabel('Card', { exact: true })).toHaveValue('src/components/WorkCard.astro');
    expect((await page.getByLabel('Pagination', { exact: true }).locator('option').allTextContents())).not.toContain('Numbered');

    // Change slot 2's sort: only posts2 changes.
    await page.getByLabel('Sort', { exact: true }).selectOption('title-asc');
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toContain("const posts2 = (await getCollection('works', (p) => !p.data.featured))\n  .sort((a, b) => a.data.title.localeCompare(b.data.title));");
    const changed = await read('src/pages/index.astro');
    const firstSlot = s => s.slice(s.indexOf('<BlogSlot'), s.indexOf('</BlogSlot>'));
    expect(firstSlot(changed)).toBe(firstSlot(original));
    expect(changed).toContain("const posts = (await getCollection('works', (p) => p.data.featured))\n  .sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf());");

    // ⌘Z: byte-exact.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toBe(original);
    await page.screenshot({ path: info.outputPath('one-list.png') });
  } catch (error) {
    await fail(app, temp, info, error);
  } finally {
    await app?.close().catch(() => {});
  }
});
