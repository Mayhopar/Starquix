// Scenario runner of the probe harness (gate.mjs drives it; run it by hand for one-off cells). Superset of run.mjs:
//  - ONE project reused across runs (aged journal): journal stats through the editor IndexedDB (DB `starquix`), drain, reopen, grow, CELL plan items;
//  - overlay sampling (--overlay 1), an outside writer (S2O), a load gate, component-hosted images (alt-tagged component usages).
//   node probe/run2.mjs --editor http://localhost:<port>/ --fixture <dir> --label aged-big --out <dir> --plan "CELL@1*1,CELL@60*1" --measure "S1@90*3,S3@33*1"
//   --editor: the production bundle served by probe/bundle.mjs (what gate.mjs passes), or a vite dev server of this worktree (3-5x slower)
// plan item = <NAME>@<param>*<reps>:  S1..S6 (as run.mjs) | S2O (S2 + outside appends to the page file at +OUTSIDE ms after image 1's last key)
//   P-1b scenarios (design 4.2): S7@<ms/key> type 300 then Cmd-Z 1 s after the last digit | S7b@<ms/key> three unlanded edits (the first of an element) then Cmd-Z x3 at +1 s |
//   S8@<ms/key> revisit: 3, 30, Backspace on image 1; 100, 150, 100 + Enter on image 2 | S10@<ms/key> V2 (component root) then V3 (inner element) from the page |
//   S12@<ms after image A's last key> Fit on image B while A's deferred rows replay | S13@<ms/key> S1 and S13H@<repeat ms> S3 under CPU throttle x4 on BOTH CDP targets
//   CELL@<J>*1 = grow the journal to J accepted rows, drain, reopen (fresh session on the aged journal), then run every --measure item (stop rule: --maxAccept)
//   GROW@<interval ms>*<J> | REOPEN@0*1 | DRAIN@0*1 | STAT@0*1
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { startApp, importProject, sleep } from './driver.mjs';
import { recorderInit } from './recorder.mjs';
import { analyzeRun, summaryLine } from './analyze.mjs';
import { cpuTimes, cpuDelta } from '../scripts/cpu-times.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const editorUrl = arg('editor'); const fixtureDir = path.resolve(arg('fixture')); const label = arg('label', 'r2');
const out = path.resolve(arg('out')); const plan = arg('plan', 'S1@90*1'); const measurePlan = arg('measure', 'S1@90*3,S3@33*1');
const settleMs = +arg('settle', 3500); const tailMs = +arg('tail', 12000); const nImages = +arg('images', 10);
const alwaysReplace = arg('replace', '1') === '1'; const IMG1 = +arg('img1', 1); const IMG2 = +arg('img2', 2);
const LAYER_KEYS = Object.fromEntries(arg('layers', '').split(',').filter(Boolean).map(s => { const [n, ...k] = s.split('='); return [n, k.join('=')]; })); // n=<source key prefix>: select image n through the Layers panel row (images covered on the canvas)
const TEXT1 = arg('text', '300'); const TEXT2 = arg('text2', '200'); const PAGE = arg('page', 'src/pages/index.astro'); const ZOOMFIT = arg('zoomfit', '0') === '1';
const tmpBase = arg('tmp', path.join(os.tmpdir(), 'sqprobe-run')); const OVERLAY = arg('overlay', '0') === '1';
const OUTSIDE = arg('outside', '1000,3000').split(',').map(Number); const WATCH = arg('watch', '').split(',').filter(Boolean); // extra project files whose versions are recorded
const CLICK_AT = Object.fromEntries(arg('clickat', '').split(',').filter(Boolean).map(s => { const [n, fx, fy] = s.split(/[=:]/); return [n, [+fx, +fy]]; })); // n=fx:fy fraction of the image box to click (default centre)
const FRESH = arg('fresh', '0') === '1'; const DELAY = +arg('delay', 90); // DELAY: ms/key of the scenarios whose plan param means something else (S12)
const UNDO_FOCUS = arg('undofocus', 'blur'); // S7/S7b: where the focus is when Cmd-Z is pressed. blur = out of the field, where the editor's undo shortcut runs (it ignores inputs); field = in the W input (native text undo today)
const REPLAYCAPTURE = arg('replaycapture', '0') === '1'; // keep capturing until the journal is drained, so the 5 s deferred replay (and its canvas refreshes) is inside the capture
const THROTTLE = +arg('throttle', 4);
const LOAD_GATE = +arg('loadgate', 13); const LOAD_WAIT = +arg('loadwait', 180000);
const GROW_BATCH = +arg('growbatch', 25); const GROW_CAP_MS = +arg('growcap', 1500000); const MAX_ACCEPT = +arg('maxaccept', 1500);
const DRAIN_CAPTURE = arg('draincapture', '0') === '1'; const DRAIN_CAP = +arg('draincap', 150000);
const nowE = () => performance.timeOrigin + performance.now();
await fs.mkdir(out, { recursive: true });
await fs.mkdir(tmpBase, { recursive: true });
const temp = await fs.mkdtemp(path.join(tmpBase, 'run2-'));
const parse = s => s.split(',').filter(Boolean).map(x => { const m = /^([A-Z][A-Za-z0-9]*)@(\d+)\*(\d+)$/.exec(x.trim()); if (!m) throw new Error(`bad plan item ${x}`); return { scn: m[1], param: +m[2], reps: +m[3] }; });
const items = parse(plan); const measureItems = parse(measurePlan);
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

