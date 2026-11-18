// P0 gate measurements (plan Task 9): a fixed journey on a fixed fixture,
// timed by this process's monotonic clock.
//   node scripts/measure.mjs desktop <reps> <out.json>
// desktop = Electron + Astro child (the only runtime).
// Needs the editor on http://127.0.0.1:3061.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const [runtime, repsArg = '5', outFile] = process.argv.slice(2);
if (runtime !== 'desktop') throw new Error(`measure: unknown runtime "${runtime}" (only "desktop")`);
const reps = Number(repsArg);
const root = path.resolve(import.meta.dirname, '..');
const fixture = path.resolve(root, '../app/e2e/fixtures/release-project');
const BOOT = 300_000;
const now = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const step = label => console.error(`[measure ${runtime}] ${(now() / 1000).toFixed(1)}s ${label}`);
/** Hard ceiling per step: a hung close/launch must fail the rep, never the whole run. */
const within = (label, ms, work) => { step(label); return Promise.race([work, sleep(ms).then(() => { throw new Error(`step timeout: ${label}`); })]); };
const previewFrame = page => page.frameLocator('iframe[title$=" preview"]:visible').first();

async function launch(profile) {
  const env = { ...process.env, SQ_USER_DATA: path.join(profile, 'profile'), SQ_PROJECTS_ROOT: path.join(profile, 'projects'), SQ_DOWNLOADS: path.join(profile, 'downloads') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env });
  const page = await app.firstWindow();
  return { page, close: () => app.close(), versions: await app.evaluate(() => process.versions) };
}

/** index.astro bytes, read from disk. */
function sourceReader(page, profile, id) {
  return () => fs.readFile(path.join(profile, 'projects', id, 'src/pages/index.astro'), 'utf8').catch(() => '');
}

async function until(fn, timeout = 60_000, step = 25) {
  const end = now() + timeout;
  for (;;) { if (await fn()) return now(); if (now() > end) throw new Error('timeout'); await sleep(step); }
}

async function select(page, locator) {
  const box = await locator.boundingBox();
  await page.keyboard.down('Meta');
  try { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); } finally { await page.keyboard.up('Meta'); }
}

async function importFixture(page) {
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await page.getByTestId('import-folder-input').setInputFiles(fixture);
  await page.getByLabel('Project name', { exact: true }).fill('Measure fixture');
  const t0 = now();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForURL(/\/editor\/browser_/);
  await previewFrame(page).getByRole('heading', { name: 'Release fixture', exact: true }).waitFor({ timeout: BOOT });
  await page.locator('iframe[data-viewport]').first().waitFor();
  return { ms: now() - t0, id: new URL(page.url()).pathname.split('/').pop(), url: page.url() };
}

async function ready(page) {
  const opaque = () => page.locator('iframe[data-viewport]').first().evaluate(f => getComputedStyle(f).opacity === '1').catch(() => false);
  await until(opaque, BOOT, 50);
}

