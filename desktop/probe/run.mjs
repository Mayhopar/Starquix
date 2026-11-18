// Round-1 scenario runner (S1-S6; run2.mjs is the superset gate.mjs drives, S5/S6 only live here). One invisible isolated Electron; each run = a FRESH import of the fixture (clean doc/undo/queues).
//   node probe/run.mjs --editor http://localhost:<port>/ --fixture <dir> --label big --out <dir> --plan "S1@90*3,S2@90*3"
// plan item = <scenario>@<param>*<reps>; param = ms between keys (S1/S2/S4) or key-repeat interval ms (S3).
// Output per run: <out>/<label>-<scn>-p<param>-r<rep>.json (raw timeline + analysis) and a one-line summary on stdout.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { startApp, importProject, select, sleep } from './driver.mjs';
import { recorderInit } from './recorder.mjs';
import { analyzeRun, summaryLine } from './analyze.mjs';
import { cpuTimes, cpuDelta } from '../scripts/cpu-times.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const editorUrl = arg('editor'); const fixtureDir = path.resolve(arg('fixture')); const label = arg('label', 'big');
const out = path.resolve(arg('out')); const plan = arg('plan', 'S1@90*1'); const settleMs = +arg('settle', 3500); const tailMs = +arg('tail', 12000);
const nImages = +arg('images', 10); const alwaysReplace = arg('replace', '0') === '1';
const TEXT1 = arg('text', '300'); const TEXT2 = arg('text2', '200'); const PAGE = arg('page', 'src/pages/index.astro'); const ZOOMFIT = arg('zoomfit', '0') === '1'; const tmpBase = arg('tmp', path.join(os.tmpdir(), 'sqprobe-run'));
const nowE = () => performance.timeOrigin + performance.now();
await fs.mkdir(out, { recursive: true });
await fs.mkdir(tmpBase, { recursive: true });
const temp = await fs.mkdtemp(path.join(tmpBase, 'run-'));
const items = plan.split(',').map(s => { const m = /^(S\d)@(\d+)\*(\d+)$/.exec(s.trim()); if (!m) throw new Error(`bad plan item ${s}`); return { scn: m[1], param: +m[2], reps: +m[3] }; });

const H = await startApp({ temp, editorUrl });
const { app, page } = H;
console.log(`[run] temp ${temp} front ${H.front} -> ${H.frontAfter}`);
page.on('dialog', d => { console.log('[run] dialog', d.type(), d.message().slice(0, 120)); d.accept().catch(() => {}); });
const wsLog = []; // Vite HMR frames of the canvas instance (ws://127.0.0.1:<astro port>), stamped on arrival at the runner
page.on('websocket', ws => {
  if (!/^ws:\/\/127\.0\.0\.1:\d+/.test(ws.url()) || ws.url().includes(new URL(editorUrl).port)) return;
  ws.on('framereceived', f => { try { const j = JSON.parse(String(f.payload)); wsLog.push({ t: nowE(), type: j.type, event: j.event, path: j.path, updates: (j.updates ?? []).map(u => `${u.type}:${String(u.path ?? '').replace(/^.*\//, '')}`).slice(0, 4) }); } catch { /* binary / non-JSON */ } });
});
const chunks = [];
await page.exposeBinding('__probePush', (src, chunk) => { chunks.push({ ...chunk, recv: nowE() }); });
await page.addInitScript(recorderInit);
await page.evaluate(recorderInit);