const H = await startApp({ temp, editorUrl });
const { app, page } = H;
console.log(`[run2] temp ${temp} front ${H.front} -> ${H.frontAfter}`);
page.on('dialog', d => { console.log('[run2] dialog', d.type(), d.message().slice(0, 120)); d.accept().catch(() => {}); });
const wsLog = [];
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
  return best;
}
const cpuNow = async () => cpuTimes(execFileSync('ps', ['-axo', 'pid=,ppid=,time=,command='], { maxBuffer: 1 << 26 }).toString(), app.process().pid,
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap(w => w.webContents.mainFrame.framesInSubtree.map(f => [f.osProcessId, f === w.webContents.mainFrame ? 'starquix://app/' : f.url]))).catch(() => []));
const load = () => os.loadavg().map(x => +x.toFixed(2));
// <img> tags AND component usages that carry alt="Probe image N": the class value is the first `class` / `*Class` attribute of that tag.
const imgTags = txt => {
  const m = {};
  for (const tag of txt.match(/<[A-Za-z][\w.]*\b[^>]*?alt="Probe image \d+"[^>]*>/gs) ?? []) {
    const a = /alt="Probe image (\d+)"/.exec(tag); if (!a) continue;
    const c = /\s(?:class|\w*[Cc]lass)=(["'])(.*?)\1/s.exec(tag); m[a[1]] = c ? c[2] : null;
  }
  const fx = /<div id="fx"[^>]*class="([^"]*)"/.exec(txt); if (fx) m.fx = fx[1];
  return m;
};
function startPoller(files) { // mtime-driven watcher: every distinct content per file with its mtime and the poll time
  const versions = {}; let stop = false;
  const loops = files.map(file => (async () => {
    const vs = versions[file] = []; let lastKey = ''; let last = null;
    while (!stop) {
      try {
        const st = await fs.stat(file); const key = `${st.mtimeMs}:${st.size}`;
        if (key !== lastKey) { lastKey = key; const txt = await fs.readFile(file, 'utf8'); if (txt !== last) { last = txt; vs.push({ t: nowE(), mtime: st.mtimeMs, size: st.size, imgs: imgTags(txt) }); } }
      } catch { /* mid-rename: next tick */ }
      await sleep(4);
    }
  })());
  return { versions, stop: async () => { stop = true; await Promise.all(loops); } };
}
async function toProjects() {
  if (/\/editor\//.test(new URL(page.url()).pathname)) await page.goto(editorUrl);
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
}
const previewFrameHandle = async () => (await page.locator('iframe[title$=" preview"]:visible').first().elementHandle()).contentFrame();

let proj = null; // { id, frame, loc, projectDir, bootMs }
async function attachProject(id) {
  const loc = page.locator('iframe[title$=" preview"]:visible').first().contentFrame();
  await loc.locator('img[alt="Probe image 1"]').waitFor({ timeout: 300_000 });
  await page.locator('iframe[data-viewport]').first().evaluate(el => new Promise(r => { const t = () => (getComputedStyle(el).opacity === '1' ? r() : setTimeout(t, 20)); t(); }));
  const frame = await previewFrameHandle();
  await frame.evaluate(recorderInit);
  await sleep(settleMs);
  return { id, frame, loc, projectDir: path.join(temp, 'projects', id) };
}
async function openFresh(name) {
  await toProjects();
  const t0 = nowE();
  const id = await importProject(page, name, fixtureDir);
  const tImported = nowE();
  proj = await attachProject(id);
  Object.assign(proj, { importMs: tImported - t0, bootMs: nowE() - t0 });
  return proj;
}
async function reopen() { // fresh editor session (fresh Y.Doc, undo stack, queues, scan state) on the SAME project + journal
  const t0 = nowE();
  await page.goto(`${editorUrl.replace(/\/$/, '')}/editor/${proj.id}`);
  const id = proj.id; proj = await attachProject(id); proj.bootMs = nowE() - t0;
  return proj;
}

// ---- the journal, read straight from the editor's IndexedDB (cheap: counts and one state row, no row deserialization) ----
const journalStats = () => page.evaluate(async pid => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('starquix'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    const one = (store, fn) => new Promise((res, rej) => { const tx = db.transaction(store, 'readonly'); const r = fn(tx.objectStore(store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const st = await one('durableProjectState', s => s.get(pid));
    const rows = await one('durableEdits', s => s.index('projectId').count(IDBKeyRange.only(pid)));
    const receipts = await one('durableCommandReceipts', s => s.index('projectId').count(IDBKeyRange.only(pid)));
    const est = await navigator.storage.estimate().catch(() => null);
    return { accepted: st?.acceptedRevision ?? 0, materialized: st?.materializedRevision ?? 0, rows, receipts, usageMB: est ? Math.round(est.usage / 1e5) / 10 : null };
  } finally { db.close(); }
}, proj.id);
// Row kinds accepted after `since` (P3): kinds, files touched by the prepared changes, payload sizes.
const journalRows = since => page.evaluate(async ([pid, since]) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('starquix'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    const rows = await new Promise((res, rej) => { const r = db.transaction('durableEdits', 'readonly').objectStore('durableEdits').index('[projectId+revision]').getAll(IDBKeyRange.bound([pid, since + 1], [pid, Infinity])); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return rows.map(r => ({ rev: r.revision, op: String(r.operationId).slice(-6), at: r.acceptedAt, mat: r.materializedAt, yjs: r.yjsUpdate?.byteLength ?? 0,
      commands: r.commands.map(c => ({ kind: c.kind, files: (c.kind === 'file-batch' ? c.payload.files : c.payload.preparedFiles ?? []).map(f => `${f.file}:${f.beforeSource?.length ?? 'null'}>${f.afterSource?.length ?? 'null'}`),
        cls: c.kind === 'class-write' ? String(c.payload.newClasses).slice(-60) : undefined, deferIn: c.payload?.deferUntil ? Math.round(c.payload.deferUntil - r.acceptedAt) : undefined })) }));
  } finally { db.close(); }
}, [proj.id, since]);
async function drain({ quietMs = 6000, maxMs = 420000 } = {}) { // returns when no row was accepted for `quietMs` AND every accepted row is materialized
  const t0 = nowE(); let last = await journalStats(); let tChange = nowE();
  for (;;) {
    await sleep(400);
    const s = await journalStats();
    if (s.accepted !== last.accepted) { last = s; tChange = nowE(); continue; }
    last = s;
    if (s.materialized >= s.accepted && nowE() - tChange >= quietMs) return { ms: Math.round(nowE() - t0), ...s };
    if (nowE() - t0 > maxMs) return { timeout: true, ms: Math.round(nowE() - t0), ...s };
  }
}
async function quietLane(quietMs = 3000, maxMs = DRAIN_CAP) { // the accept lane is idle (no new accepted row for quietMs); materialization may still be pending
  const t0 = nowE(); let last = await journalStats(); let tChange = nowE();
  for (;;) {
    await sleep(300);
    const s = await journalStats();
    if (s.accepted !== last.accepted) { last = s; tChange = nowE(); continue; }
    if (nowE() - tChange >= quietMs) return { ms: Math.round(nowE() - t0), ...s };
    if (nowE() - t0 > maxMs) return { timeout: true, ms: Math.round(nowE() - t0), ...s };
  }
}
async function loadGate() {
  const t0 = nowE(); const first = load()[0];
  while (load()[0] > LOAD_GATE && nowE() - t0 < LOAD_WAIT) await sleep(10000);
  return { first, waitedMs: Math.round(nowE() - t0), now: load()[0], gaveUp: load()[0] > LOAD_GATE };
}

// ---------------------------------------------------------------- run context (everything that needs the CURRENT project handle)
function makeCtx(run) {
  const { frame, loc, projectDir } = proj;
  const bar = page.getByTestId('design-bar');
  const L = []; const mark = (what, extra = {}) => { L.push({ t: nowE(), what, ...extra }); };
  const pageFile = path.join(projectDir, PAGE);
  let cfg = { nImages }; let active = false; let poller = null; let c0 = null; let ipc0 = 0; let con0 = 0;
  const onNav = f => { if (active && f !== page.mainFrame() && /^http:\/\/127\.0\.0\.1:/.test(f.url())) f.evaluate(c => window.__PR?.start(c), cfg).catch(() => {}); };
  const startCapture = async (extra = {}) => {
    cfg = { nImages, ...(OVERLAY ? { overlay: true } : {}), ...extra }; run.cfg = cfg;
    run.journalBefore = await journalStats();
    run.iframeGeom = await page.locator('iframe[title$=" preview"]:visible').first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, lw: el.offsetWidth }; });
    chunks.length = 0; ipc0 = H.ipc.length; con0 = H.consoleLog.length;
    run.calib = { editor: await calibrate(page), frame: await calibrate(frame) };
    poller = startPoller([pageFile, ...WATCH.map(f => path.join(projectDir, f))]); c0 = await cpuNow();
    page.on('framenavigated', onNav);
    await page.evaluate(c => window.__PR.start(c), cfg); await frame.evaluate(c => window.__PR.start(c), cfg);
    active = true; mark('capture-start');
    return { ipc0, con0 };
  };
  const stopCapture = async () => {
    mark('capture-stop'); active = false;
    run.cpu = cpuDelta(c0, await cpuNow());
    await page.evaluate(() => window.__PR?.stop()).catch(() => {}); await frame.evaluate(() => window.__PR?.stop()).catch(() => {});
    await sleep(250); await poller.stop(); page.off('framenavigated', onNav);
    run.disk = poller.versions[pageFile]; run.diskExtra = Object.fromEntries(WATCH.map(f => [f, poller.versions[path.join(projectDir, f)]]));
    run.loadEnd = load();
    run.captureIpc = [ipc0, con0];
  };
  const sleepUntil = t => sleep(Math.max(0, t - nowE()));
  async function boxOf(selector) {
    const ib = await page.locator('iframe[title$=" preview"]:visible').first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, lw: el.offsetWidth }; });
    const lb = await frame.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, selector);
    if (!lb) return null; const k = ib.w / ib.lw;
    return { x: ib.x + lb.x * k, y: ib.y + lb.y * k, width: lb.w * k, height: lb.h * k };
  }
  async function clickBox(b, frac = [0.5, 0.5]) { await page.keyboard.down('Meta'); try { await page.mouse.click(b.x + b.width * frac[0], b.y + b.height * frac[1]); } finally { await page.keyboard.up('Meta'); } }
  const overlayRects = () => page.evaluate(() => [...document.querySelectorAll('div[class*="border-stroke-component"][class*="z-[1000]"]')].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  const matches = (ov, b) => ov.some(r => Math.abs(r[0] - b.x) < 6 && Math.abs(r[1] - b.y) < 6 && Math.abs(r[2] - b.width) < 6 && Math.abs(r[3] - b.height) < 6);
  async function selectImage(n) {
    const t0 = nowE(); const sel = `img[alt="Probe image ${n}"]`;
    const b0 = await boxOf(sel); if (!b0) throw new Error(`image ${n} not found`);
    await clickBox(b0, CLICK_AT[n] ?? [0.5, 0.5]); let tClick = nowE();
    if (LAYER_KEYS[n]) { // the canvas click lands on whatever covers the image: reveal it in the Layers panel (selecting the covering element expands the tree to it), then click ITS row
      let key = LAYER_KEYS[n];
      if (key === 'auto') { // source key `<page>:<line>:<col>` of the <img alt="Probe image n"> tag, read from the project file
        const txt = await fs.readFile(pageFile, 'utf8'); const at = txt.indexOf(`alt="Probe image ${n}"`); const start = txt.lastIndexOf('<img', at); const before = txt.slice(0, start);
        key = `${PAGE}:${before.split('\n').length}:${start - before.lastIndexOf('\n')}`; mark('layers-key', { n, key });
      }
      const row = page.locator(`[data-layer-key^="${key}"] [data-testid="layer-item"]`).first();
      try { await row.waitFor({ timeout: 5000 }); await row.click({ position: { x: 60, y: 8 } }); tClick = nowE(); mark('layers-click', { n, key }); }
      catch (e) { mark('layers-click-failed', { n, key, err: String(e).slice(0, 160) }); }
    }
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
  async function holdKey(key, totalMs, interval, tag = 'hold') {
    const start = nowE(); let k = 0; const ts = [];
    while (nowE() - start < totalMs) { ts.push(nowE()); await page.keyboard.down(key); k++; await sleepUntil(start + k * interval); }
    await page.keyboard.up(key); mark(tag, { key, count: k, interval, ts });
  }
  async function selectBox(locator, lab) {
    const t0 = nowE(); const sel = typeof locator === 'string' ? locator : '#fx'; const b0 = await boxOf(sel); await clickBox(b0); const tClick = nowE(); let ok = false; const end = Date.now() + 4000;
    while (Date.now() < end) { const b = await boxOf(sel).catch(() => null); if (b && matches(await overlayRects(), b)) { ok = true; break; } await sleep(15); }
    mark('select', { n: lab, ok, clickAt: tClick, ms: Math.round(nowE() - t0) }); return ok;
  }
  const zoomFit = async () => { await page.keyboard.press('Shift+1'); await sleep(900); run.zoom = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).find(t => /^\d+%$/.test(t)) ?? null); };
  // ---- P-1b helpers. Every mark names the element it touches (`n`, a probe image number or an element id) so the analysis knows which final value an input decides.
  const digits = text => [...text].map((ch, i) => ({ key: ch, expect: +text.slice(0, i + 1) })); // typed number: each key's paint expectation is the number typed so far
  /** Press `seq` = [{ key, expect }] into the focused W field of the selected element: `expect` = the width the canvas should show after that key (null: no paint expected, e.g. Enter). */
  async function typeKeys(n, seq, delay, { replace = false } = {}) {
    const w = bar.locator('span:text-is("W") + input').first();
    await w.click(); if (replace || alwaysReplace) await page.keyboard.press('Meta+a');
    const keys = []; const enters = []; const start = nowE() + 5;
    for (let i = 0; i < seq.length; i++) {
      await sleepUntil(start + i * delay);
      const t0 = nowE(); await page.keyboard.press(seq[i].key); const rec = { ch: seq[i].key, t0, t1: nowE() };
      if (seq[i].expect != null) keys.push({ ...rec, expect: seq[i].expect }); else enters.push(rec);
    }
    mark('typed', { n, text: seq.map(x => x.key).join(' '), delay, keys, enters });
    return { keys, enters };
  }
  /** The editor's undo (Cmd-Z). blur = focus leaves the field first (the shortcut handler ignores inputs); field = pressed with the focus in the W input. */
  async function undo(k, n, target) {
    if (UNDO_FOCUS === 'blur') await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === 'function') a.blur(); });
    const t0 = nowE(); await page.keyboard.press('Meta+z'); const t1 = nowE();
    mark('undo', { k, n, t0, t1, target, focus: UNDO_FOCUS });
    return { t0, t1 };
  }
  /** The class each probe image has in the canvas right now (before its first edit: the "pre-edit class" an undo must bring back). */
  async function markInitial(ns) {
    const got = await frame.evaluate(list => list.map(n => [n, document.querySelector(`img[alt="Probe image ${n}"]`)?.getAttribute('class') ?? null]), ns);
    for (const [n, cls] of got) mark('initial', { n, cls });
  }
  const openFill = async () => { await page.locator('[aria-label="Edit image Fill"]').first().click(); await sleep(250); return page.locator('fieldset[aria-label="Image fit"]'); };
  const clickBoxOf = async button => { const b = await button.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  /** Capture until the accept lane is quiet and (REPLAYCAPTURE or `replay`) the journal is drained: the deferred replay and its canvas refreshes are then inside the capture. */
  async function finish(o, replay = false, lane = DRAIN_CAPTURE) {
    await sleep(o.tailMs); if (lane) run.laneQuiet = await quietLane();
    if (replay || REPLAYCAPTURE) run.captureDrain = await drain({ quietMs: 3000, maxMs: 120000 });
    await stopCapture();
  }
  // ---- CPU throttle (S13): Emulation.setCPUThrottlingRate on BOTH targets, the editor renderer and the canvas iframe (its own CDP target, its own process). Proven, not assumed:
  // a fixed busy loop is timed in each target before and after, and the slowdown ratio is recorded.
  async function throttleOn(rate) {
    // 1.5e7 square roots: about 15 ms unthrottled, long enough that timer resolution and a cold JIT do not decide the ratio; the median of 5
    const busy = target => target.evaluate(() => { const t0 = performance.now(); let x = 0; for (let i = 0; i < 1.5e7; i++) x += Math.sqrt(i); return performance.now() - t0; });
    const median3 = async target => { const v = []; for (let i = 0; i < 5; i++) v.push(await busy(target)); return v.sort((a, b) => a - b)[2]; };
    const sessions = []; const record = { rate, targets: [] };
    for (const [role, target] of [['editor', page], ['frame', frame]]) {
      const rec = { role, ok: false };
      try {
        rec.baseMs = Math.round(await median3(target) * 10) / 10;
        const session = await page.context().newCDPSession(target); sessions.push(session);
        await session.send('Emulation.setCPUThrottlingRate', { rate });
        rec.throttledMs = Math.round(await median3(target) * 10) / 10; rec.ratio = Math.round(rec.throttledMs / rec.baseMs * 100) / 100; rec.ok = rec.ratio >= rate * 0.5;
      } catch (e) { rec.error = String(e).slice(0, 200); }
      record.targets.push(rec);
    }
    run.throttle = record;
    return async () => { for (const session of sessions) { await session.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {}); await session.detach().catch(() => {}); } };
  }
  return { page, frame, loc, bar, L, mark, startCapture, stopCapture, selectImage, selectBox, zoomFit, typeW, typeKeys, digits, undo, markInitial, openFill, clickBoxOf, finish, throttleOn, holdKey, sleep, sleepUntil, nowE, pageFile, projectDir, run, onNavOff: () => page.off('framenavigated', onNav), isActive: () => active, ipcRange: () => [ipc0, con0] };
}

