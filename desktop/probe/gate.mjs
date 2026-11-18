#!/usr/bin/env node
// One gate of docs/plans/2026-11-17-instant-edit-design.md section 4.3, end to end:
//   node probe/gate.mjs <gate> [--label x] [--out dir] [--fixtures dir] [--owner-copy dir] [--owner-page rel] [--bundle-cache dir] [--loadwait ms] [--only fixture,...] [--dry-run]
// builds the PRODUCTION editor bundle of this worktree (cached by a hash of its sources), serves it on a free loopback port as http://localhost:<port>,
// builds missing fixtures, waits for the machine to settle (1-min load <= loadGate), runs the gate's scenarios with run2.mjs (one isolated invisible
// Electron per fixture), prints the metric vector as JSON and a pass/fail table against gates.json, and exits non-zero on a miss.
// Exit: 0 pass | 1 a check missed (or had no data) | 2 gate not built yet | 3 usage or harness error | 4 incomplete (a fixture skipped, or time checks on a busy machine).
// stdout = the vector + the table; progress and the engine's own log go to stderr. Details: README.md.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleHash, ensureBundle, serveBundle } from './bundle.mjs';
import { evaluateGate, renderTable } from './checks.mjs';
import { resolveFixtures } from './fixtures.mjs';
import { fixtureMetrics, scenarioFixtureMetrics } from './metrics.mjs';
import { v2ReportOfRuns } from './v2probe.mjs';

const here = import.meta.dirname;
const repoRoot = path.resolve(here, '../..');
const log = (...a) => console.error('[gate]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const loads = () => os.loadavg().map(x => Math.round(x * 100) / 100);
const die = (code, message) => { console.error(message); process.exit(code); };

// ---------------------------------------------------------------- arguments and the gate definition
const argv = process.argv.slice(2); const flags = {}; const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) positional.push(a);
  else if (a === '--dry-run') flags.dryRun = true;
  else { flags[a.slice(2)] = argv[++i]; if (flags[a.slice(2)] === undefined) die(3, `${a} needs a value`); }
}
const CONFIG = JSON.parse(await fs.readFile(path.join(here, 'gates.json'), 'utf8'));
const name = positional[0];
if (!name) die(3, `usage: node probe/gate.mjs <gate> [--label x] [--out dir] [--fixtures dir] [--owner-copy dir] [--owner-page rel] [--bundle-cache dir] [--loadwait ms] [--only fixture,...] [--dry-run]\ngates: ${Object.keys(CONFIG.gates).join(', ')}`);
const def = CONFIG.gates[name];
if (!def) die(3, `unknown gate ${name}. Gates: ${Object.keys(CONFIG.gates).join(', ')}`);
if (def.implemented === false) die(2, `gate ${name} is not implemented yet (slice ${def.slice}): ${def.summary}`);

// --only: run (and judge) just some fixtures of the gate, e.g. a quick real pass of a slow gate: node probe/gate.mjs G-T3 --only compbig
const only = flags.only ? flags.only.split(',').filter(Boolean) : null;
if (only && !only.every(f => def.fixtures.includes(f))) die(3, `--only ${flags.only}: gate ${name} runs ${def.fixtures.join(', ')}`);
const gateFixtures = only ? def.fixtures.filter(f => only.includes(f)) : def.fixtures;
const label = flags.label ?? name;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = path.resolve(flags.out ?? path.join(here, 'results', `${name}${flags.label ? `-${flags.label}` : ''}-${stamp}`));
const fixturesDir = path.resolve(flags.fixtures ?? path.join(os.tmpdir(), 'sqprobe-fixtures'));
const loadGate = CONFIG.loadGate; const loadWaitMs = +(flags.loadwait ?? CONFIG.loadWaitMs);
const appDir = path.join(repoRoot, 'app'); const lockFile = path.join(repoRoot, 'package-lock.json');
const cacheRoot = path.resolve(flags['bundle-cache'] ?? path.join(os.tmpdir(), 'sqprobe-bundles'));

