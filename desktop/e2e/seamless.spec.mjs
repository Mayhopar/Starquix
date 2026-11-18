import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, select, logs, launch, setupEnv, survivors } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

// The marker lives on the preview document: it survives only if the document was never replaced.
const markDocument = frame => frame.locator('body').evaluate(() => { window.__sqMarker = 1; });
const sameDocument = frame => frame.locator('body').evaluate(() => window.__sqMarker === 1);

test('A1: class edits then typing across the deferred write — no navigation, text on disk', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-seamless-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Seamless A1');
    const frame = preview(page);
    const heading = frame.getByRole('heading', { name: 'Release fixture', exact: true });
    await expect(heading).toBeVisible({ timeout: BOOT });
    // Navigations are diagnostics only (same-document hash updates also fire); the marker is the proof.
    const navigations = [];
    page.on('framenavigated', f => { if (f !== page.mainFrame()) navigations.push(f.url()); });
    // D1: the served Vite client routes every reload through the bridge.
    expect(await frame.locator('body').evaluate(() => fetch('/@vite/client').then(r => r.text()).then(t => t.includes('__sqReload')))).toBe(true);
    await markDocument(frame);
    const version = () => heading.getAttribute('data-sq-source-version');
    const before = await version();
    // Three class edits on the heading (each a durable class write).
    await select(page, heading);
    for (const align of ['center', 'right', 'left']) await page.getByTitle(`Align ${align}`, { exact: true }).click();
    // Type in the next paragraph and keep typing past the 5 s deferred class write.
    const para = frame.getByText('First editable paragraph', { exact: true });
    await page.keyboard.press('Escape'); // drop the heading selection
    await select(page, para);
    await expect(page.getByTestId('design-bar').getByText('P', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    const editable = frame.locator('[contenteditable="true"]');
    await expect(editable).toBeVisible();
    await editable.press('End');
    for (let i = 0; i < 70; i++) { await page.keyboard.type('x'); await page.waitForTimeout(100); }
    await expect(frame.locator('[contenteditable="true"]')).toContainText('x'.repeat(70));
    // Typed text is mirrored to disk while editing (Task 1.6).
    const drafts = path.join(temp, 'projects', id, '.sq/drafts');
    const draftFiles = () => fs.readdir(drafts).then(f => f.filter(n => n.endsWith('.json'))).catch(() => []);
    await expect.poll(async () => { const [f] = await draftFiles(); return f ? JSON.parse(await fs.readFile(path.join(drafts, f), 'utf8')).markup : ''; }).toContain('x'.repeat(70));
    await page.keyboard.press('Escape');
    await info.attach('navigations.json', { body: JSON.stringify(navigations), contentType: 'application/json' });
    expect(await sameDocument(frame)).toBe(true);
    // The deferred class write reached the canvas by an in-place refresh (new stamp, same document).
    await expect.poll(version, { timeout: 15_000 }).not.toBe(before);
    expect(await sameDocument(frame)).toBe(true);
    const pageFile = path.join(temp, 'projects', id, 'src/pages/index.astro');
    await expect.poll(() => fs.readFile(pageFile, 'utf8'), { timeout: 15_000 }).toMatch(/<p class="mt-4 text-lg">[^<]*x{70}<\/p>/);
    await expect.poll(draftFiles, { timeout: 15_000 }).toEqual([]); // cleared once the commit was accepted
    expect(await fs.readFile(pageFile, 'utf8')).toMatch(/<h1 class="[^"]*text-left[^"]*">Release fixture<\/h1>/);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('A6-draft: typed text survives kill -9 of Electron and is restored on relaunch', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-seamless-kill-'));
  const env = setupEnv(temp);
  let app;
  try {
    let page; ({ app, page } = await launch(env));
    const id = await importFixture(page, 'Seamless A6'); const editorUrl = page.url();
    const frame = preview(page);
    const para = frame.getByText('Second editable paragraph', { exact: true });
    await expect(para).toBeVisible({ timeout: BOOT });
    await select(page, para);
    await expect(page.getByTestId('design-bar').getByText('P', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    const editable = frame.locator('[contenteditable="true"]');
    await expect(editable).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.type('y'.repeat(20));
    await page.waitForTimeout(600); // 300 ms debounce + the IPC write
    const drafts = path.join(temp, 'projects', id, '.sq/drafts');
    expect((await fs.readdir(drafts)).filter(f => f.endsWith('.json'))).toHaveLength(1);
    // Hard kill: no pagehide, no quit handlers. The detached Astro child goes too.
    const children = (await survivors(temp)).map(l => Number(l.trim().split(/\s+/)[0])).filter(Boolean);
    process.kill(app.process().pid, 'SIGKILL');
    for (const pid of children) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    app = null;
    ({ app, page } = await launch(env));
    await page.goto(editorUrl);
    const restored = preview(page).locator('[contenteditable="true"]');
    await expect(restored).toContainText('y'.repeat(20), { timeout: BOOT });
    await page.keyboard.press('Escape');
    const pageFile = path.join(temp, 'projects', id, 'src/pages/index.astro');
    await expect.poll(() => fs.readFile(pageFile, 'utf8'), { timeout: 15_000 }).toMatch(/<p class="mt-4 text-lg">[^<]*y{20}<\/p>/);
    await expect.poll(() => fs.readdir(drafts).then(f => f.filter(n => n.endsWith('.json'))), { timeout: 15_000 }).toEqual([]);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

// Text of every <p>/<h1>/<a> in <main>, in order: the canvas vs. the page file.
const canvasOrder = frame => frame.locator('main').evaluate(m => Array.from(m.querySelectorAll('h1, p, a')).map(e => e.textContent.trim()));
const diskOrder = src => Array.from(src.slice(src.indexOf('<main')).matchAll(/<(h1|p|a)\b[^>]*>([^<]*)<\/\1>/g)).map(m => m[2].trim());

test('A2: insert / delete / move refresh in place; the canvas matches the source', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-seamless-a2-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Seamless A2');
    const pageFile = path.join(temp, 'projects', id, 'src/pages/index.astro');
    const frame = preview(page);
    await expect(frame.getByRole('heading', { name: 'Release fixture', exact: true })).toBeVisible({ timeout: BOOT });
    await markDocument(frame);
    const settle = async (label, onDisk) => {
      await expect.poll(async () => onDisk(await fs.readFile(pageFile, 'utf8')), { timeout: 15_000, message: label }).toBe(true);
      await expect.poll(async () => JSON.stringify(await canvasOrder(frame)), { timeout: 10_000, message: label })
        .toBe(JSON.stringify(diskOrder(await fs.readFile(pageFile, 'utf8'))));
      expect(await sameDocument(frame), label).toBe(true);
    };
    const pick = async (text, tag = 'P') => {
      await page.keyboard.press('Escape');
      await select(page, frame.getByText(text, { exact: true }).first());
      await expect(page.getByTestId('design-bar').getByText(tag, { exact: true })).toBeVisible();
    };
    // Insert (duplicate).
    await pick('Second editable paragraph');
    await page.keyboard.press('ControlOrMeta+d');
    await settle('duplicate', src => src.split('Second editable paragraph').length === 3);
    // Delete.
    await pick('First editable paragraph');
    await page.keyboard.press('Backspace');
    await settle('delete', src => !src.includes('First editable paragraph'));
    // Flow reorder: drag the last link above "Nested about" (optimistic move, then the write).
    await pick('Release widget', 'A');
    const from = await frame.getByText('Release widget', { exact: true }).boundingBox();
    const to = await frame.getByText('Nested about', { exact: true }).boundingBox();
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y - 10, { steps: 5 });
    await page.mouse.move(to.x + 20, to.y + 2, { steps: 15 });
    await page.mouse.up();
    await settle('reorder', src => src.indexOf('Release widget') < src.indexOf('Nested about'));
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('A3: external edits appear live; a text edit in progress survives them', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-seamless-a3-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Seamless A3');
    const root = path.join(temp, 'projects', id);
    const pageFile = path.join(root, 'src/pages/index.astro'), layoutFile = path.join(root, 'src/layouts/Layout.astro');
    const frame = preview(page);
    const para = frame.getByText('First editable paragraph', { exact: true });
    await expect(para).toBeVisible({ timeout: BOOT });
    await markDocument(frame);
    // Idle: an IDE edit to the page shows up in place.
    await fs.writeFile(pageFile, (await fs.readFile(pageFile, 'utf8')).replace('</main>', '  <p class="mt-4">From the IDE</p>\n  </main>'));
    await expect(frame.getByText('From the IDE', { exact: true })).toBeVisible({ timeout: 3_000 });
    expect(await sameDocument(frame)).toBe(true);
    // Typing in the page while ANOTHER file (the layout) changes: it refreshes live.
    await select(page, para);
    await expect(page.getByTestId('design-bar').getByText('P', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(frame.locator('[contenteditable="true"]')).toBeVisible();
    await page.keyboard.press('ArrowRight'); // collapse the select-all to the end
    await page.keyboard.type(' typed');
    await expect(frame.locator('[contenteditable="true"]')).toHaveText('First editable paragraph typed');
    await fs.writeFile(layoutFile, (await fs.readFile(layoutFile, 'utf8')).replace('<slot />', '<slot />\n    <footer>Layout footer</footer>'));
    await expect(frame.getByText('Layout footer', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(frame.locator('[contenteditable="true"]')).toHaveText('First editable paragraph typed');
    // Same file changes under the edit: held until the edit ends, then applied.
    await page.keyboard.type(' more');
    await fs.writeFile(pageFile, (await fs.readFile(pageFile, 'utf8')).replace('</main>', '  <p class="mt-4">Second IDE edit</p>\n  </main>'));
    await page.waitForTimeout(1_500);
    await expect(frame.locator('[contenteditable="true"]')).toHaveText('First editable paragraph typed more');
    await page.keyboard.press('Escape');
    await expect(frame.getByText('Second IDE edit', { exact: true })).toBeVisible({ timeout: 5_000 });
    // The same-file IDE edit moved the source version, so the commit's identity is
    // unprovable and the durable layer refuses it (D7: never write into a guessed
    // element). The typed text is not lost: it stays in .sq/drafts on disk.
    const drafts = path.join(root, '.sq/drafts');
    await expect.poll(async () => {
      if ((await fs.readFile(pageFile, 'utf8')).includes('First editable paragraph typed more')) return true;
      const files = await fs.readdir(drafts).catch(() => []);
      for (const f of files.filter(n => n.endsWith('.json'))) if (JSON.parse(await fs.readFile(path.join(drafts, f), 'utf8')).markup.includes('typed more')) return true;
      return false;
    }, { timeout: 15_000 }).toBe(true);
    expect(await sameDocument(frame)).toBe(true);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('case 24: a template error keeps the last good canvas and shows one status; fixing it clears it', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-seamless-err-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Seamless error');
    const pageFile = path.join(temp, 'projects', id, 'src/pages/index.astro');
    const frame = preview(page);
    const heading = frame.getByRole('heading', { name: 'Release fixture', exact: true });
    await expect(heading).toBeVisible({ timeout: BOOT });
    await markDocument(frame);
    const good = await fs.readFile(pageFile, 'utf8');
    await fs.writeFile(pageFile, good.replace('<h1 class="text-4xl font-semibold">', '<h1 class="text-4xl font-semibold" {broken('));
    const status = page.getByTestId('source-error-status');
    await expect(status).toBeVisible({ timeout: 10_000 });
    await expect(status).toContainText('Page has an error');
    await expect(status).toContainText('src/pages/index.astro');
    
    await expect(heading).toBeVisible();              // last good canvas, not an error page
    expect(await sameDocument(frame)).toBe(true);
    await fs.writeFile(pageFile, good.replace('Release fixture', 'Release fixture fixed'));
    await expect(frame.getByRole('heading', { name: 'Release fixture fixed', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(status).toBeHidden();
    expect(await sameDocument(frame)).toBe(true);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('A7: 500 external class writes — same document, head and refresh hook stable', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-seamless-soak-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Seamless soak');
    const pageFile = path.join(temp, 'projects', id, 'src/pages/index.astro');
    const frame = preview(page);
    const heading = frame.getByRole('heading', { name: 'Release fixture', exact: true });
    await expect(heading).toBeVisible({ timeout: BOOT });
    await page.waitForTimeout(1000);
    await markDocument(frame);
    // Head nodes by tag#id. The editor's own one-time styles (#sq-*: the agent ring's
    // dissolve, asset overrides) are injected on first use — not a refresh leaking nodes.
    const before = await frame.locator('body').evaluate(() => { window.__sqHook = window.__SQ_VITE_RELOAD__; return Array.from(document.head.children, n => n.tagName + (n.id ? '#' + n.id : '')); });
    const good = await fs.readFile(pageFile, 'utf8');
    for (let i = 1; i <= 500; i++) {
      await fs.writeFile(pageFile, good.replace('text-4xl font-semibold', `text-4xl font-semibold soak-${i}`));
      await page.waitForTimeout(20);
    }
    await expect(heading).toHaveClass(/soak-500/, { timeout: 15_000 });
    await page.waitForTimeout(1000);
    const after = await frame.locator('body').evaluate(() => ({ head: Array.from(document.head.children, n => n.tagName + (n.id ? '#' + n.id : '')), sameHook: window.__sqHook === window.__SQ_VITE_RELOAD__ }));
    await info.attach('soak.json', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
    console.log('[A7] head before ' + JSON.stringify(before) + ' after ' + JSON.stringify(after.head));
    expect(await sameDocument(frame)).toBe(true);
    const pageOwned = nodes => nodes.filter(n => !n.includes('#sq-'));
    expect(pageOwned(after.head)).toHaveLength(pageOwned(before).length);
    expect(after.sameHook).toBe(true);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});
