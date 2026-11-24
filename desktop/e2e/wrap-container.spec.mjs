// Create container (#5), against the file on disk: the shortcut, the canvas and the
// Layers right-click menu wrap the selected layers in a class-less <div>; ⌘Z gives
// back the exact bytes; layers of different parents are refused and nothing changes.
// Remove container (⇧⌘G / Ctrl+Shift+G) is its inverse: wrap + unwrap = the original bytes.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, select, logs, launch, setupEnv, fixture } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

const page = (main) => `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="Wrap">
  <main class="p-8">
${main}  </main>
</Layout>
`;
const H1 = '    <h1 id="title" class="text-4xl">Wrap fixture</h1>\n';
const AB = '    <p id="a">Alpha</p>\n\n    <p id="b">Beta</p>\n';
const SECTION = '    <section class="p-4">\n      <p id="c">Gamma</p>\n    </section>\n';
const ORIGINAL = page(H1 + AB + SECTION);
const WRAP = process.platform === 'darwin' ? 'Meta+g' : 'Control+Alt+g';
const UNWRAP = process.platform === 'darwin' ? 'Meta+Shift+g' : 'Control+Shift+g';

test('W1: Create container wraps in the file, undo restores the bytes, different parents are refused', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-wrap-'));
  let app;
  try {
    const dir = path.join(temp, 'fixture');
    await fs.cp(fixture, dir, { recursive: true, filter: f => !f.includes('node_modules') });
    await fs.writeFile(path.join(dir, 'src/pages/index.astro'), ORIGINAL);
    let p; ({ app, page: p } = await launch(setupEnv(temp)));
    // The invisible probe window never has focus; the editor's shortcuts listen on a focused document.
    await (await p.context().newCDPSession(p)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const id = await importFixture(p, 'Wrap', dir);
    const file = path.join(temp, 'projects', id, 'src/pages/index.astro');
    const read = () => fs.readFile(file, 'utf8');
    const frame = preview(p);
    await frame.locator('#c').waitFor({ timeout: BOOT });
    expect(await read()).toBe(ORIGINAL);
    await p.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() => document.querySelectorAll('[role="status"]').forEach(n => {
        const t = n.textContent?.trim(); if (t && !window.__toasts.includes(t)) window.__toasts.push(t);
      })).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const fileIs = (text) => expect.poll(read, { timeout: 15_000 }).toBe(text);
    const center = async (sel) => { const b = await frame.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const addToSelection = async (sel) => {
      await p.keyboard.down('ControlOrMeta'); await p.keyboard.down('Shift');
      try { await p.mouse.click(...await center(sel)); } finally { await p.keyboard.up('Shift'); await p.keyboard.up('ControlOrMeta'); }
    };
    const undo = async () => { await p.keyboard.press('ControlOrMeta+z'); await fileIs(ORIGINAL); await p.waitForTimeout(1000); };
    const menuItem = p.getByRole('menuitem', { name: /Create container/ });
    const h1Row = p.getByTestId('layer-item').filter({ hasText: /^\s*h1\s*$/ });

    // Two siblings (a blank line between them) + the shortcut → one container, children compact.
    const WRAPPED_AB = page(`${H1}    <div>\n      <p id="a">Alpha</p>\n      <p id="b">Beta</p>\n    </div>\n${SECTION}`);
    await select(p, frame.locator('#a'));
    await addToSelection('#b');
    await expect(p.getByText('2 elements', { exact: true })).toBeVisible();
    await p.keyboard.press(WRAP);
    await fileIs(WRAPPED_AB);
    await expect(frame.locator('main > div > p')).toHaveText(['Alpha', 'Beta'], { timeout: 15_000 });
    await p.waitForTimeout(1000);
    await undo();
    await p.keyboard.press('ControlOrMeta+Shift+z');
    await fileIs(WRAPPED_AB);
    await p.waitForTimeout(1000);
    await undo();
    await expect(frame.locator('main > div')).toHaveCount(0, { timeout: 15_000 });

    // Remove container: wrap two siblings, the container becomes the selection, ⇧⌘G → the
    // file is byte-identical to before the wrap; ⌘Z brings the container back.
    const WRAPPED_H1_A = page(`    <div>\n  ${H1}      <p id="a">Alpha</p>\n    </div>\n\n    <p id="b">Beta</p>\n${SECTION}`);
    await select(p, frame.locator('#title'));
    await addToSelection('#a');
    await expect(p.getByText('2 elements', { exact: true })).toBeVisible();
    await p.keyboard.press(WRAP);
    await fileIs(WRAPPED_H1_A);
    await expect(p.getByTestId('layer-item').filter({ hasText: /^\s*div\s*$/ })).toHaveClass(/bg-bg-selected/, { timeout: 15_000 });
    await p.screenshot({ path: info.outputPath('container-selected.png') });
    await p.keyboard.press(UNWRAP);
    await fileIs(ORIGINAL);
    await expect(frame.locator('main > div')).toHaveCount(0, { timeout: 15_000 });
    await expect(p.getByTestId('layer-item').filter({ hasText: /^\s*h1\s*$/ })).toHaveClass(/bg-bg-selected/, { timeout: 15_000 });
    await p.waitForTimeout(1000);
    await p.keyboard.press('ControlOrMeta+z');
    await fileIs(WRAPPED_H1_A);
    await p.waitForTimeout(1000);
    await undo();

    // Canvas: right-click the selected layer → Create container.
    await select(p, frame.locator('#c'));
    await p.mouse.click(...await center('#c'), { button: 'right' });
    await expect(menuItem).toBeVisible();
    await p.screenshot({ path: info.outputPath('canvas-menu.png') });
    await menuItem.click();
    await fileIs(page(H1 + AB + '    <section class="p-4">\n      <div>\n        <p id="c">Gamma</p>\n      </div>\n    </section>\n'));
    await p.waitForTimeout(1000);
    await undo();

    // Layers: right-click an unselected row → it is selected, the menu opens → Create container.
    const WRAPPED_H1 = page(`    <div>\n  ${H1}    </div>\n${AB}${SECTION}`);
    await h1Row.click({ button: 'right' });
    await expect(menuItem).toBeVisible();
    await p.screenshot({ path: info.outputPath('layers-menu.png') });
    await menuItem.click();
    await fileIs(WRAPPED_H1);
    await p.waitForTimeout(1000);
    await undo();

    // The shortcut also arrives from the preview when it has the keyboard focus.
    await h1Row.click();
    await frame.locator('body').evaluate(b => b.ownerDocument.defaultView.focus());
    await p.keyboard.press(WRAP);
    await fileIs(WRAPPED_H1);
    await p.waitForTimeout(1000);
    await undo();

    // Different parents: refused with a toast, the file is left alone.
    expect(await p.evaluate(() => window.__toasts.filter(t => /container|select layers/i.test(t)))).toEqual([]);
    // Gamma on the canvas (its Layers row shows), then ⌘-click Alpha's row.
    await select(p, frame.locator('#c'));
    await p.keyboard.down('ControlOrMeta');
    try { await p.getByTestId('layer-item').filter({ hasText: /^\s*p\s*$/ }).first().click(); } finally { await p.keyboard.up('ControlOrMeta'); }
    await expect(p.getByText('2 elements', { exact: true })).toBeVisible();
    await p.keyboard.press(WRAP);
    await expect.poll(() => p.evaluate(() => window.__toasts.some(t => t.includes('Select layers with the same parent'))), { timeout: 10_000 }).toBe(true);
    await p.waitForTimeout(1500);
    expect(await read()).toBe(ORIGINAL);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }); }
});
