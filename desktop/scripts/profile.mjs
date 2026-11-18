// Performance climb: drive the real app through a fixed journey, record a Chrome
// trace per step (editor + preview renderers, CPU samples), rank hotspots.
//   node scripts/profile.mjs [<packaged executable>] [outDir]      (journeys: scripts/journeys.mjs)
// No executable = unpacked app + dev editor on :3061 (start it first).
// Output: <outDir>/<step>.json (raw trace, open in DevTools → Performance → Load)
//         <outDir>/report.md + report.json (wall times, per-process CPU time + breakdown, top functions).
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpuTimes, cpuDelta } from './cpu-times.mjs';
const { journeys } = await import(process.env.SQ_JOURNEYS_FILE ? pathToFileURL(path.resolve(process.env.SQ_JOURNEYS_FILE)).href : './journeys.mjs');

const [exe, outArg] = process.argv.slice(2);
const only = process.env.SQ_JOURNEYS?.split(','); // run just these (setup-only for the rest)
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(outArg ?? path.join(root, 'perf', new Date().toISOString().replace(/[:.]/g, '-')));
const fixture = path.resolve(process.env.SQ_FIXTURE ?? path.join(root, '../app/e2e/fixtures/release-project'));
const BOOT = 180_000;
const now = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const preview = page => page.locator('iframe[title$=" preview"]:visible').first().contentFrame();
const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'loading', 'toplevel', 'v8', 'blink'];

let phasesOf = async () => [];
let r0 = {};
const stepWindows = [];
let eventsOf = async () => [];
// Per-process CPU time around each step (scripts/cpu-times.mjs): ps + the windows' frame → renderer pids.
const cpuNow = async () => cpuTimes(execFileSync('ps', ['-axo', 'pid=,ppid=,time=,command='], { maxBuffer: 1 << 26 }).toString(), app.process().pid,
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap(w => w.webContents.mainFrame.framesInSubtree.map(f => [f.osProcessId, f.url]))).catch(() => []));
const CPU = ['main', 'editor', 'preview', 'gpu', 'astro']; // the report's columns (report.json keeps every label)
const cpuCols = r => r.cpu ? CPU.map(k => r.cpu[k] ?? 0).join('/') : '-';

async function trace(cdp, name, work) {
  if (process.env.SQ_NO_TRACE) { // timing + IPC + CPU only (e.g. to test whether a failure needs the tracer)
    const c0 = await cpuNow(); const t0 = now(), wall0 = Date.now(); let error = null;
    try { await work(); } catch (e) { error = String(e.message ?? e).split('\n')[0]; }
    const wallMs = Math.round(now() - t0); const cpu = cpuDelta(c0, await cpuNow()); stepWindows.push({ name, wall0, end: wall0 + wallMs });
    return { name, wallMs, error, cpu, inp: '-', phases: [], processes: {}, longTasks: [], longTaskCount: 0, topSelf: [], ipcCalls: 0, ipcTop: [] };
  }
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: CATEGORIES } });
  const c0 = await cpuNow(); const t0 = now(); const wall0 = Date.now(); let error = null;
  try { await work(); } catch (e) { error = String(e.message ?? e).split('\n')[0]; }
  const wallMs = Math.round(now() - t0); const cpu = cpuDelta(c0, await cpuNow()); // before Tracing.end: the flush is not the step's
  const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  const { stream } = await done; let data = '';
  for (;;) { const c = await cdp.send('IO.read', { handle: stream }); data += c.base64Encoded ? Buffer.from(c.data, 'base64').toString() : c.data; if (c.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  await fs.writeFile(path.join(out, `${name}.json`), data);
  const evs = (await eventsOf()).filter(e => e.t >= wall0);
  const worst = evs.sort((a, b) => b.d - a.d)[0];
  const inp = worst ? `${worst.d} ms ${worst.name}${worst.frame ? ' (preview)' : ''}` : '-';
  const phases = (await phasesOf()).filter(p => p.t >= wall0).map(p => `${p.phase}@${p.t - wall0}`);
  stepWindows.push({ name, wall0, end: wall0 + wallMs });
  const calls = ipc.filter(c => c.at >= wall0 && c.at <= wall0 + wallMs + 50); const byRoute = new Map();
  for (const c of calls) { const k = c.route || c.name; const v = byRoute.get(k) ?? { n: 0, ms: 0 }; v.n++; v.ms += c.ms; byRoute.set(k, v); }
  const ipcTop = [...byRoute].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12).map(([route, v]) => ({ route, ...v }));
  return { name, wallMs, error, cpu, inp, phases, ipcCalls: calls.length, ipcTop, ...analyze(JSON.parse(data)) };
}