const parsePlan = s => (s ?? '').split(',').filter(Boolean).map(x => { const m = /^([A-Z][A-Za-z0-9]*)@(\d+)\*(\d+)$/.exec(x.trim()); if (!m) throw new Error(`bad plan item ${x}`); return { scn: m[1], param: +m[2], reps: +m[3] }; });
/** gates.json `run2` is one entry for every fixture of the gate, or a list of entries naming the fixtures they run on (G-T3: tiny has no 4-image burst). */
const run2For = fixture => { const entry = Array.isArray(def.run2) ? def.run2.find(e => !e.fixtures || e.fixtures.includes(fixture)) : def.run2; if (!entry) throw new Error(`gate ${name} has no run2 entry for fixture ${fixture}`); return entry; };
const NOT_RUNS = ['GROW', 'REOPEN', 'DRAIN', 'STAT'];
/** Runs one cell of the plan holds: a CELL plan measures `measure` in each cell; any other plan is one cell of its own items. */
const plannedPerCell = run2 => parsePlan(run2.plan).some(i => i.scn === 'CELL') ? parsePlan(run2.measure).reduce((s, m) => s + m.reps, 0)
  : parsePlan(run2.plan).filter(i => !NOT_RUNS.includes(i.scn)).reduce((s, i) => s + i.reps, 0);
/** Scenario gates: one cell per `scenario@param` item, with its repetitions. */
const plannedByScenario = run2 => parsePlan(run2.plan).filter(i => !NOT_RUNS.includes(i.scn) && i.scn !== 'CELL').reduce((m, i) => ({ ...m, [`${i.scn}@${i.param}`]: (m[`${i.scn}@${i.param}`] ?? 0) + i.reps }), {});
/** Every run of the entry: a CELL plan runs `measure` once per CELL item. */
const plannedRuns = run2 => parsePlan(run2.plan).some(i => i.scn === 'CELL') ? parsePlan(run2.plan).filter(i => i.scn === 'CELL').length * plannedPerCell(run2) : plannedPerCell(run2);
const run2Argv = (fixture, dir, editor) => { const run2 = run2For(fixture); return ['--editor', editor, '--fixture', dir, '--label', `${label}-${fixture}`, '--out', path.join(out, fixture), '--plan', run2.plan,
  ...(run2.measure ? ['--measure', run2.measure] : []), ...run2.args, ...(CONFIG.fixtures[fixture].args ?? []), '--loadgate', String(loadGate), '--loadwait', String(loadWaitMs)]; };

// ---------------------------------------------------------------- dry run: the plan, nothing built, served, written or launched
async function dryRun() {
  const fixtures = await resolveFixtures(gateFixtures, { fixturesDir, ownerCopy: flags['owner-copy'], ownerPage: flags['owner-page'], dryRun: true });
  const { hash } = await bundleHash({ appDir, lockFile });
  const cached = fsSync.existsSync(path.join(cacheRoot, hash, '.sq-probe-bundle.json'));
  const ready = gateFixtures.filter(f => !fixtures[f].skipped);
  console.log(JSON.stringify({ gate: name, dryRun: true, label, out, fixturesDir, loadGate, bundle: { hash, cached, dir: path.join(cacheRoot, hash) }, fixtures,
    skipped: Object.fromEntries(gateFixtures.filter(f => fixtures[f].skipped).map(f => [f, fixtures[f].skipped])),
    runs: ready.map(fixture => ({ fixture, plannedRuns: plannedRuns(run2For(fixture)), argv: run2Argv(fixture, fixtures[fixture].dir, 'http://localhost:<port>/') })) }, null, 1));
  return 0;
}

// ---------------------------------------------------------------- the run
let child = null; let server = null;
const stop = () => { try { child?.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); void Promise.resolve(server?.close()).finally(() => process.exit(130)); });

