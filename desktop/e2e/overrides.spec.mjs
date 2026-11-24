// Instance overrides live in files (app/src/utils/propOverrides.ts) — "like Figma":
// an edit to a component on ONE page survives close/reopen and export → import,
// keeps its Reset, and never reaches the component's other placements.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, select, logs, launch, setupEnv, fixture, exportZip } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

const CARD = '---\n---\n<div class="rounded p-4">\n  <h2 class="text-xl">Card title</h2>\n  <p class:list={["text-sm", "card-note"]}>Tom &amp; Jerry</p>\n</div>\n';
async function cardFixture(dir) {
  await fs.cp(fixture, dir, { recursive: true, filter: f => !f.includes('node_modules') });
  await fs.mkdir(path.join(dir, 'src/components'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/components/Card.astro'), CARD);
  for (const page of ['src/pages/index.astro', 'src/pages/nested/about.astro']) {
    const file = path.join(dir, page);
    const depth = page.split('/').length - 2;
    let src = await fs.readFile(file, 'utf8');
    src = src.replace(/^---\n/, `---\nimport Card from '${'../'.repeat(depth)}components/Card.astro';\n`);
    src = src.replace(/(<main[^>]*>)/, '$1\n    <Card />');
    await fs.writeFile(file, src);
  }
}

// The `*` rides the selected element; Push/Reset live on the instance root (the Card row).
async function componentOptions(page) {
  await expect(page.getByText('H2*', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByText('Card', { exact: true }).click();
  await page.getByTitle('Component options', { exact: true }).click();
  return page.getByRole('menuitem', { name: 'Reset to master' });
}

test('O1: class + text override on one page → files; survives reopen and export → import; Reset drops it', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-overrides-'));
  let app;
  try {
    const dir = path.join(temp, 'fixture'); await cardFixture(dir);
    const env = setupEnv(temp);
    let page; ({ app, page } = await launch(env));
    const id = await importFixture(page, 'Overrides O1', dir); const editorUrl = page.url();
    const files = path.join(temp, 'projects', id);
    const read = f => fs.readFile(path.join(files, f), 'utf8');
    let frame = preview(page);
    const title = () => frame.getByRole('heading', { name: /Card title|Override title/ });
    await expect(title()).toBeVisible({ timeout: BOOT });

    // Class override on the home page.
    await select(page, title());
    await page.getByTitle('Align center', { exact: true }).click();
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toMatch(/<Card h2Class="[^"]*text-center[^"]*" \/>/);
    expect(await read('src/components/Card.astro')).toContain('<h2 class={Astro.props.h2Class ?? "text-xl"}>');
    expect(await read('src/pages/nested/about.astro')).not.toContain('h2Class');

    // Text override.
    await page.keyboard.press('Enter');
    const editable = frame.locator('[contenteditable="plaintext-only"]');
    await expect(editable).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Override title');
    await page.keyboard.press('Escape');
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toMatch(/h2Text="Override title"/);
    expect(await read('src/components/Card.astro')).toContain('{Astro.props.h2Text ?? "Card title"}');

    // Export carries it.
    const zip = await exportZip(page, temp, info, 'overrides.zip');
    const zipped = name => Object.values(zip.files).find(f => f.name.endsWith(name)).async('string');
    expect(await zipped('src/pages/index.astro')).toMatch(/h2Text="Override title"/);
    expect(await zipped('src/components/Card.astro')).toContain('Astro.props.h2Class ?? "text-xl"');

    // Close + reopen: the override is still an override (Reset reachable).
    await app.close(); app = null;
    ({ app, page } = await launch(env));
    await page.goto(editorUrl);
    frame = preview(page);
    await expect(frame.getByRole('heading', { name: 'Override title' })).toBeVisible({ timeout: BOOT });
    await select(page, title());
    await expect(await componentOptions(page)).toBeEnabled();
    await page.keyboard.press('Escape');
    await app.close(); app = null;

    // Fresh machine: import the export. The override comes back from the files alone.
    const unzipped = path.join(temp, 'unzipped');
    for (const f of Object.values(zip.files)) {
      if (f.dir) continue;
      const out = path.join(unzipped, f.name);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, await f.async('nodebuffer'));
    }
    const env2 = setupEnv(path.join(temp, 'second')); await fs.mkdir(path.join(temp, 'second'), { recursive: true });
    ({ app, page } = await launch(env2));
    const id2 = await importFixture(page, 'Overrides O1 import', unzipped);
    const read2 = f => fs.readFile(path.join(temp, 'second', 'projects', id2, f), 'utf8');
    frame = preview(page);
    await expect(frame.getByRole('heading', { name: 'Override title' })).toBeVisible({ timeout: BOOT });
    await select(page, title());
    const reset = await componentOptions(page);
    await expect(reset).toBeEnabled();
    await reset.click(); // acts at once (no confirm; ⌘Z brings it back)
    await expect.poll(() => read2('src/pages/index.astro'), { timeout: 20_000 }).not.toMatch(/h2Class|h2Text/);
    await expect(frame.getByRole('heading', { name: 'Card title' })).toBeVisible({ timeout: 30_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('O2: Push bakes the override into the component fallback and drops the page prop', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-overrides-push-'));
  let app;
  try {
    const dir = path.join(temp, 'fixture'); await cardFixture(dir);
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Overrides O2', dir);
    const read = f => fs.readFile(path.join(temp, 'projects', id, f), 'utf8');
    const frame = preview(page);
    const title = frame.getByRole('heading', { name: 'Card title' });
    await expect(title).toBeVisible({ timeout: BOOT });
    await select(page, title);
    await page.getByTitle('Align right', { exact: true }).click();
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toMatch(/h2Class="[^"]*text-right/);
    await page.getByText('Card', { exact: true }).click();
    await page.getByTitle('Component options', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Push changes to source' }).click(); // acts at once (no confirm)
    await expect.poll(() => read('src/components/Card.astro'), { timeout: 20_000 }).toMatch(/Astro\.props\.h2Class \?\? "[^"]*text-right/);
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).not.toContain('h2Class');
    expect(await read('src/pages/nested/about.astro')).not.toContain('h2Class');
    await expect(title).toHaveClass(/text-right/, { timeout: 30_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('O3: class:list + entity text override → files; reopen keeps the override', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-overrides-list-'));
  let app;
  try {
    const dir = path.join(temp, 'fixture'); await cardFixture(dir);
    const env = setupEnv(temp);
    let page; ({ app, page } = await launch(env));
    const id = await importFixture(page, 'Overrides O3', dir); const editorUrl = page.url();
    const read = f => fs.readFile(path.join(temp, 'projects', id, f), 'utf8');
    let frame = preview(page);
    const note = () => frame.getByText(/Tom & Jerry|Cat and mouse/);
    await expect(note()).toBeVisible({ timeout: BOOT });
    await select(page, note());
    await page.getByTitle('Align center', { exact: true }).click();
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toMatch(/pClass="[^"]*text-center[^"]*"/);
    expect(await read('src/components/Card.astro')).toContain('class:list={Astro.props.pClass ?? (["text-sm", "card-note"])}');
    await page.keyboard.press('Enter');
    await expect(frame.locator('[contenteditable="plaintext-only"]')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Cat and mouse');
    await page.keyboard.press('Escape');
    await expect.poll(() => read('src/pages/index.astro'), { timeout: 20_000 }).toMatch(/pText="Cat and mouse"/);
    expect(await read('src/components/Card.astro')).toContain('{Astro.props.pText ?? "Tom & Jerry"}');
    expect(await read('src/pages/nested/about.astro')).not.toMatch(/pClass|pText/);
    await app.close(); app = null;
    ({ app, page } = await launch(env));
    await page.goto(editorUrl);
    frame = preview(page);
    await expect(frame.getByText('Cat and mouse')).toBeVisible({ timeout: BOOT });
    await select(page, note());
    await expect(page.getByText('P*', { exact: true })).toBeVisible({ timeout: 30_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});