// ---------------------------------------------------------------- helpers
async function calibrate(target, n = 25) {
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = nowE(); const p = await target.evaluate(() => performance.timeOrigin + performance.now()); const b = nowE();
    if (!best || b - a < best.rtt) best = { rtt: b - a, offset: (a + b) / 2 - p };
  }
  return best; // node epoch ≈ page epoch + offset
}
const cpuNow = async () => cpuTimes(execFileSync('ps', ['-axo', 'pid=,ppid=,time=,command='], { maxBuffer: 1 << 26 }).toString(), app.process().pid,
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap(w => w.webContents.mainFrame.framesInSubtree.map(f => [f.osProcessId, f === w.webContents.mainFrame ? 'starquix://app/' : f.url]))).catch(() => []));
const load = () => os.loadavg().map(x => +x.toFixed(2));
const imgTags = txt => { const m = {}; for (const tag of txt.match(/<img\b[^>]*>/gs) ?? []) { const a = /alt="Probe image (\d+)"/.exec(tag); if (a) m[a[1]] = /class=(["'])(.*?)\1/s.exec(tag)?.[2] ?? null; } const fx = /<div id="fx"[^>]*class="([^"]*)"/.exec(txt); if (fx) m.fx = fx[1]; return m; };
function startPoller(file) { // mtime-driven file watcher: every distinct content with its mtime and the poll time
  const versions = []; let stop = false; let lastKey = ''; let last = null;
  const loop = (async () => {
    while (!stop) {
      try {
        const st = await fs.stat(file); const key = `${st.mtimeMs}:${st.size}`;
        if (key !== lastKey) { lastKey = key; const txt = await fs.readFile(file, 'utf8'); if (txt !== last) { last = txt; versions.push({ t: nowE(), mtime: st.mtimeMs, size: st.size, imgs: imgTags(txt) }); } }
      } catch { /* mid-rename: next tick */ }
      await sleep(4);
    }
  })();
  return { versions, stop: async () => { stop = true; await loop; } };
}
async function toProjects() {
  if (/\/editor\//.test(new URL(page.url()).pathname)) await page.goto(editorUrl);
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
}
const previewFrameHandle = async () => (await page.locator('iframe[title$=" preview"]:visible').first().elementHandle()).contentFrame();

async function openFreshProject(name) {
  await toProjects();
  const t0 = nowE();
  const id = await importProject(page, name, fixtureDir);
  const tImported = nowE();
  const loc = page.locator('iframe[title$=" preview"]:visible').first().contentFrame();
  await loc.locator('img[alt="Probe image 1"]').waitFor({ timeout: 300_000 });
  await page.locator('iframe[data-viewport]').first().evaluate(el => new Promise(r => { const t = () => (getComputedStyle(el).opacity === '1' ? r() : setTimeout(t, 20)); t(); }));
  const frame = await previewFrameHandle();
  await frame.evaluate(recorderInit);
  await sleep(settleMs);
  return { id, frame, loc, importMs: tImported - t0, bootMs: nowE() - t0, projectDir: path.join(temp, 'projects', id) };
}

// ---------------------------------------------------------------- one run
async function runOnce(scn, param, rep) {
  const run = { label, scn, param, rep, editorUrl, nImages, startedAt: new Date().toISOString(), loadStart: load(), tailMs };
  const { id, frame, loc, importMs, bootMs, projectDir } = await openFreshProject(`${label} ${scn}-${param}-${rep}`);
  Object.assign(run, { projectId: id, importMs: Math.round(importMs), bootMs: Math.round(bootMs) });
  const bar = page.getByTestId('design-bar');
  const L = []; const mark = (what, extra = {}) => { L.push({ t: nowE(), what, ...extra }); };
  const pageFile = path.join(projectDir, PAGE);
  run.diskInitial = imgTags(await fs.readFile(pageFile, 'utf8'));
  let cfg = { nImages };
  let active = false; let poller = null; let c0 = null; let ipc0 = 0; let con0 = 0;
  const onNav = f => { if (active && f !== page.mainFrame() && /^http:\/\/127\.0\.0\.1:/.test(f.url())) f.evaluate(c => window.__PR?.start(c), cfg).catch(() => {}); };
  page.on('framenavigated', onNav);
  const startCapture = async (extra = {}) => {
    cfg = { nImages, ...(arg('stacks', '0') === '1' ? { stacks: true } : {}), ...extra }; run.cfg = cfg;
    chunks.length = 0; ipc0 = H.ipc.length; con0 = H.consoleLog.length;
    run.calib = { editor: await calibrate(page), frame: await calibrate(frame) };
    poller = startPoller(pageFile); c0 = await cpuNow();
    await page.evaluate(c => window.__PR.start(c), cfg); await frame.evaluate(c => window.__PR.start(c), cfg);
    active = true; mark('capture-start');
  };
  const stopCapture = async () => {
    mark('capture-stop'); active = false;
    run.cpu = cpuDelta(c0, await cpuNow());
    await page.evaluate(() => window.__PR?.stop()).catch(() => {}); await frame.evaluate(() => window.__PR?.stop()).catch(() => {});
    await sleep(250); await poller.stop();
    run.disk = poller.versions; run.loadEnd = load();
  };
  const sleepUntil = t => sleep(Math.max(0, t - nowE()));
  // Page-coordinate box of an element inside the canvas iframe, computed from the iframe's own scale (Playwright's boundingBox ignores the editor's zoom
  // transform for out-of-process iframes).
  async function boxOf(selector) {
    const ib = await page.locator('iframe[title$=" preview"]:visible').first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, lw: el.offsetWidth }; });
    const lb = await frame.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, selector);
    if (!lb) return null; const k = ib.w / ib.lw;
    return { x: ib.x + lb.x * k, y: ib.y + lb.y * k, width: lb.w * k, height: lb.h * k };
  }
  async function clickBox(b) { await page.keyboard.down('Meta'); try { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); } finally { await page.keyboard.up('Meta'); } }
  // Selection proof: the editor's selection box (div.border-stroke-component.z-[1000]) must sit on the target image's current rect.
  const overlayRects = () => page.evaluate(() => [...document.querySelectorAll('div[class*="border-stroke-component"][class*="z-[1000]"]')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  const matches = (ov, b) => ov.some(r => Math.abs(r[0] - b.x) < 6 && Math.abs(r[1] - b.y) < 6 && Math.abs(r[2] - b.width) < 6 && Math.abs(r[3] - b.height) < 6);
  async function selectImage(n) {
    const t0 = nowE(); const sel = `img[alt="Probe image ${n}"]`;
    const b0 = await boxOf(sel); if (!b0) throw new Error(`image ${n} not found`);
    await clickBox(b0); const tClick = nowE();
    let ok = false; const end = Date.now() + 4000;
    while (Date.now() < end) { const b = await boxOf(sel).catch(() => null); if (b && matches(await overlayRects(), b)) { ok = true; break; } await sleep(15); }
    mark('select', { n, ok, clickAt: tClick, ms: Math.round(nowE() - t0) });
    return ok;
  }
  async function typeW(n, text, delay, { replace = false } = {}) {
    const w = bar.locator('span:text-is("W") + input').first();
    await w.click(); if (replace || alwaysReplace) await page.keyboard.press('Meta+a');
    const keys = []; const start = nowE() + 5;
    for (let i = 0; i < text.length; i++) {
      await sleepUntil(start + i * delay);
      const t0 = nowE(); await page.keyboard.press(text[i]); keys.push({ ch: text[i], t0, t1: nowE(), expect: +text.slice(0, i + 1) });
    }
    mark('typed', { n, text, delay, keys });
    return keys;
  }
  async function holdKey(key, totalMs, interval) {
    const start = nowE(); let k = 0; const ts = [];
    while (nowE() - start < totalMs) { ts.push(nowE()); await page.keyboard.down(key); k++; await sleepUntil(start + k * interval); }
    await page.keyboard.up(key); mark('hold', { key, count: k, interval, ts });
  }
  async function selectBox(locator, label) { // generic select (e.g. the background-image frame) with the same overlay proof
    const t0 = nowE(); const sel = typeof locator === 'string' ? locator : '#fx'; const b0 = await boxOf(sel); await clickBox(b0); const tClick = nowE(); let ok = false; const end = Date.now() + 4000;
    while (Date.now() < end) { const b = await boxOf(sel).catch(() => null); if (b && matches(await overlayRects(), b)) { ok = true; break; } await sleep(15); }
    mark('select', { n: label, ok, clickAt: tClick, ms: Math.round(nowE() - t0) }); return ok;
  }
  const zoomFit = async () => { await page.keyboard.press('Shift+1'); await sleep(900); run.zoom = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).find(t => /^\d+%$/.test(t)) ?? null); };
  const ctx = { page, frame, loc, bar, L, mark, startCapture, stopCapture, selectImage, selectBox, zoomFit, typeW, holdKey, sleep, sleepUntil, nowE, pageFile, projectDir, run };
  try {
    await SCENARIOS[scn](ctx, param, { tailMs });
    run.ok = true;
  } catch (e) {
    run.ok = false; run.error = String(e.stack ?? e).slice(0, 1500); console.log('[run] ERROR', run.error);
    if (active) await stopCapture().catch(() => {});
    await page.screenshot({ path: path.join(out, `${label}-${scn}-p${param}-r${rep}-error.png`) }).catch(() => {});
  } finally { page.off('framenavigated', onNav); }
  // merge chunks per document
  const docs = {};
  for (const c of chunks) { const d = docs[c.docId] ??= { docId: c.docId, role: c.role, url: c.url, chunks: 0, data: {} }; d.chunks++; for (const [k, v] of Object.entries(c.data)) (d.data[k] ??= []).push(...v); }
  run.docs = Object.values(docs); run.nodeLog = L; run.ipc = H.ipc.slice(ipc0); run.console = H.consoleLog.slice(con0);
  run.mainLog = H.mainLog.slice(-40);
  run.ws = wsLog.filter(w => w.t >= (L.find(l => l.what === 'capture-start')?.t ?? 0) - 100);
  run.finishedAt = new Date().toISOString();
  run.analysis = run.ok ? analyzeRun(run) : null;
  const file = path.join(out, `${label}-${scn}-p${param}-r${rep}.json`);
  await fs.writeFile(file, JSON.stringify(run));
  console.log(run.ok ? `[run] ${summaryLine(run)}` : `[run] ${scn}@${param} r${rep} FAILED`, '→', path.basename(file));
  return run;
}

// ---------------------------------------------------------------- scenarios
const SCENARIOS = {
  // S1: Fill image, type 300 into W, keep recording (deferred write, replay, HMR).
  async S1(c, delay, o) {
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture();
    await c.typeW(1, TEXT1, delay);
    await c.sleep(o.tailMs); await c.stopCapture();
  },
  // S2: as S1, then within 300 ms click image 2 and type 200 into its W; image 1 must not move again.
  async S2(c, delay, o) {
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture();
    const k1 = await c.typeW(1, TEXT1, delay);
    const gap = 300 - (c.nowE() - k1.at(-1).t1); if (gap > 0) await c.sleep(gap);
    c.mark('switch-begin');
    const ok = await c.selectImage(2);
    c.mark('switch-done', { ok });
    if (!ok) throw new Error('image 2 not selected');
    await c.typeW(2, TEXT2, delay);
    await c.sleep(o.tailMs); await c.stopCapture();
  },
  // S3: hold ArrowUp 2 s in W (key repeat) after setting a fixed width (setup outside the capture).
  async S3(c, interval, o) {
    if (!await c.selectImage(1)) throw new Error('image 1 not selected');
    await c.typeW(1, '100', 40); await c.sleep(9000);                  // setup: fixed 100, pipeline idle (past the 5 s deferral)
    await c.startCapture();
    const w = c.bar.locator('span:text-is("W") + input').first(); await w.click(); await c.sleep(300);
    await c.holdKey('ArrowUp', 2000, interval);
    await c.sleep(o.tailMs); await c.stopCapture();
  },
  // S4: 12 rapid edits across 4 images (select, type) as fast as possible.
  async S4(c, delay, o) {
    const imgs = [1, 2, 5, 6]; const final = {};
    await c.zoomFit();                       // all four images must be on screen (the window cannot exceed the 789 px work area)
    await c.startCapture();
    c.mark('burst-begin');
    for (let i = 0; i < 12; i++) {
      const n = imgs[i % 4]; const val = String(110 + i * 10);
      if (!await c.selectImage(n)) { c.mark('select-failed', { n, i }); continue; }
      await c.typeW(n, val, delay, { replace: true }); final[n] = +val;
    }
    c.mark('burst-end', { final });
    await c.sleep(o.tailMs); await c.stopCapture();
  },
};

SCENARIOS.S5 = async function (c, gap, o) {
  // S5: the image-fill Fit control on a frame with a background image; raw mouse clicks, so a click on a disabled (busy) control is lost, like a user's.
  await c.zoomFit();
  if (!await c.selectBox('#fx', 'fx')) throw new Error('#fx not selected');
  await c.page.locator('[aria-label="Edit image Fill"]').first().click(); await c.sleep(700);
  const fit = c.page.locator('fieldset[aria-label="Image fit"]');
  await c.startCapture({ styleProbes: [{ sel: '#fx', prop: 'backgroundSize' }], editorWatch: [{ sel: 'fieldset[aria-label="Image fit"]', prop: 'disabled' }] });
  const seq = [['Fit', 'contain'], ['Fill', 'cover'], ['Fit', 'contain'], ['Fill', 'cover'], ['Fit', 'contain'], ['Fill', 'cover'], ['Fit', 'contain'], ['Fill', 'cover']];
  const start = c.nowE() + 200;
  for (let i = 0; i < seq.length; i++) {
    await c.sleepUntil(start + i * gap);
    const b = await fit.locator(`button[title="${seq[i][0]}"]`).boundingBox(); const t0 = c.nowE();
    await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    c.mark('click', { i, label: seq[i][0], expect: seq[i][1], t0, t1: c.nowE() });
  }
  await c.sleep(o.tailMs); await c.stopCapture();
};

SCENARIOS.S6 = async function (c, delay, o) {
  // S6: the owner moves on and does a FLUSH-BOUNDARY action on another image: type 300 into image 1's W, within 300 ms select image 2 and click Fit
  // in its image-fill popover (useImageFill flushes pending source writes). Does image 1 change again?
  if (!await c.selectImage(1)) throw new Error('image 1 not selected');
  await c.sleep(500);
  await c.startCapture({ styleProbes: [{ sel: 'img[alt="Probe image 2"]', prop: 'objectFit' }] });
  const k1 = await c.typeW(1, '300', delay);
  const gap = 300 - (c.nowE() - k1.at(-1).t1); if (gap > 0) await c.sleep(gap);
  c.mark('switch-begin');
  const ok = await c.selectImage(2); c.mark('switch-done', { ok });
  if (!ok) throw new Error('image 2 not selected');
  await c.page.locator('[aria-label="Edit image Fill"]').first().click(); await c.sleep(250);
  const fit = c.page.locator('fieldset[aria-label="Image fit"]');
  const b = await fit.locator('button[title="Fit"]').boundingBox(); const t0 = c.nowE();
  await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  c.mark('click', { i: 0, label: 'Fit', expect: 'contain', t0, t1: c.nowE() });
  await c.sleep(o.tailMs); await c.stopCapture();
};

const results = [];
try {
  for (const it of items) for (let rep = 1; rep <= it.reps; rep++) results.push(await runOnce(it.scn, it.param, rep));
} finally {
  await app.close().catch(() => {});
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
console.log('[run] done', results.length, 'runs');