// ---------------------------------------------------------------- journal growth (not recorded): ±1 ArrowUp/Down holds on image 1's W field until `target` rows are accepted
async function growTo(target, interval) {
  const c = makeCtx({}); const t0 = nowE(); let loops = 0; let s = await journalStats();
  if (s.accepted >= target) return { loops, ...s, ms: 0 };
  if (!await c.selectImage(1)) throw new Error('grow: image 1 not selected');
  await c.typeW(1, '100', 40, { replace: true });
  while (s.accepted < target) {
    if (nowE() - t0 > GROW_CAP_MS) { console.log(`[run2] grow cap hit at ${s.accepted}/${target}`); break; }
    const n = Math.min(GROW_BATCH, target - s.accepted);
    const w = c.bar.locator('span:text-is("W") + input').first(); await w.click();
    await c.holdKey(loops % 2 ? 'ArrowDown' : 'ArrowUp', n * interval, interval, 'grow');
    loops++;
    s = await drain({ quietMs: 6000 });
    if (loops % 4 === 0) console.log(`[run2] grow ${s.accepted}/${target} rows=${s.rows} usage ${s.usageMB} MB load ${load()[0]} (${Math.round((nowE() - t0) / 1000)} s)`);
  }
  c.onNavOff();
  return { loops, ...s, ms: Math.round(nowE() - t0) };
}