/** Per-process main-thread time by kind, long tasks, and self time per JS function. */
const proc = new Map(); // pid → label, kept across steps (a quiet step issues no requests)
function analyze(json) {
  const events = Array.isArray(json) ? json : json.traceEvents;
  const thread = new Map();
  for (const e of events) {
    if (e.name === 'process_name' && !proc.has(e.pid)) proc.set(e.pid, e.args.name);
    if (e.name === 'process_labels' && !/^(editor|preview)$/.test(proc.get(e.pid))) proc.set(e.pid, e.args.labels);
    if (e.name === 'thread_name') thread.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  for (const e of events) {
    const url = e.name === 'ResourceSendRequest' ? e.args?.data?.url : null;
    if (!url || /^(editor|preview)$/.test(proc.get(e.pid))) continue;
    if (url.startsWith('http://127.0.0.1:') && !url.startsWith('http://127.0.0.1:3061')) proc.set(e.pid, 'preview');
    else if (url.startsWith('starquix://') || url.startsWith('http://127.0.0.1:3061')) proc.set(e.pid, 'editor');
  }
  const KIND = { FunctionCall: 'script', EvaluateScript: 'script', TimerFire: 'script', EventDispatch: 'script', 'v8.compile': 'compile',
    'v8.compileModule': 'compile', V8_Compile: 'compile', RunMicrotasks: 'script', FireAnimationFrame: 'script', ParseHTML: 'parse',
    UpdateLayoutTree: 'style', Layout: 'layout', PrePaint: 'paint', Paint: 'paint', Layerize: 'paint', MinorGC: 'gc', MajorGC: 'gc', 'V8.GC_SCAVENGER': 'gc' };
  const byProc = {}; const longTasks = [];
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur || thread.get(`${e.pid}:${e.tid}`) !== 'CrRendererMain') continue;
    const label = proc.get(e.pid) ?? `pid ${e.pid}`;
    const p = byProc[label] ??= { busyMs: 0, script: 0, compile: 0, parse: 0, style: 0, layout: 0, paint: 0, gc: 0 };
    if (e.name === 'RunTask') { // top-level task (ThreadControllerImpl::RunTask wraps the same span)
      p.busyMs += e.dur / 1000;
      if (e.dur > 50_000) longTasks.push({ proc: label, ms: Math.round(e.dur / 1000) });
    }
    const k = KIND[e.name]; if (k) p[k] += e.dur / 1000;
  }
  for (const p of Object.values(byProc)) for (const k in p) p[k] = Math.round(p[k]);
  // Off-main-thread rendering: compositor, raster workers, GPU/Viz (zoom/pan cost lives here).
  const threads = {};
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur || e.name !== 'ThreadControllerImpl::RunTask' && e.name !== 'RunTask') continue;
    const t = thread.get(`${e.pid}:${e.tid}`) ?? ''; if (t === 'CrRendererMain' || !/Compositor|Tile|Viz|Gpu|Raster/i.test(t)) continue;
    const key = `${proc.get(e.pid) ?? e.pid}:${t.replace(/\d+$/, '')}`;
    threads[key] = (threads[key] ?? 0) + e.dur / 1000;
  }
  for (const k in threads) threads[k] = Math.round(threads[k]);
  // CPU samples: ProfileChunk nodes + samples + timeDeltas → self ms per function.
  const nodes = new Map(); const self = new Map();
  for (const e of events) {
    if (e.name !== 'ProfileChunk') continue;
    const c = e.args?.data?.cpuProfile; const deltas = e.args?.data?.timeDeltas ?? [];
    for (const n of c?.nodes ?? []) nodes.set(`${e.pid}:${e.id}:${n.id}`, { ...n.callFrame, pid: e.pid });
    (c?.samples ?? []).forEach((id, i) => {
      const f = nodes.get(`${e.pid}:${e.id}:${id}`); if (!f) return;
      const where = f.url ? `${f.url.replace(/^.*\//, '').replace(/\?.*$/, '')}:${f.lineNumber + 1}` : '';
      const key = `${f.functionName || '(anonymous)'} ${where} [${proc.get(f.pid) ?? f.pid}]`;
      self.set(key, (self.get(key) ?? 0) + (deltas[i] ?? 0) / 1000);
    });
  }
  const top = [...self].filter(([k]) => !/^\((idle|program)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([fn, ms]) => ({ fn, ms: Math.round(ms) }));
  longTasks.sort((a, b) => b.ms - a.ms);
  return { threads, processes: byProc, longTasks: longTasks.slice(0, 8), longTaskCount: longTasks.length, topSelf: top };
}

async function select(page, el) {
  const box = await el.boundingBox();
  await page.keyboard.down('ControlOrMeta');
  try { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); } finally { await page.keyboard.up('ControlOrMeta'); }
}