function runEngine(argvList, { logFile, timeoutMs }) {
  return new Promise(resolve => {
    const proc = child = spawn(process.execPath, [path.join(here, 'run2.mjs'), ...argvList], { stdio: ['ignore', 'pipe', 'pipe'] });
    const file = fsSync.createWriteStream(logFile);
    for (const stream of [proc.stdout, proc.stderr]) stream.on('data', d => { file.write(d); process.stderr.write(d); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); setTimeout(() => proc.kill('SIGKILL'), 15_000).unref(); }, timeoutMs);
    proc.on('close', (code, signal) => { clearTimeout(timer); file.end(); child = null; resolve({ code, signal, timedOut }); });
    proc.on('error', error => { clearTimeout(timer); file.end(); child = null; resolve({ code: null, signal: null, timedOut, error: String(error) }); });
  });
}

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function readRuns(dir) {
  const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json') && !/-(cells|isolation)\.json$/.test(f)).sort();
  const runs = [];
  for (const f of files) { try { const r = await readJson(path.join(dir, f)); if (r.scn) runs.push(r); } catch (e) { log(`skip ${f}: ${e.message}`); } }
  return runs;
}
const git = (...args) => { try { return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { return null; } };

async function run() {
  const startedAt = new Date().toISOString();
  const load = { gate: loadGate, before: loads() };
  log(`${name}: load ${load.before[0]} (gate ${loadGate}); out ${out}`);
  const bundle = await ensureBundle({ appDir, lockFile, cacheRoot });
  log(bundle.built ? `built the production editor bundle ${bundle.hash} in ${Math.round(bundle.ms / 1000)} s` : `reusing the production editor bundle ${bundle.hash}`);
  server = await serveBundle(bundle.dir);
  log(`serving it at ${server.url}`);
  const fixtures = await resolveFixtures(gateFixtures, { fixturesDir, ownerCopy: flags['owner-copy'], ownerPage: flags['owner-page'] });
  for (const f of gateFixtures) log(fixtures[f].skipped ? `fixture ${f}: SKIPPED (${fixtures[f].skipped})` : `fixture ${f}: ${fixtures[f].dir}`);

  const waitStart = Date.now();
  while (os.loadavg()[0] > loadGate && Date.now() - waitStart < loadWaitMs) { log(`load ${loads()[0]} > ${loadGate}: waiting`); await sleep(10_000); }
  load.waitedMs = Date.now() - waitStart; load.afterWait = loads(); load.gaveUp = os.loadavg()[0] > loadGate;
  if (load.gaveUp) log(`the load never settled to ${loadGate}: time checks will be reported as invalid`);

  await fs.mkdir(out, { recursive: true });
  const vector = { gate: name, label, startedAt, host: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length },
    git: { head: git('rev-parse', '--short', 'HEAD'), dirtyFiles: (git('status', '--porcelain', '--', 'app/src', 'desktop/src', 'preview-template') ?? '').split('\n').filter(Boolean).length },
    bundle: { hash: bundle.hash, built: bundle.built, buildMs: bundle.ms, editor: server.url }, load, fixtures: {}, engine: {} };
  const leaks = []; // per launched fixture: the number of console / main-log lines that named the owner's relay or dev editor port, or null = no evidence
  for (const fixture of gateFixtures) {
    if (fixtures[fixture].skipped) { vector.fixtures[fixture] = { skipped: fixtures[fixture].skipped }; continue; }
    const dir = path.join(out, fixture); await fs.mkdir(dir, { recursive: true });
    log(`${fixture}: run2 ${def.run2.plan}${def.run2.measure ? ` measuring ${def.run2.measure}` : ''}`);
    vector.engine[fixture] = await runEngine(run2Argv(fixture, fixtures[fixture].dir, server.url), { logFile: path.join(dir, 'run.log'), timeoutMs: def.timeoutMs });
    const raw = await readRuns(dir); const entry = run2For(fixture);
    vector.fixtures[fixture] = def.metrics === 'scenario' ? scenarioFixtureMetrics(raw, { planned: plannedByScenario(entry), pages: CONFIG.fixtures[fixture].pages })
      : fixtureMetrics(raw, { planned: plannedPerCell(entry), pages: CONFIG.fixtures[fixture].pages });
    if (def.v2probe) await fs.writeFile(path.join(dir, 'v2-probe.md'), `${v2ReportOfRuns(raw.map(r => [`${r.scn}-p${r.param}-r${r.rep}`, r]))}\n`); // the writer verdict and its log excerpt
    leaks.push(await readJson(path.join(dir, `${label}-${fixture}-isolation.json`)).then(iso => iso.leaks, () => null));
  }
  vector.isolation = { leaks: leaks.includes(null) ? null : leaks.reduce((a, b) => a + b, 0), launches: leaks.length };
  load.after = loads();
  vector.finishedAt = new Date().toISOString();

  const result = evaluateGate({ ...def, name, fixtures: gateFixtures }, vector);
  const table = renderTable(result.rows);
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(vector, null, 1));
  await fs.writeFile(path.join(out, 'report.txt'), `${table}\n`);
  console.log(JSON.stringify(vector, null, 1));
  console.log(`\n${table}\n\nGATE ${name}: ${result.verdict.toUpperCase()} (exit ${result.exitCode}) at load ${load.afterWait[0]} -> ${load.after[0]}; out ${out}`);
  return result.exitCode;
}

try { process.exitCode = flags.dryRun ? await dryRun() : await run(); }
catch (error) { console.error(`[gate] ${name} failed: ${error.stack ?? error}`); process.exitCode = 3; }
finally { await server?.close(); }