// ---------------------------------------------------------------- one run
async function runOnce(scn, param, rep, extra = {}) {
  const run = { label, scn, param, rep, editorUrl, nImages, img1: IMG1, img2: IMG2, startedAt: new Date().toISOString(), loadStart: load(), tailMs, ...extra };
  run.loadGate = await loadGate();
  run.fresh = !proj || FRESH;
  if (run.fresh) { const p = await openFresh(`${label} ${scn}-${param}-${rep}`); run.importMs = Math.round(p.importMs); }
  else if (FRESH_SESSION.has(scn)) { await reopen(); run.fresh = true; } // first-edit undo paths need an editor session that has not edited these elements yet
  run.bootMs = Math.round(proj.bootMs ?? 0); run.projectId = proj.id;
  const c = makeCtx(run);
  run.diskInitial = imgTags(await fs.readFile(c.pageFile, 'utf8'));
  try { await SCENARIOS[scn](c, param, { tailMs }); run.ok = true; }
  catch (e) {
    run.ok = false; run.error = String(e.stack ?? e).slice(0, 1500); console.log('[run2] ERROR', run.error);
    if (c.isActive()) await c.stopCapture().catch(() => {});
    await page.screenshot({ path: path.join(out, `${label}-${extra.tag ?? ''}${scn}-p${param}-r${rep}-error.png`) }).catch(() => {});
  } finally { c.onNavOff(); }
  run.journalAfterCapture = await journalStats();
  run.drain = await drain({ quietMs: 6000 });
  const before = run.journalBefore?.accepted ?? 0;
  run.rowsAdded = run.drain.accepted - before;
  if (arg('rows', '0') === '1' || run.wantRows) run.journalRows = await journalRows(before).catch(e => ({ error: String(e) }));
  try { const txt = await fs.readFile(c.pageFile, 'utf8'); run.finalPage = { imgs: imgTags(txt), outsideComments: (txt.match(/<!-- probe-outside-/g) ?? []).length, outsideKept: c.L.filter(l => l.what === 'outside-write').filter(l => txt.includes(l.token)).length, outsideWrites: c.L.filter(l => l.what === 'outside-write').length, bytes: txt.length }; } catch { /* ignore */ }
  // merge chunks per document
  const docs = {};
  for (const ch of chunks) { const d = docs[ch.docId] ??= { docId: ch.docId, role: ch.role, url: ch.url, chunks: 0, data: {} }; d.chunks++; for (const [k, v] of Object.entries(ch.data)) (d.data[k] ??= []).push(...v); }
  const [ipc0, con0] = run.captureIpc ?? [0, 0];
  run.docs = Object.values(docs); run.nodeLog = c.L; run.ipc = H.ipc.slice(ipc0); run.console = H.consoleLog.slice(con0); run.mainLog = H.mainLog.slice(-40);
  run.ws = wsLog.filter(w => w.t >= (c.L.find(l => l.what === 'capture-start')?.t ?? 0) - 100);
  run.finishedAt = new Date().toISOString();
  try { run.analysis = run.ok ? analyzeRun(run) : null; } catch (e) { run.analysisError = String(e.stack ?? e).slice(0, 600); run.analysis = null; console.log('[run2] analysis error', run.analysisError); }
  const file = path.join(out, `${label}-${extra.tag ?? ''}${scn}-p${param}-r${rep}.json`);
  await fs.writeFile(file, JSON.stringify(run));
  const a = run.analysis; const ph = a?.acceptPhases;
  console.log(run.ok ? `[run2] ${extra.tag ?? ''}${summaryLine(run).slice(0, 360)}` : `[run2] ${scn}@${param} r${rep} FAILED`, '→', path.basename(file));
  console.log(`[run2]   J ${run.journalBefore?.accepted}→${run.drain.accepted} (rows ${run.journalAfterCapture?.rows}, mat ${run.drain.materialized}) load ${run.loadStart[0]}→${run.loadEnd?.[0]} gate ${run.loadGate.first}→${run.loadGate.now}${run.loadGate.gaveUp ? ' GAVE UP' : ''} accept p50/p95 ${ph?.total?.p50}/${ph?.total?.p95} (n ${ph?.edits}) [ck ${ph?.checkpoint?.p50} pr ${ph?.prepare?.p50} id ${ph?.identities?.p50} st ${ph?.store?.p50} q ${ph?.queue?.p50}] drain ${run.drain.ms} ms`);
  return run;
}

