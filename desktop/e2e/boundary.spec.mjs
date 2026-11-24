import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, logs, launch, setupEnv, select, running } from './helpers.mjs';
import { sampleBlank, isBlank, watchFrames, frameSummary, canvasClip } from './boundary-sampler.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

test('A4/A5 boundaries: route change, script change, child kill — blank samples', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-boundary-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Boundary');
    const root = path.join(temp, 'projects', id);
    const frame = preview(page);
    await expect(frame.getByRole('heading', { name: 'Release fixture', exact: true })).toBeVisible({ timeout: BOOT });
    await page.waitForTimeout(1500);
    // Control: the sampler must see a hidden frame as blank, else 0 below means nothing.
    const viewport = page.locator('iframe[data-viewport]').first();
    const clip = await canvasClip(page);
    expect(isBlank(await page.screenshot({ clip }))).toBe(false);
    await viewport.evaluate(el => { el.style.visibility = 'hidden'; });
    expect(isBlank(await page.screenshot({ clip }))).toBe(true);
    await viewport.evaluate(el => { el.style.visibility = ''; });
    // Same control for the per-frame watcher.
    const control = await watchFrames(app, page);
    await viewport.evaluate(el => { el.style.visibility = 'hidden'; });
    await page.waitForTimeout(300);
    await viewport.evaluate(el => { el.style.visibility = ''; });
    await page.waitForTimeout(300);
    const controlRaw = await control.stop();
    const controlFrames = frameSummary(controlRaw);
    // The raw frames and the window state: a control that saw no blank frame must say what it did see.
    console.log('[boundary] frame control', JSON.stringify(controlFrames), 'raw', JSON.stringify(controlRaw),
      'window', JSON.stringify(await (await app.browserWindow(page)).evaluate(w => ({ focused: w.isFocused(), visible: w.isVisible(), minimized: w.isMinimized() }))));
    expect(controlFrames.blank).toBeGreaterThan(0);
    const results = {};
    // The new document's own timeline (epoch ms): where a blank frame sits in it is the cause.
    const timeline = () => frame.locator('body').evaluate(() => {
      const o = performance.timeOrigin, nav = performance.getEntriesByType('navigation')[0] || {};
      const at = v => (v ? Math.round(o + v) : null);
      const t = { type: nav.type, start: Math.round(o), responseEnd: at(nav.responseEnd), domInteractive: at(nav.domInteractive), loadEnd: at(nav.loadEventEnd) };
      for (const e of performance.getEntriesByType('paint')) t[e.name] = at(e.startTime);
      return t;
    }).catch(e => String(e));
    const boundary = async (name, trigger, done, timeoutMs) => {
      const watch = await watchFrames(app, page);
      await mark();
      const t0 = Date.now();
      await trigger();
      results[name] = await sampleBlank(page, done, { timeoutMs });
      results[name].frames = frameSummary(await watch.stop());
      console.log('[boundary] ' + name + ' t0=' + t0, JSON.stringify(results[name]), 'doc', JSON.stringify(await timeline()));
    };
    const mark = () => frame.locator('body').evaluate(() => { window.__sqMarker = 1; }).catch(() => {});
    const replaced = () => frame.locator('body').evaluate(() => window.__sqMarker !== 1).catch(() => false);
    const headingVisible = name => () => frame.getByRole('heading', { name, exact: true }).isVisible();

    // Route change (sidebar page).
    await boundary('route', () => page.locator('input[value="/nested/about"]').click(), // page rows are readonly inputs
      async () => await replaced() && await headingVisible('Nested about')(), 20_000);

    // Back home, then a config change (Astro restarts the server → reconnect boundary).
    await page.locator('input[value="/"]').first().click();
    await expect(frame.getByRole('heading', { name: 'Release fixture', exact: true })).toBeVisible({ timeout: BOOT });
    await page.waitForTimeout(1500);
    // A5: a new <script> cannot run in place → the bridge's 'shape' boundary (document reload).
    // (A config edit would be the 'reconnect' boundary, but a desktop instance never restarts
    // in-process — neither the user's astro.config.mjs nor the wrapper is watched. Recorded gap.)
    const pageFile = path.join(root, 'src/pages/index.astro');
    await boundary('script', async () => fs.writeFile(pageFile, (await fs.readFile(pageFile, 'utf8')).replace('</main>', '  <script>window.__sqScriptRan = 1;</script>\n  </main>')),
      async () => await replaced() && await headingVisible('Release fixture')(), 30_000);
    expect(await frame.locator('body').evaluate(() => window.__sqScriptRan)).toBe(1); // the boundary re-ran it

    // Child kill (crash recovery → new instance url).
    await page.waitForTimeout(1500);
    const pid = (await running(page))?.pid; // the app's own report: any install path, spare or fresh fork
    expect(pid).toBeTruthy();
    const srcBefore = await viewport.getAttribute('src');
    await boundary('kill', async () => process.kill(pid, 'SIGKILL'),
      async () => await replaced() && await headingVisible('Release fixture')(), 30_000);
    // The precondition of the hold: the instance came back on its port (same origin, same src).
    expect(new URL(await viewport.getAttribute('src')).origin).toBe(new URL(srcBefore).origin);

    await info.attach('blank-samples.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
    console.log('[boundary] ' + JSON.stringify(results));
    for (const [k, r] of Object.entries(results)) { expect(r.finished, k).toBe(true); }
    for (const [k, r] of Object.entries(results)) expect(r.blank, k).toBe(0);
    for (const [k, r] of Object.entries(results)) expect(r.frames.blank, k + ' frames').toBe(0);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('A4-draft: text typed when the instance dies is restored in the new document', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-boundary-draft-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    await importFixture(page, 'Boundary draft');
    const frame = preview(page);
    const para = frame.getByText('Second editable paragraph', { exact: true });
    await expect(para).toBeVisible({ timeout: BOOT });
    await select(page, para);
    await expect(page.getByTestId('design-bar').getByText('P', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(frame.locator('[contenteditable="plaintext-only"]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(' before the crash');
    await frame.locator('body').evaluate(() => { window.__sqMarker = 1; });
    process.kill((await running(page)).pid, 'SIGKILL');
    // The new instance's document replaced the old one (marker gone)…
    await expect.poll(() => preview(page).locator('body').evaluate(() => window.__sqMarker !== 1).catch(() => false), { timeout: BOOT }).toBe(true);
    // …and re-entered the edit with the typed text.
    await expect(preview(page).locator('[contenteditable="plaintext-only"]')).toHaveText('Second editable paragraph before the crash', { timeout: 15_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('case 29: an instance that keeps dying keeps its last frame, read-only, with one status', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-boundary-dead-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    await importFixture(page, 'Boundary dead');
    const frame = preview(page);
    await expect(frame.getByRole('heading', { name: 'Release fixture', exact: true })).toBeVisible({ timeout: BOOT });
    const runnerPid = async () => (await running(page))?.pid ?? null;
    const seen = { spinner: 0, notice: 0, samples: 0 };
    let last = null;
    for (let i = 0; i < 4; i++) {
      await expect.poll(async () => { const p = await runnerPid(); return p && p !== last ? p : null; }, { timeout: 30_000 }).toBeTruthy();
      last = await runnerPid(); process.kill(last, 'SIGKILL');
      for (let k = 0; k < 10; k++) {
        await page.waitForTimeout(100);
        seen.samples++;
        if (await page.getByText('Starting preview…', { exact: true }).isVisible()) seen.spinner++;
        if (await page.getByTestId('preview-recovering').isVisible()) seen.notice++;
      }
    }
    console.log('[case29]', JSON.stringify(seen));
    expect(seen.spinner).toBe(0);
    expect(seen.notice).toBeGreaterThan(0);
    // Recovered: the status goes away and the page is back.
    await expect(page.getByTestId('preview-recovering')).toBeHidden({ timeout: BOOT });
    await expect(preview(page).getByRole('heading', { name: 'Release fixture', exact: true })).toBeVisible({ timeout: BOOT });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});