await fs.mkdir(out, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-profile-'));
const childProf = path.join(out, 'astro-child');
// STARQUIX_MCP_HOME: a run must never repoint the developer's real ~/.starquix-mcp launcher at the profiled app (as e2e/helpers.mjs setupEnv).
const env = { ...process.env, SQ_IPC_LOG: '1', SQ_CPU_PROF: childProf, SQ_USER_DATA: path.join(temp, 'profile'), SQ_PROJECTS_ROOT: path.join(temp, 'projects'), SQ_DOWNLOADS: path.join(temp, 'downloads'),
  STARQUIX_MCP_HOME: path.join(temp, 'mcp-home') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch(exe ? { executablePath: exe, env } : { args: [root], env });
const results = [];
const consoleLog = []; // SQ_CONSOLE=1: the editor's console → <out>/console.log (debug aid)
const ipc = []; let buf = '';
app.process().stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop();
  for (const l of lines) if (l.startsWith('[sq-ipc] ')) ipc.push(JSON.parse(l.slice(9))); });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
  const cdp = await page.context().newCDPSession(page);
  if (process.env.SQ_CONSOLE) page.on('console', m => consoleLog.push(`[${Date.now()}] [${m.type()}] ${m.text()}`));
  // Instance phases (main → preload onState) with wall-clock stamps, across reloads.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => window.sqDesktop?.onState(s => {
      const log = JSON.parse(sessionStorage.getItem('sqPhases') ?? '[]'); log.push({ phase: s.phase, t: Date.now() });
      sessionStorage.setItem('sqPhases', JSON.stringify(log));
    }), { once: true });
    window.addEventListener('sq:canvas-revealed', () => {
      const log = JSON.parse(sessionStorage.getItem('sqPhases') ?? '[]'); log.push({ phase: 'revealed', t: Date.now() });
      sessionStorage.setItem('sqPhases', JSON.stringify(log));
    });
  });
  // Event Timing (INP's source): input → handlers → next paint, per document (editor + preview frame).
  await page.addInitScript(() => {
    window.__sqEvents = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__sqEvents.push({ name: e.name, d: Math.round(e.duration), t: performance.timeOrigin + e.startTime }); })
      .observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
  });
  await page.reload(); await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60_000 });
  eventsOf = async () => [
    ...await page.evaluate(() => window.__sqEvents ?? []).catch(() => []),
    ...(await Promise.all(page.frames().slice(1).map(f => f.evaluate(() => window.__sqEvents ?? []).catch(() => [])))).flat().map(e => ({ ...e, frame: true })),
  ];
  phasesOf = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('sqPhases') ?? '[]')).catch(() => []);
  const heading = () => preview(page).getByRole('heading', { name: 'Release fixture', exact: true });
  // Editor frame cadence during the step: rAF intervals (a gesture's smoothness, not one input).
  const framesStart = () => page.evaluate(() => { const f = window.__sqFrames = { t: [], on: true };
    const tick = ts => { if (!f.on) return; f.t.push(ts); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }).catch(() => {});
  const framesStop = () => page.evaluate(() => { const f = window.__sqFrames; if (!f) return null; f.on = false;
    const d = f.t.slice(1).map((t, i) => t - f.t[i]).sort((a, b) => a - b); if (!d.length) return null;
    const q = p => Math.round(d[Math.min(d.length - 1, Math.floor(d.length * p))]);
    return { n: d.length, p50: q(0.5), p95: q(0.95), max: Math.round(d.at(-1)), over34: d.filter(x => x > 34).length }; }).catch(() => null);
  const step = async (name, work) => { const r = await trace(cdp, name, async () => { await framesStart(); try { await work(); } finally { r0.frames = await framesStop(); } }); Object.assign(r, r0); r0 = {}; results.push(r); console.error(`[profile] ${name} ${r.wallMs} ms, cpu ${CPU.join('/')} ${cpuCols(r)} ms${r.error ? ' ERROR ' + r.error : ''}`); };

  const ctx = { page, cdp, preview: () => preview(page), select: el => select(page, el), sleep, fixture, BOOT,
    projectDir: () => path.join(temp, 'projects', new URL(page.url()).pathname.split('/').pop()) };
  // A failing hook marks its journey and the run goes on: one broken journey never loses the report.
  const hook = async (name, fn) => { try { await fn?.(ctx); return true; } catch (e) {
    results.push({ name, wallMs: NaN, error: `hook: ${String(e.message ?? e).split('\n')[0]}`, inp: '-', phases: [], processes: {}, longTasks: [], longTaskCount: 0, topSelf: [], ipcCalls: 0, ipcTop: [] });
    console.error(`[profile] ${name} HOOK ERROR ${e.message?.split('\n')[0]}`); return false; } };
  for (const j of journeys) {
    if (page.isClosed()) break;
    if (only && !only.includes(j.name)) { if (!process.env.SQ_NO_SETUP) await hook(j.name, j.setup); continue; }
    if (!await hook(j.name, j.before)) continue;
    await step(j.name, () => j.run(ctx));
    await hook(j.name, j.after);
  }
} finally {
  if (process.env.SQ_CONSOLE) await fs.writeFile(path.join(out, 'console.log'), consoleLog.join('\n')).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(temp, { recursive: true, force: true });
}