// ---------------------------------------------------------------- scenarios
const SCENARIOS = {
  async S1(c, delay, o) {
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture();
    await c.typeW(IMG1, TEXT1, delay);
    await c.finish(o);
  },
  async S2(c, delay, o) {
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture();
    const k1 = await c.typeW(IMG1, TEXT1, delay);
    const gap = 300 - (c.nowE() - k1.at(-1).t1); if (gap > 0) await c.sleep(gap);
    c.mark('switch-begin');
    const ok = await c.selectImage(IMG2);
    c.mark('switch-done', { ok });
    if (!ok) throw new Error('image 2 not selected');
    await c.typeW(IMG2, TEXT2, delay);
    await c.finish(o);
  },
  // S2O: S2 + an OUTSIDE writer (terminal / agent): an HTML comment is appended to the page file at +OUTSIDE[i] ms after image 1's last key.
  async S2O(c, delay, o) {
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture();
    const k1 = await c.typeW(IMG1, TEXT1, delay); const tA = k1.at(-1).t1;
    const outs = OUTSIDE.map((ms, i) => (async () => { await c.sleepUntil(tA + ms); const token = `probe-outside-${c.run.rep}-${i + 1}-${Date.now().toString(36)}`; const t0 = c.nowE(); await fs.appendFile(c.pageFile, `\n<!-- ${token} -->\n`); c.mark('outside-write', { i: i + 1, token, t0, t1: c.nowE(), afterLastKey1: Math.round(t0 - tA) }); })());
    const gap = 300 - (c.nowE() - tA); if (gap > 0) await c.sleep(gap);
    c.mark('switch-begin');
    const ok = await c.selectImage(IMG2);
    c.mark('switch-done', { ok });
    if (!ok) throw new Error('image 2 not selected');
    await c.typeW(IMG2, TEXT2, delay);
    await Promise.all(outs);
    await c.finish(o, false, false);
  },
  async S3(c, interval, o) {
    if (!await c.selectImage(1)) throw new Error('image 1 not selected');
    await c.typeW(1, '100', 40, { replace: true }); await c.sleep(9000);
    await c.startCapture();
    const w = c.bar.locator('span:text-is("W") + input').first(); await w.click(); await c.sleep(300);
    await c.holdKey('ArrowUp', 2000, interval);
    await c.finish(o);
  },
  async S4(c, delay, o) {
    const imgs = [1, 2, 5, 6]; const final = {};
    await c.zoomFit();
    await c.startCapture();
    c.mark('burst-begin');
    for (let i = 0; i < 12; i++) {
      const n = imgs[i % 4]; const val = String(110 + i * 10);
      if (!await c.selectImage(n)) { c.mark('select-failed', { n, i }); continue; }
      await c.typeW(n, val, delay, { replace: true }); final[n] = +val;
    }
    c.mark('burst-end', { final });
    await c.finish(o);
  },
  // S5: the image-fill Fit control of a frame with a background image (#fx), raw mouse clicks (a click on a busy, disabled control is lost, like a user's). run.mjs has the round-1 copy.
  async S5(c, gap, o) {
    await c.zoomFit();
    if (!await c.selectBox('#fx', 'fx')) throw new Error('#fx not selected');
    const fit = await c.openFill(); await c.sleep(450);
    await c.startCapture({ styleProbes: [{ sel: '#fx', prop: 'backgroundSize' }], editorWatch: [{ sel: 'fieldset[aria-label="Image fit"]', prop: 'disabled' }] });
    const seq = [['Fit', 'contain'], ['Fill', 'cover'], ['Fit', 'contain'], ['Fill', 'cover'], ['Fit', 'contain'], ['Fill', 'cover'], ['Fit', 'contain'], ['Fill', 'cover']];
    const start = c.nowE() + 200;
    for (let i = 0; i < seq.length; i++) {
      await c.sleepUntil(start + i * gap);
      const b = await fit.locator(`button[title="${seq[i][0]}"]`).boundingBox(); const t0 = c.nowE();
      await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      c.mark('click', { i, n: 'fx', label: seq[i][0], expect: seq[i][1], t0, t1: c.nowE() });
    }
    await c.finish(o);
  },
  // S6: type into image 1, within 300 ms select image 2 and click Fit in its image-fill popover (useImageFill flushes pending source writes): does image 1 change again?
  async S6(c, delay, o) {
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500);
    await c.startCapture({ styleProbes: [{ sel: `img[alt="Probe image ${IMG2}"]`, prop: 'objectFit' }] });
    const k1 = await c.typeW(IMG1, TEXT1, delay);
    const gap = 300 - (c.nowE() - k1.at(-1).t1); if (gap > 0) await c.sleep(gap);
    c.mark('switch-begin');
    const ok = await c.selectImage(IMG2); c.mark('switch-done', { ok });
    if (!ok) throw new Error('image 2 not selected');
    const fit = await c.openFill();
    const t0 = c.nowE(); await c.clickBoxOf(fit.locator('button[title="Fit"]'));
    c.mark('click', { i: 0, n: IMG2, label: 'Fit', expect: 'contain', t0, t1: c.nowE() });
    await c.finish(o);
  },
  // S7: type 300 into the W of a Fill image, Cmd-Z 1 s after the last digit. Design end state: the pre-edit class (one typed number = one undo step: P2). Today a number is 3 undo steps.
  async S7(c, delay, o) {
    c.run.wantRows = true;
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture(); await c.markInitial([IMG1]);
    const { keys } = await c.typeKeys(IMG1, c.digits(TEXT1), delay);
    await c.sleepUntil(keys.at(-1).t1 + 1000 - 12); // the focus change and the key itself take a few ms: Cmd-Z lands at +1000
    await c.undo(1, IMG1, 'initial');
    c.mark('burst-end', { final: { [IMG1]: null } });
    await c.finish(o, true);
  },
  // S7b: three class edits, each made while the earlier rows are still unlanded (inside the 5 s window): image 1 `3` (a FIRST edit of that element: its undo goes through the overlay-restore
  // path), image 1 `5`, image 2 `7` (also a first edit); then Cmd-Z three times at +1 s intervals. Expected: image 2 pre-edit, image 1 back to `w-[3px]`, image 1 pre-edit. Odd digits on purpose:
  // the size field maps 2 to w-0.5 and 4 to w-1 (Tailwind scale) but 3, 5, 7 stay arbitrary w-[Npx] values the undo targets can name.
  async S7b(c, delay, o) {
    c.run.wantRows = true;
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture(); await c.markInitial([IMG1, IMG2]);
    await c.typeKeys(IMG1, [{ key: '3', expect: 3 }], delay, { replace: true }); await c.sleep(600);
    await c.typeKeys(IMG1, [{ key: '5', expect: 5 }], delay, { replace: true }); await c.sleep(400);
    if (!await c.selectImage(IMG2)) throw new Error('image 2 not selected');
    const { keys } = await c.typeKeys(IMG2, [{ key: '7', expect: 7 }], delay, { replace: true });
    await c.sleepUntil(keys.at(-1).t1 + 1000 - 12);
    const u1 = await c.undo(1, IMG2, 'initial');
    await c.sleepUntil(u1.t0 + 1000 - 12);
    const u2 = await c.undo(2, IMG1, { has: ['w-[3px]'], not: ['w-[5px]'] });
    await c.sleepUntil(u2.t0 + 1000 - 12);
    await c.undo(3, IMG1, 'initial');
    c.mark('burst-end', { final: { [IMG1]: null, [IMG2]: null } });
    await c.finish(o, true);
  },
  // S8: revisit. (a) image 1, one field: 3, 30, then Backspace back to 3 (three keystroke commits today); (b) image 2, three gestures setting W 100, 150, 100 (typed value + Enter, 300 ms apart).
  async S8(c, delay, o) {
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(IMG1)) throw new Error('image 1 not selected');
    await c.sleep(500); await c.startCapture(); await c.markInitial([IMG1, IMG2]);
    await c.typeKeys(IMG1, [{ key: '3', expect: 3 }, { key: '0', expect: 30 }, { key: 'Backspace', expect: 3 }], delay, { replace: true });
    await c.sleep(300);
    if (!await c.selectImage(IMG2)) throw new Error('image 2 not selected');
    for (const v of ['100', '150', '100']) { await c.typeKeys(IMG2, [...c.digits(v), { key: 'Enter', expect: null }], delay, { replace: true }); await c.sleep(300); }
    await c.finish(o, true);
  },
  // S10: V2 (a component ROOT, `<Photo>`) then V3 (an INNER element of a component, `<Card>`) edited from the page, S2's cadence; row kinds of the journal are recorded. The images are picked by the
  // component tag of their alt-tagged usage in the page (Photo = V2, Card = V3), else --img1 / --img2 (compbig has no Card: V2 twice; tiny and big: V1).
  async S10(c, delay, o) {
    c.run.wantRows = true;
    const txt = await fs.readFile(c.pageFile, 'utf8');
    const variantOf = n => variantIn(txt, n);
    const pick = (variant, dflt) => { for (let n = 1; n <= nImages; n++) if (variantOf(n) === variant) return n; return dflt; };
    const a = pick('V2', IMG1); const b = pick('V3', IMG2); // no Card in the page: --img2 (V2 on compbig, V1 on tiny and big)
    c.run.variants = { [a]: variantOf(a), [b]: variantOf(b) };
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(a)) throw new Error(`image ${a} not selected`);
    await c.sleep(500); await c.startCapture();
    const k1 = await c.typeW(a, TEXT1, delay);
    const gap = 300 - (c.nowE() - k1.at(-1).t1); if (gap > 0) await c.sleep(gap);
    c.mark('switch-begin');
    const ok = await c.selectImage(b); c.mark('switch-done', { ok });
    if (!ok) throw new Error(`image ${b} not selected`);
    await c.typeW(b, TEXT2, delay);
    await c.finish(o, true);
  },
  // S12: type into image A (a plain image: its class rows are deferred 5 s), select image B and open its image-fill popover, then click Fit on B at `clickAt` ms after A's last key, i.e. while A's
  // deferred rows replay (+5.0..6.5 s). Both images' class timelines are recorded.
  async S12(c, clickAt, o) {
    const txt = await fs.readFile(c.pageFile, 'utf8'); const plain = []; for (let n = 1; n <= nImages; n++) if (variantIn(txt, n) === 'V1') plain.push(n);
    const A = plain.includes(IMG1) ? IMG1 : plain[0] ?? IMG1; const B = plain.includes(IMG2) && IMG2 !== A ? IMG2 : plain.find(n => n !== A) ?? IMG2; // comp2: images 5 and 6, not the component-hosted 1 and 3
    c.run.variants = { [A]: variantIn(txt, A), [B]: variantIn(txt, B) };
    if (ZOOMFIT) await c.zoomFit();
    if (!await c.selectImage(A)) throw new Error('image A not selected');
    await c.sleep(500);
    await c.startCapture({ styleProbes: [{ sel: `img[alt="Probe image ${B}"]`, prop: 'objectFit' }] }); await c.markInitial([A, B]);
    const kA = await c.typeW(A, TEXT1, DELAY); const tA = kA.at(-1).t1;
    await c.sleep(150);
    if (!await c.selectImage(B)) throw new Error('image B not selected');
    await c.sleepUntil(tA + clickAt - 800);
    const fit = await c.openFill(); const button = fit.locator('button[title="Fit"]');
    await c.sleepUntil(tA + clickAt);
    const t0 = c.nowE(); await c.clickBoxOf(button);
    c.mark('click', { i: 0, n: B, label: 'Fit', expect: 'contain', t0, t1: c.nowE(), afterLastKeyA: Math.round(t0 - tA) });
    await c.finish(o, true);
  },
  // S13 / S13H: S1 / S3 with the CPU throttled x4 on both CDP targets (the editor renderer and the canvas iframe); the record of what each target measured is in run.throttle.
  async S13(c, delay, o) { const release = await c.throttleOn(THROTTLE); try { await SCENARIOS.S1(c, delay, o); } finally { await release(); } },
  async S13H(c, interval, o) { const release = await c.throttleOn(THROTTLE); try { await SCENARIOS.S3(c, interval, o); } finally { await release(); } },
};
const FRESH_SESSION = new Set(['S7', 'S7b']); // the first-edit undo path needs an editor session that has not edited these elements yet
/** The kind of element an alt-tagged usage of probe image `n` is in the page source: V1 plain <img>, V2 <Photo> (component ROOT), V3 <Card> (INNER element of a component), null if absent. */
const variantIn = (txt, n) => { const m = new RegExp(`<([A-Za-z][\\w.]*)\\b[^>]*?alt="Probe image ${n}"`).exec(txt); return !m ? null : m[1] === 'img' ? 'V1' : m[1] === 'Photo' ? 'V2' : m[1] === 'Card' ? 'V3' : `V?${m[1]}`; };