async function edits(page, read) {
  const frame = previewFrame(page);
  const out = { class: [], text: [], insert: [], delete: [] };
  let navigations = 0;
  const navigatedUrls = [];
  page.on('framenavigated', f => { if (f !== page.mainFrame()) { navigations++; navigatedUrls.push(f.url().slice(0, 160)); } });
  // Class: 10 alternating alignments on the h1.
  const h1 = frame.getByRole('heading', { name: 'Release fixture', exact: true });
  await ready(page); await select(page, h1);
  await page.getByTestId('design-bar').getByText('H1', { exact: true }).waitFor();
  step('class edits');
  const navBefore = navigations;
  // A document marker survives same-document hash updates (#sq-ov=) and dies on a reload.
  const docFrame = () => page.frames().find(f => f !== page.mainFrame() && /^http:\/\/127\.0\.0\.1:\d+\//.test(f.url()));
  await docFrame()?.evaluate(() => { window.__sqMeasureMarker = 1; });
  let tLast = 0; let want = 'start';
  for (let i = 0; i < 10; i++) {
    want = i % 2 === 0 ? 'center' : 'left';
    const t0 = now();
    await page.getByTitle(want === 'center' ? 'Align center' : 'Align left', { exact: true }).click();
    const t1 = await until(() => h1.evaluate((el, w) => getComputedStyle(el).textAlign === w, want).catch(() => false), 10_000, 5);
    out.class.push({ canvasMs: t1 - t0 }); tLast = t0;
  }
  const finalClass = want === 'center' ? 'text-center' : 'text-left';
  const tSrc = await until(async () => new RegExp(`<h1[^>]*class="[^"]*${finalClass}`).test(await read()), 30_000, 50);
  out.classSourceAfterLastGestureMs = tSrc - tLast;
  await sleep(Math.max(0, 7000 - (now() - tLast)));
  out.frameNavigationsDuringClassWindow = navigations - navBefore;
  out.classWindowNavigatedUrls = navigatedUrls.slice(navBefore);
  out.measuredFrameUrl = docFrame()?.url().slice(0, 160);
  out.documentReloadedDuringClassWindow = !(await docFrame()?.evaluate(() => window.__sqMeasureMarker === 1).catch(() => false));
  await page.keyboard.press('Escape');
  step('text edits');
  // Text: 5 edits of the first paragraph.
  for (let i = 0; i < 5; i++) {
    const p = frame.locator('main > p').first();
    const tag = page.getByTestId('design-bar').getByText('P', { exact: true });
    await select(page, p);
    if (!await tag.isVisible().catch(() => false)) { await sleep(500); await select(page, p); }
    await tag.waitFor();
    // The last DesignBar button keeps focus; Enter must reach the editor, not re-click it.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Enter');
    const editable = frame.locator('[contenteditable="true"]');
    if (!await editable.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      const box = await p.boundingBox(); await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    }
    await editable.waitFor();
    const text = `Measured text ${i}`;
    const t0 = now();
    await editable.fill(text); await page.keyboard.press('Escape');
    const t1 = await until(() => frame.locator('main > p').first().textContent().then(t => t === text).catch(() => false), 10_000, 5);
    const t2 = await until(async () => (await read()).includes(text), 30_000, 50);
    out.text.push({ canvasMs: t1 - t0, sourceMs: t2 - t0 });
    await page.keyboard.press('Escape'); await ready(page); await sleep(300);
  }
  step('inserts');
  // Inserts: 3 × duplicate (the shipped single-element insertion control).
  const countP = s => (s.match(/<p\b/g) ?? []).length;
  for (let i = 0; i < 3; i++) {
    const p = frame.locator('main > p').last();
    await select(page, p);
    const key = await p.getAttribute('data-sq-source');
    await page.locator(`[data-layer-key="${key}"]`).click();
    const before = await frame.locator('main > p').count(); const srcBefore = countP(await read());
    const t0 = now();
    await page.keyboard.press('Meta+d');
    const t1 = await until(() => frame.locator('main > p').count().then(c => c === before + 1), 15_000, 5);
    const t2 = await until(async () => countP(await read()) === srcBefore + 1, 30_000, 50);
    out.insert.push({ canvasMs: t1 - t0, sourceMs: t2 - t0 });
    await ready(page);
  }
  step('delete');
  // Delete one.
  {
    const p = frame.locator('main > p').last();
    await select(page, p);
    const before = await frame.locator('main > p').count(); const srcBefore = countP(await read());
    const t0 = now();
    await page.keyboard.press('Delete');
    const t1 = await until(() => frame.locator('main > p').count().then(c => c === before - 1), 15_000, 5);
    const t2 = await until(async () => countP(await read()) === srcBefore - 1, 30_000, 50);
    out.delete.push({ canvasMs: t1 - t0, sourceMs: t2 - t0 });
  }
  return out;
}

const results = { runtime, reps: [], startedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, cpus: os.cpus()[0]?.model, mem: os.totalmem() } };
for (let rep = 0; rep < reps; rep++) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), `sq-measure-${runtime}-`));
  const r = { rep };
  try {
    let s = await within('launch', 120_000, launch(profile)); r.versions = s.versions; globalThis.__page = s.page;
    await s.page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
    const imported = await within('import', BOOT, importFixture(s.page)); r.importToPreviewMs = imported.ms;
    if (rep === 0) r.edits = await within('edits', 600_000, edits(s.page, sourceReader(s.page, profile, imported.id)));
    // Warm reopen: same process, reload the editor.
    step('warm reopen'); let t0 = now(); await s.page.reload();
    await previewFrame(s.page).getByRole('heading', { level: 1 }).waitFor({ timeout: BOOT }); r.warmReopenMs = now() - t0;
    // Cold open: fresh process on the same profile, runtime caches dropped.
    await within('close', 60_000, s.close());
    await fs.rm(path.join(profile, 'projects', imported.id, '.sq/cache'), { recursive: true, force: true });
    s = await within('relaunch', 120_000, launch(profile));
    step('cold open');
    t0 = now(); await s.page.goto(imported.url);
    await previewFrame(s.page).getByRole('heading', { level: 1 }).waitFor({ timeout: BOOT }); r.coldOpenMs = now() - t0;
    await within('close', 60_000, s.close());
  } catch (error) {
    r.error = String(error?.stack ?? error);
    if (process.env.SQ_MEASURE_SHOTS) await globalThis.__page?.screenshot({ path: path.join(process.env.SQ_MEASURE_SHOTS, `${runtime}-rep${rep}-fail.png`) }).catch(() => {});
  }
  finally { await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); }
  results.reps.push(r); console.log(JSON.stringify(r));
}
await fs.writeFile(outFile, JSON.stringify(results, null, 2));
process.exit(0);
