// The Design Bar's Link section, against the file on disk (owner 2026-11-02): a link
// belongs to the selected element; + makes one at once, − removes it, ⌘Z brings it back.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, select, logs, launch, setupEnv, fixture } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

const BLOCKS = `
    <h2 id="plain" class="text-2xl">Plain heading</h2>
    <p id="words" class="mt-2">Some words here</p>
    <div id="grid" class="grid grid-cols-2 gap-4">
      <div id="cell" class="col-span-2 p-4">Wide cell</div>
      <div class="p-4">Other cell</div>
    </div>
    <div data-sq-post-slug="hello"><a id="card" href="/posts/hello/"><h3 id="card-title">Card title</h3></a></div>
    <Note />`;

async function linkFixture(dir) {
  await fs.cp(fixture, dir, { recursive: true, filter: f => !f.includes('node_modules') });
  await fs.mkdir(path.join(dir, 'src/components'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/components/Note.astro'), '---\n---\n<p id="note">Shared note</p>\n');
  const page = path.join(dir, 'src/pages/index.astro');
  const src = await fs.readFile(page, 'utf8');
  await fs.writeFile(page, src.replace(/^---\n/, "---\nimport Note from '../components/Note.astro';\n").replace(/(<main[^>]*>)/, `$1${BLOCKS}`));
}

test('L1: Link belongs to the element; + − ⌘Z ⇧⌘Z land in the file', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-link-'));
  let app;
  try {
    const dir = path.join(temp, 'fixture'); await linkFixture(dir);
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Links', dir);
    const file = path.join(temp, 'projects', id, 'src/pages/index.astro');
    const frame = preview(page);
    await frame.locator('#plain').waitFor({ timeout: BOOT });
    await expect(page.locator('iframe[data-viewport]').first()).toHaveCSS('opacity', '1', { timeout: BOOT });
    const original = await fs.readFile(file, 'utf8');
    const onDisk = (fragment) => expect.poll(() => fs.readFile(file, 'utf8'), { timeout: 15_000 }).toContain(fragment);
    const backToOriginal = () => expect.poll(() => fs.readFile(file, 'utf8'), { timeout: 15_000 }).toBe(original);

    const block = page.getByTestId('link-block');
    const add = page.getByRole('button', { name: 'Add link' });
    const remove = page.getByRole('button', { name: 'Remove link' });
    const field = page.getByLabel('Link URL or page');
    const newTab = page.getByRole('switch', { name: 'Open in a new tab' });
    const selected = (name) => expect(page.getByTestId('design-bar').getByText(name, { exact: true }).first()).toBeVisible();
    // An edit waits for the last write's scan: the canvas showing the file is that scan.
    const settled = () => expect(frame.locator('a:has(#plain)')).toHaveAttribute('data-key', /:\d+:\d+/).then(() => page.waitForTimeout(400));
    const undo = () => page.keyboard.press('ControlOrMeta+z');
    const redo = () => page.keyboard.press('ControlOrMeta+Shift+z');

    // The owner's report: a click on a card selects the whole container. The container has no link.
    const card = await frame.locator('#card-title').boundingBox();
    await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
    await selected('Layout');
    await expect(block).toHaveCount(0);
    // The element in the card does.
    await select(page, frame.locator('#card-title'));
    await selected('H3');
    await expect(field).toHaveValue('/posts/hello/');

    // No link: a header with +. It makes one at once, on that element, and stays on it.
    await select(page, frame.locator('#plain'));
    await selected('H2');
    await expect(add).toBeVisible();
    await expect(field).toHaveCount(0);
    await add.click();
    await onDisk('<a href="/"><h2 id="plain" class="text-2xl">Plain heading</h2></a>');
    await expect(remove).toBeVisible();
    await expect(field).toHaveValue('/');
    await selected('H2');

    // ⌘Z undoes the add, ⇧⌘Z redoes it; the element stays selected through both.
    await undo();
    await backToOriginal();
    await expect(add).toBeVisible();
    await selected('H2');
    await redo();
    await onDisk('<a href="/"><h2 id="plain"');
    await expect(remove).toBeVisible();

    // The input and the toggle write the file. Off leaves no target at all.
    await field.fill('/nested/about/');
    await field.press('Enter');
    await onDisk('<a href="/nested/about/"><h2 id="plain"');
    await selected('H2');
    await settled();
    await newTab.click();
    await onDisk('target="_blank" href="/nested/about/"');
    await settled();
    await newTab.click();
    await onDisk('<a href="/nested/about/"><h2 id="plain"');
    await settled();

    // − removes it with no question, and ⌘Z brings it back.
    await remove.click();
    await backToOriginal();
    await expect(add).toBeVisible();
    await selected('H2');
    await undo();
    await onDisk('<a href="/nested/about/"><h2 id="plain"');
    await expect(remove).toBeVisible();
    await expect(field).toHaveValue('/nested/about/');

    // A typed link is written when a click on the canvas leaves the field, and the list closes.
    await field.click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await field.fill('/posts/hello/');
    await select(page, frame.locator('#words'));
    await onDisk('<a href="/posts/hello/"><h2 id="plain"');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await settled();

    // A flex/grid item stays the item: the link box is display:contents.
    const before = await frame.locator('#cell').boundingBox();
    await select(page, frame.locator('#cell'));
    await add.click();
    await onDisk('<a href="/" class="contents"><div id="cell"');
    await expect(remove).toBeVisible();
    expect(await frame.locator('#cell').boundingBox()).toEqual(before);
    await settled();

    // A shared component stays shared: nothing is written, the toast says how.
    const beforeNote = await fs.readFile(file, 'utf8');
    await select(page, frame.locator('#note'));
    await add.click();
    await expect(page.getByText(/Note\.astro is a component/)).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toBe(beforeNote);

    // The arrow goes where the link goes.
    await select(page, frame.locator('#cell'));
    await field.fill('/nested/about/');
    await page.getByTestId('link-follow').click();
    await onDisk('<a href="/nested/about/" class="contents"><div id="cell"');
    await expect.poll(() => frame.locator('body').evaluate(() => location.pathname), { timeout: 30_000 }).toBe('/nested/about');
  } catch (e) { await fail(app, temp, info, e); }
  finally {
    await app?.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }).catch(() => {});
  }
});
