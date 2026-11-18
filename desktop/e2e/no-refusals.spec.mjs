// Owner 2026-11-10: "there should be no refusals … user experience should be
// swift and uninterrupted! nothing should be lost or broken". Every edit lands
// on the page it was made on — mid page switch, behind another write, or undone
// from another page — and nothing says "still switching / still saving / busy".
// Ledger: docs/plans/2026-11-10-page-switch-never-refuses-ledger.md
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, importFixture, fail, logs, launch, setupEnv, fixture } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

const PAGE = (name) => `---
import Layout from '../layouts/Layout.astro';
---
<Layout title="${name}">
  <section class="min-h-[900px] p-8">
    <h2 class="text-2xl">${name} page</h2>
    <p>Plain page-level content.</p>
  </section>
</Layout>
`;

test('no refusal and nothing lost: page switches, queued writes, undo from another page', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-no-refusals-'));
  let app;
  try {
    const site = path.join(temp, 'site');
    await fs.cp(fixture, site, { recursive: true, filter: f => !f.includes('node_modules') });
    for (const name of ['about', 'blog']) await fs.writeFile(path.join(site, 'src/pages', `${name}.astro`), PAGE(name));
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'No refusals', site);
    const dir = path.join(temp, 'projects', id, 'src', 'pages');
    const count = async (f) => ((await fs.readFile(path.join(dir, f), 'utf8')).match(/w-\[/g) ?? []).length;
    const frames = async () => ({ about: await count('about.astro'), blog: await count('blog.astro') });
    const until = async (pred) => expect.poll(async () => pred(await frames()), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('iframe[data-viewport]').first()).toHaveCSS('opacity', '1', { timeout: BOOT });
    await page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() => document.querySelectorAll('[role="status"]').forEach(n => {
        const t = n.textContent?.trim(); if (t && !window.__toasts.includes(t)) window.__toasts.push(t);
      })).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const refusals = () => page.evaluate(() => window.__toasts.filter(t => /still|try again|busy|in a moment|another surface|not saved/i.test(t)));
    // Pages rows carry their route in an input value, not in innerText.
    const rowIndex = (route) => page.evaluate(r => [...document.querySelectorAll('[data-testid="page-item"]')]
      .findIndex(row => row.querySelector('input')?.value === r), route);
    const click = async (route) => page.getByTestId('page-item').nth(await rowIndex(route)).click();
    const docRoute = () => page.frames().filter(f => f !== page.mainFrame())
      .map(f => new URL(f.url()).pathname.replace(/\/$/, '') || '/')[0];
    const canvas = await page.locator('iframe[data-viewport]').first().boundingBox();
    const draw = async (dy = 0) => {
      await page.evaluate(() => document.activeElement?.blur?.()); // a Pages row input keeps focus otherwise
      await page.keyboard.press('a'); // Frame
      await page.mouse.move(canvas.x + 60, canvas.y + 260 + dy); await page.mouse.down();
      await page.mouse.move(canvas.x + 160, canvas.y + 320 + dy, { steps: 4 }); await page.mouse.up();
    };
    // A slow page: the clicked page's document arrives 2.5 s late, so an edit
    // made right after the click lands inside the switch window for sure.
    let slow = null;
    await page.route(u => slow !== null && u.pathname.replace(/\/$/, '') === slow, async (route) => {
      if (route.request().resourceType() === 'document' && route.request().frame() !== page.mainFrame()) await new Promise(r => setTimeout(r, 2500));
      await route.continue().catch(() => {});
    });

    // Draw right after a page click → it lands on the clicked page.
    slow = '/about'; await click('/about'); await draw(); slow = null;
    await until(f => f.about === 1);
    // Two draws back to back (the second while the first is being written) → both land.
    await page.waitForTimeout(1500);
    await draw(0); await draw(90);
    await until(f => f.about === 3);
    // ⌘Z ⌘Z in a burst → both undone, one after the other.
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+z');
    await until(f => f.about === 1);
    // Undo from another page → the edit is undone on its own page.
    await page.waitForTimeout(1500);
    await draw(); await until(f => f.about === 2);
    await click('/blog'); await expect.poll(docRoute, { timeout: 15_000 }).toBe('/blog');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('ControlOrMeta+z');
    await until(f => f.about === 1 && f.blog === 0);
    // Click a page and straight back → the canvas shows the page clicked last.
    await click('/about'); await expect.poll(docRoute, { timeout: 15_000 }).toBe('/about');
    await page.evaluate(async ([b, a]) => { const rs = document.querySelectorAll('[data-testid="page-item"]'); rs[b].click(); await new Promise(r => setTimeout(r, 40)); rs[a].click(); },
      [await rowIndex('/blog'), await rowIndex('/about')]);
    await page.waitForTimeout(4000);
    expect(docRoute()).toBe('/about');
    // Rapid clicks with a draw while the last page loads → it lands on the last page.
    slow = '/blog';
    await page.evaluate(async ([a, h, b]) => { const rs = document.querySelectorAll('[data-testid="page-item"]'); rs[a].click(); await new Promise(r => setTimeout(r, 40)); rs[h].click(); await new Promise(r => setTimeout(r, 40)); rs[b].click(); },
      [await rowIndex('/about'), await rowIndex('/'), await rowIndex('/blog')]);
    await draw(); slow = null;
    await until(f => f.blog === 1 && f.about === 1);
    await expect.poll(docRoute, { timeout: 15_000 }).toBe('/blog');

    expect(await refusals()).toEqual([]);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }); }
});