// ---------------------------------------------------------------- main
const results = []; const cells = [];
// a stopped gate (timeout, Ctrl-C) closes the app and removes the temp dir instead of leaving an Electron and its Astro children behind
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {}); process.exit(sig === 'SIGINT' ? 130 : 143); });
const doItem = async it => {
  if (it.scn === 'REOPEN') { await reopen(); console.log(`[run2] reopened (${Math.round(proj.bootMs)} ms)`); return true; }
  if (it.scn === 'DRAIN') { console.log('[run2] drain', JSON.stringify(await drain())); return true; }
  if (it.scn === 'STAT') { console.log('[run2] stat', JSON.stringify(await journalStats())); return true; }
  if (it.scn === 'GROW') { const g = await growTo(it.reps, it.param); console.log('[run2] grown', JSON.stringify(g)); return true; }
  if (it.scn === 'CELL') {
    if (!proj) await openFresh(`${label} cell`);
    const g = await growTo(it.param, +arg('growinterval', 80));
    const dirty = g.loops > 0 || cells.length > 0;
    if (dirty) { await reopen(); await sleep(1500); }
    const st = await journalStats();
    console.log(`[run2] CELL J=${it.param}: grown ${JSON.stringify(g)}; opened at ${JSON.stringify(st)}`);
    const cellRuns = [];
    for (const m of measureItems) for (let rep = 1; rep <= m.reps; rep++) cellRuns.push(await runOnce(m.scn, m.param, rep, { tag: `J${String(it.param).padStart(4, '0')}-`, cell: it.param, jStart: (await journalStats()).accepted }));
    // stop rule on lane SERVICE time (total - queue wait): a held-key backlog inflates the queue, not the lane
    const acc = cellRuns.flatMap(r => (r.analysis?.acceptSeries ?? []).map(x => x[0] - (x[8] ?? 0))); const p50 = q(acc, 0.5);
    cells.push({ cell: it.param, service: { n: acc.length, p50, p95: q(acc, 0.95) }, accept: { p50: q(cellRuns.flatMap(r => (r.analysis?.acceptSeries ?? []).map(x => x[0])), 0.5) }, runs: cellRuns.length });
    console.log(`[run2] CELL J=${it.param} done: lane service p50 ${p50} p95 ${q(acc, 0.95)} (n ${acc.length})`);
    results.push(...cellRuns);
    if (p50 != null && p50 > MAX_ACCEPT) { console.log(`[run2] STOP: lane service p50 ${p50} ms > ${MAX_ACCEPT} ms at J=${it.param}`); return false; }
    return true;
  }
  for (let rep = 1; rep <= it.reps; rep++) results.push(await runOnce(it.scn, it.param, rep));
  return true;
};
try { for (const it of items) { if (!(await doItem(it))) break; } }
catch (e) { console.log('[run2] FATAL', String(e.stack ?? e).slice(0, 1500)); await page.screenshot({ path: path.join(out, 'fatal.png') }).catch(() => {}); }
finally {
  await fs.writeFile(path.join(out, `${label}-cells.json`), JSON.stringify(cells)).catch(() => {});
  // isolation evidence over the WHOLE launch (a run JSON only holds its capture window): lines that name the owner's relay (:47821) or dev editor (:3061)
  const leakLines = [...H.consoleLog.map(c => `${c.text} ${c.where}`), ...H.mainLog].filter(l => /:47821\b|:3061\b/.test(l));
  await fs.writeFile(path.join(out, `${label}-isolation.json`), JSON.stringify({ leaks: leakLines.length, lines: leakLines.slice(0, 5), consoleLines: H.consoleLog.length, mainLines: H.mainLog.length })).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
console.log('[run2] done', results.length, 'runs');