// Astro child CPU (one .cpuprofile per child lifetime, written on exit).
const children = [];
for (const f of (await fs.readdir(childProf).catch(() => [])).filter(f => f.endsWith('.cpuprofile'))) {
  const prof = JSON.parse(await fs.readFile(path.join(childProf, f), 'utf8'));
  const byId = new Map(prof.nodes.map(n => [n.id, n.callFrame])); const self = new Map(); let total = 0;
  prof.samples.forEach((id, i) => {
    const c = byId.get(id); const ms = (prof.timeDeltas[i] ?? 0) / 1000;
    if (/^\((idle|program)\)$/.test(c.functionName)) return;
    total += ms;
    const mod = c.url.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? c.url.replace(/^.*\//, '');
    const key = `${c.functionName || '(anonymous)'} ${mod}:${c.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + ms);
  });
  const byModule = new Map();
  for (const [k, ms] of self) { const m = k.split(' ').pop().split(':')[0]; byModule.set(m, (byModule.get(m) ?? 0) + ms); }
  children.push({ file: f, lifetimeMs: Math.round((prof.endTime - prof.startTime) / 1000), cpuMs: Math.round(total),
    topModules: [...byModule].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m, ms]) => ({ m, ms: Math.round(ms) })),
    topSelf: [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([fn, ms]) => ({ fn, ms: Math.round(ms) })) });
}

const md = ['# Profile', '', `executable: ${exe ?? 'unpacked + dev editor'}`, '', `| step | wall ms | worst input→paint | frames p50/p95/max (>34ms) | long tasks | editor busy | preview busy | cpu ms ${CPU.join('/')} | error |`, '|---|---|---|---|---|---|---|---|---|',
  ...results.map(r => `| ${r.name} | ${r.wallMs} | ${r.inp} | ${r.frames ? `${r.frames.p50}/${r.frames.p95}/${r.frames.max} (${r.frames.over34}/${r.frames.n})` : '-'} | ${r.longTaskCount} | ${r.processes.editor?.busyMs ?? '-'} | ${r.processes.preview?.busyMs ?? '-'} | ${cpuCols(r)} | ${r.error ?? ''} |`), '',
  ...results.filter(r => r.phases.length).map(r => `- ${r.name} instance phases (ms from step start): ${r.phases.join(', ')}`), ''];
for (const c of children) {
  md.push(`## Astro child ${c.file} — lived ${c.lifetimeMs} ms, CPU ${c.cpuMs} ms`, '', 'By module:', ...c.topModules.map(t => `- ${t.ms} ms ${t.m}`), '', 'Top self time:', ...c.topSelf.map(t => `- ${t.ms} ms ${t.fn}`), '');
}
for (const r of results) {
  md.push(`## ${r.name} — ${r.wallMs} ms`, '', '| process | busy | script | compile | parse | style | layout | paint | gc |', '|---|---|---|---|---|---|---|---|---|');
  for (const [p, v] of Object.entries(r.processes)) md.push(`| ${p} | ${v.busyMs} | ${v.script} | ${v.compile} | ${v.parse} | ${v.style} | ${v.layout} | ${v.paint} | ${v.gc} |`);
  if (r.threads && Object.keys(r.threads).length) md.push('', 'Off-main-thread ms: ' + Object.entries(r.threads).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  if (r.cpu) md.push('', 'CPU ms (ps): ' + Object.entries(r.cpu).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  md.push('', `IPC calls: ${r.ipcCalls}`, ...r.ipcTop.map(t => `- ${t.n}× ${t.route} — ${t.ms} ms total`));
  md.push('', 'Top self time:', ...r.topSelf.map(t => `- ${t.ms} ms ${t.fn}`), '');
}
await fs.writeFile(path.join(out, 'ipc.json'), JSON.stringify({ steps: stepWindows, calls: ipc }));
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ steps: results, children }, null, 2));
await fs.writeFile(path.join(out, 'report.md'), md.join('\n'));
console.log(path.join(out, 'report.md'));
