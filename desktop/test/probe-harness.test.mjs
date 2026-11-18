// desktop/probe (the runtime probe harness): its isolation guarantees and its pure/IO parts. The Electron runs themselves are the gates
// (probe/gate.mjs); everything that can be proven without launching the app is proven here.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMcpHost } from '../src/agents.mjs';
import { decodePairingCode } from '../../mcp/src/protocol.ts';
import { assertIsolated, probeEnv, writeRelayIdentity } from '../probe/driver.mjs';
import { bundleHash, ensureBundle, serveBundle } from '../probe/bundle.mjs';
import { resolveFixtures } from '../probe/fixtures.mjs';

const probeDir = path.resolve(import.meta.dirname, '../probe');
const roots = [];
const tmp = async (prefix = 'sq-probe-') => { const p = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(p); return p; };
const exists = p => fs.access(p).then(() => true, () => false);
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });

// ---------------------------------------------------------------- isolation: a probe never touches the owner's app, data, dev editor or relay
const EDITOR = 'http://localhost:41234/';
const KEYS = ['SQ_USER_DATA', 'SQ_PROJECTS_ROOT', 'SQ_DOWNLOADS', 'STARQUIX_MCP_HOME'];

it('a probe launch keeps everything the app writes under its own temp dir', async () => {
  const temp = await tmp();
  const env = probeEnv({ temp, editorUrl: EDITOR, base: { HOME: '/x', ELECTRON_RUN_AS_NODE: '1', SQ_PROBE_INVISIBLE: '0' } });
  for (const key of KEYS) expect(path.relative(temp, env[key]).startsWith('..'), key).toBe(false);
  expect(env).toMatchObject({ HOME: '/x', SQ_UPDATE_FEED: 'off', SQ_EDITOR_URL: EDITOR, SQ_PROBE_INVISIBLE: '1', SQ_DEV_EDITOR_LOCALHOST: '1', SQ_IPC_LOG: '1' });
  expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
});

it('a visible launch on a 127.0.0.1 editor sets neither probe switch, whatever the caller inherited', async () => {
  const env = probeEnv({ temp: await tmp(), editorUrl: 'http://127.0.0.1:41234/', hide: false, ipcLog: false, base: { SQ_PROBE_INVISIBLE: '1', SQ_DEV_EDITOR_LOCALHOST: '1', SQ_IPC_LOG: '1' } });
  expect(env.SQ_PROBE_INVISIBLE).toBeUndefined();
  expect(env.SQ_DEV_EDITOR_LOCALHOST).toBeUndefined();
  expect(env.SQ_IPC_LOG).toBeUndefined();
});

it('pre-writes a relay identity on a free port, and the real MCP host adopts it instead of the owner relay 47821', async () => {
  const temp = await tmp();
  const { wsPort, token } = await writeRelayIdentity(temp);
  const mcpHome = path.join(temp, 'mcp-home'); const file = path.join(mcpHome, 'daemon.json');
  expect(wsPort).not.toBe(47821);
  expect(wsPort).toBeGreaterThan(1024);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ token, wsPort, controlPort: 0 });
  if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  const host = createMcpHost({ relayHome: mcpHome, execPath: '/App/Starquix', script: '/App/mcp/starquix-mcp.mjs', platform: 'darwin' });
  expect(decodePairingCode(host.code())).toEqual({ port: wsPort, token }); // the code the editor dials
  expect(JSON.parse(await fs.readFile(file, 'utf8')).wsPort).toBe(wsPort); // and nothing was rewritten to the default
  await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(wsPort, '127.0.0.1', () => s.close(resolve)); }); // the port was left free
});

it('assertIsolated passes a clean launch and refuses every way a launch could reach the owner\'s app', async () => {
  const temp = await tmp(); const { wsPort } = await writeRelayIdentity(temp);
  const env = probeEnv({ temp, editorUrl: EDITOR });
  const check = over => assertIsolated({ temp, env, editorUrl: EDITOR, wsPort, home: '/Users/owner', ...over });
  expect(() => check({})).not.toThrow();
  for (const key of KEYS) {
    expect(() => check({ env: { ...env, [key]: '/Users/owner/Starquix' } }), key).toThrow(/not inside/);
    expect(() => check({ env: { ...env, [key]: undefined } }), `${key} unset`).toThrow(/not inside/);
  }
  expect(() => check({ editorUrl: 'http://127.0.0.1:3061/' })).toThrow(/3061/);
  expect(() => check({ editorUrl: 'https://example.com:3000/' })).toThrow(/editor/);
  expect(() => check({ editorUrl: 'http://localhost/' })).toThrow(/editor/);
  expect(() => check({ wsPort: 47821 })).toThrow(/47821/);
  expect(() => check({ wsPort: wsPort + 1 })).toThrow(/daemon\.json/);
  for (const bad of ['/Users/owner', '/Users/owner/Starquix/run', '/Users/owner/.starquix-mcp', '/Users/owner/Library/Application Support/Starquix'])
    expect(() => check({ temp: bad, env: probeEnv({ temp: bad, editorUrl: EDITOR }) }), bad).toThrow(/owner/);
});

// ---------------------------------------------------------------- the production editor bundle: keyed by its sources, served like the packaged app
async function fakeApp() {
  const root = await tmp('sq-app-'); const app = path.join(root, 'app');
  await fs.mkdir(path.join(app, 'src/__tests__'), { recursive: true });
  await fs.mkdir(path.join(app, 'public'), { recursive: true });
  const files = { 'src/main.tsx': 'export {}', 'src/__tests__/a.test.ts': 'test', 'src/b.test.tsx': 'test', 'src/c.spec.ts': 'test', 'index.html': '<html></html>', 'package.json': '{"name":"app"}', 'vite.config.ts': 'export default {}', 'public/astro-snapshot.json': '{"version":"1"}' };
  for (const [rel, text] of Object.entries(files)) await fs.writeFile(path.join(app, rel), text);
  const lock = path.join(root, 'package-lock.json'); await fs.writeFile(lock, '{}');
  return { app, lock };
}

it('keys the bundle by every source it is built from, and by nothing it is not', async () => {
  const { app, lock } = await fakeApp();
  const hash = async () => (await bundleHash({ appDir: app, lockFile: lock })).hash;
  const base = await hash();
  expect(base).toMatch(/^[0-9a-f]{16}$/);
  expect(await hash()).toBe(base);
  for (const test of ['src/__tests__/a.test.ts', 'src/b.test.tsx', 'src/c.spec.ts']) await fs.writeFile(path.join(app, test), 'edited');
  expect(await hash(), 'tests are not in the bundle').toBe(base);
  const seen = new Set([base]);
  for (const [file, text] of [[path.join(app, 'src/main.tsx'), 'export const x = 1'], [path.join(app, 'index.html'), '<html>v2</html>'], [path.join(app, 'package.json'), '{"name":"app","v":2}'],
    [lock, '{"v":2}'], [path.join(app, 'src/new.ts'), 'export {}'], [path.join(app, 'vite.config.ts'), 'export default { base: "/" }'], [path.join(app, 'public/astro-snapshot.json'), '{"version":"2"}']]) {
    await fs.writeFile(file, text);
    const now = await hash();
    expect(seen.has(now), file).toBe(false);
    seen.add(now);
  }
  await fs.rename(path.join(app, 'src/new.ts'), path.join(app, 'src/renamed.ts'));
  expect(seen.has(await hash()), 'a rename').toBe(false);
});

it('builds a bundle once per hash: reuse while it holds, rebuild after a source change or an interrupted build, prune old ones, refuse an empty build', async () => {
  const { app, lock } = await fakeApp(); const cacheRoot = await tmp('sq-cache-');
  const built = [];
  const build = async ({ outDir }) => { built.push(outDir); await fs.mkdir(outDir, { recursive: true }); await fs.writeFile(path.join(outDir, 'index.html'), '<html></html>'); };
  const ensure = (over = {}) => ensureBundle({ appDir: app, lockFile: lock, cacheRoot, build, ...over });
  const a = await ensure();
  expect(a).toMatchObject({ built: true });
  expect(await exists(path.join(a.dir, 'index.html'))).toBe(true);
  expect(await ensure()).toMatchObject({ built: false, dir: a.dir, hash: a.hash });
  expect(built).toHaveLength(1);
  await fs.writeFile(path.join(app, 'src/main.tsx'), 'export const x = 1');
  const b = await ensure({ keep: 2 });
  expect(b).toMatchObject({ built: true });
  expect(b.hash).not.toBe(a.hash);
  await fs.rm(path.join(b.dir, '.sq-probe-bundle.json'));
  expect(await ensure({ keep: 2 }), 'a bundle without its completion marker is never reused').toMatchObject({ built: true, hash: b.hash });
  await fs.writeFile(path.join(app, 'src/main.tsx'), 'export const x = 2');
  const c = await ensure({ keep: 2 });
  expect((await fs.readdir(cacheRoot)).sort(), 'keeps the newest two').toEqual([b.hash, c.hash].sort());
  await fs.writeFile(path.join(app, 'src/main.tsx'), 'export const x = 3');
  await expect(ensure({ build: async () => {} })).rejects.toThrow(/index\.html/);
});

it('serves the built editor like the packaged app: SPA routes, MIME types, nothing outside the bundle', async () => {
  const dir = await tmp('sq-served-');
  await fs.mkdir(path.join(dir, 'assets'));
  for (const [rel, text] of Object.entries({ 'index.html': '<!doctype html><title>editor</title>', 'assets/x.js': 'export {}', 'assets/a.css': 'a{}', 'assets/engine.wasm': 'wasm' })) await fs.writeFile(path.join(dir, rel), text);
  await fs.writeFile(path.join(path.dirname(dir), 'sq-probe-secret.txt'), 'secret'); roots.push(path.join(path.dirname(dir), 'sq-probe-secret.txt'));
  const server = await serveBundle(dir);
  try {
    expect(server.port).not.toBe(3061);
    expect(server.url, 'another SITE than the 127.0.0.1 canvas: its own renderer process, like starquix://app').toBe(`http://localhost:${server.port}/`);
    const get = p => fetch(`http://127.0.0.1:${server.port}${p}`);
    for (const route of ['/', '/editor/browser_1', '/projects']) { const r = await get(route); expect(r.status, route).toBe(200); expect(await r.text()).toContain('<title>editor</title>'); }
    expect((await get('/')).headers.get('content-type')).toMatch(/^text\/html/);
    expect((await get('/assets/x.js')).headers.get('content-type')).toMatch(/javascript/);
    expect((await get('/assets/a.css')).headers.get('content-type')).toMatch(/^text\/css/);
    expect((await get('/assets/engine.wasm')).headers.get('content-type')).toBe('application/wasm');
    for (const miss of ['/assets/missing.js', '/%2e%2e/sq-probe-secret.txt', '/assets/..%2f..%2fsq-probe-secret.txt']) expect((await get(miss)).status, miss).toBe(404);
  } finally { await server.close(); }
  await expect(fetch(`http://127.0.0.1:${server.port}/`)).rejects.toThrow();
});

// ---------------------------------------------------------------- fixtures: generated ones are built when missing, the owner copy is private
const fakeRun = calls => async (script, args) => {
  calls.push([path.basename(script), ...args]);
  const name = path.basename(script);
  const make = async (root, ...names) => { for (const n of names) { await fs.mkdir(path.join(root, n), { recursive: true }); await fs.writeFile(path.join(root, n, 'package.json'), '{}'); } };
  if (name === 'make-fixtures.mjs') await make(args[0], 'tiny', 'big', 'huge', 'bigpage');
  else if (name === 'make-comp-fixture.mjs') await make(args[0], args[1] ?? 'comp');
  else if (name === 'make-compbig-fixture.mjs') await make(args[0], 'compbig');
  else if (name === 'prep-owner-copy.mjs') await make(path.dirname(args[1]), path.basename(args[1]));
};

it('builds only the generated fixtures that are missing and never touches an existing one', async () => {
  const dir = await tmp('sq-fx-'); const calls = [];
  await fs.mkdir(path.join(dir, 'tiny')); await fs.writeFile(path.join(dir, 'tiny/keep.txt'), 'mine');
  const got = await resolveFixtures(['tiny', 'big', 'bigpage'], { fixturesDir: dir, run: fakeRun(calls) });
  expect(Object.keys(got)).toEqual(['tiny', 'big', 'bigpage']);
  expect(got.big.dir).toBe(path.join(dir, 'big'));
  expect(await fs.readFile(path.join(dir, 'tiny/keep.txt'), 'utf8')).toBe('mine');
  expect(await exists(path.join(dir, 'tiny/package.json')), 'tiny stayed as it was').toBe(false);
  expect(await exists(path.join(dir, 'huge')), 'only what was asked for lands in the fixtures dir').toBe(false);
  expect(calls.map(c => c[0])).toContain('make-fixtures.mjs');
  const again = []; await resolveFixtures(['tiny', 'big', 'bigpage'], { fixturesDir: dir, run: fakeRun(again) });
  expect(again, 'nothing missing, nothing built').toEqual([]);
});

it('builds the component fixtures in dependency order', async () => {
  const dir = await tmp('sq-fx-'); const calls = [];
  const got = await resolveFixtures(['comp2', 'compbig'], { fixturesDir: dir, run: fakeRun(calls) });
  expect(got.comp2.dir).toBe(path.join(dir, 'comp2'));
  expect(got.compbig.dir).toBe(path.join(dir, 'compbig'));
  const order = calls.map(c => c[0] + (c[2] ? `:${c[2]}` : ''));
  expect(order.indexOf('make-fixtures.mjs')).toBeLessThan(order.indexOf('make-comp-fixture.mjs:comp2'));
  expect(order.indexOf('make-comp-fixture.mjs:comp2')).toBeLessThan(order.indexOf('make-compbig-fixture.mjs'));
});

it('the owner fixture is private: skipped without an owner copy, prepared from it when asked, never replacing an existing one', async () => {
  const dir = await tmp('sq-fx-'); const copy = await tmp('sq-owner-'); const calls = [];
  expect((await resolveFixtures(['owner'], { fixturesDir: dir, run: fakeRun(calls) })).owner).toEqual({ skipped: expect.stringContaining('--owner-copy') });
  expect(calls).toEqual([]);
  const got = await resolveFixtures(['owner'], { fixturesDir: dir, ownerCopy: copy, ownerPage: 'src/pages/landing.astro', run: fakeRun(calls) });
  expect(calls).toEqual([['prep-owner-copy.mjs', copy, path.join(dir, 'owner'), 'src/pages/landing.astro']]);
  expect(got.owner).toEqual({ dir: path.join(dir, 'owner') });
  const more = []; await resolveFixtures(['owner'], { fixturesDir: dir, ownerCopy: copy, run: fakeRun(more) });
  expect(more, 'an existing owner fixture wins over --owner-copy').toEqual([]);
});

it('refuses a fixture it does not know', async () => {
  await expect(resolveFixtures(['nope'], { fixturesDir: await tmp(), run: fakeRun([]) })).rejects.toThrow(/unknown fixture/);
});

// ---------------------------------------------------------------- the gate CLI (nothing here builds, serves or launches anything)
const gate = (...args) => spawnSync(process.execPath, [path.join(probeDir, 'gate.mjs'), ...args], { encoding: 'utf8', timeout: 90_000 });

it('the gates that are not built yet exit 2 and say so', () => {
  for (const name of ['G-T1a', 'G-T1b', 'G-D']) {
    const r = gate(name);
    expect(r.status, name).toBe(2);
    expect(r.stderr, name).toContain('not implemented yet');
  }
});

it('an unknown gate is a usage error (exit 3) that lists the gates', () => {
  const r = gate('G-nope');
  expect(r.status).toBe(3);
  for (const name of ['smoke', 'G-0', 'G-L1', 'G-L2', 'G-T3', 'V2']) expect(r.stderr).toContain(name);
});

it('--dry-run prints the plan and writes, builds and launches nothing', async () => {
  const fx = await tmp('sq-fx-'); await fs.mkdir(path.join(fx, 'tiny'));
  const r = gate('smoke', '--dry-run', '--fixtures', fx, '--out', path.join(fx, 'out'));
  expect(r.status, r.stderr).toBe(0);
  const plan = JSON.parse(r.stdout);
  expect(plan).toMatchObject({ gate: 'smoke', dryRun: true });
  expect(plan.bundle.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(plan.runs.map(run => run.fixture)).toEqual(['tiny']);
  expect(plan.runs[0].argv).toEqual(expect.arrayContaining(['--plan', 'S1@90*1', '--loadgate', '13']));
  expect(await exists(path.join(fx, 'out'))).toBe(false);
});

it('--dry-run of G-0 plans every journal-depth cell, the owner page arguments, and skips a missing owner fixture instead of passing without it', async () => {
  const fx = await tmp('sq-fx-');
  for (const name of ['tiny', 'big', 'bigpage']) await fs.mkdir(path.join(fx, name));
  const plan = JSON.parse(gate('G-0', '--dry-run', '--fixtures', fx).stdout);
  expect(plan.runs.map(run => run.fixture)).toEqual(['tiny', 'big', 'bigpage']);
  for (const run of plan.runs) expect(run.argv).toEqual(expect.arrayContaining(['--plan', 'CELL@1*1,CELL@100*1,CELL@220*1', '--measure', 'S1@90*3,S3@33*1', '--draincapture', '1']));
  expect(plan.skipped.owner).toContain('--owner-copy');
  await fs.mkdir(path.join(fx, 'owner'));
  const withOwner = JSON.parse(gate('G-0', '--dry-run', '--fixtures', fx).stdout);
  expect(withOwner.runs.find(run => run.fixture === 'owner').argv).toEqual(expect.arrayContaining(['--layers', '1=auto,2=auto,5=auto,6=auto', '--img1', '1'])); // S2/S4 select images 2, 5, 6 through the Layers panel too
});

it('--dry-run of G-T3 plans the scenario list of design 4.3 per fixture: S7b and S8 included, a fresh import per run, 80+ runs, the owner skipped without its private copy', async () => {
  const fx = await tmp('sq-fx-');
  for (const name of ['tiny', 'big', 'huge', 'bigpage', 'comp2', 'compbig']) await fs.mkdir(path.join(fx, name));
  const r = gate('G-T3', '--dry-run', '--fixtures', fx);
  expect(r.status, r.stderr).toBe(0);
  const plan = JSON.parse(r.stdout);
  expect(plan.runs.map(run => run.fixture)).toEqual(['tiny', 'big', 'huge', 'bigpage', 'comp2', 'compbig']);
  expect(plan.skipped.owner).toContain('--owner-copy');
  const argvOf = f => plan.runs.find(run => run.fixture === f).argv;
  const planOf = f => argvOf(f)[argvOf(f).indexOf('--plan') + 1];
  for (const f of ['tiny', 'big', 'bigpage']) { expect(planOf(f), f).toContain('S7b@90*3'); expect(planOf(f), f).toContain('S8@90*3'); expect(argvOf(f), f).toEqual(expect.arrayContaining(['--fresh', '1', '--overlay', '1'])); }
  expect(planOf('tiny')).not.toContain('S4'); expect(planOf('big')).toContain('S4@60*2');
  expect(planOf('comp2')).toBe('S1@90*2,S2@90*2');
  expect(argvOf('comp2')).toEqual(expect.arrayContaining(['--img2', '3', '--text2', '200', '--zoomfit', '1']));
  expect(plan.runs.reduce((t, run) => t + run.plannedRuns, 0)).toBeGreaterThanOrEqual(80);
});

it('--only restricts a gate to some of its fixtures (a quick real run of a slow gate): the others are neither planned nor judged', async () => {
  const fx = await tmp('sq-fx-');
  for (const name of ['tiny', 'comp2', 'compbig']) await fs.mkdir(path.join(fx, name));
  const plan = JSON.parse(gate('G-T3', '--dry-run', '--fixtures', fx, '--only', 'compbig,comp2').stdout);
  expect(plan.runs.map(run => run.fixture)).toEqual(['comp2', 'compbig']);
  expect(plan.skipped).toEqual({});
  const bad = gate('G-T3', '--dry-run', '--fixtures', fx, '--only', 'nope');
  expect(bad.status).toBe(3);
  expect(bad.stderr).toMatch(/--only.*nope/);
});

it('--dry-run of V2 plans compbig S1 x6 plain and x6 under throttle with a fresh import per run', async () => {
  const fx = await tmp('sq-fx-'); await fs.mkdir(path.join(fx, 'compbig'));
  const plan = JSON.parse(gate('V2', '--dry-run', '--fixtures', fx).stdout);
  expect(plan.runs.map(run => [run.fixture, run.plannedRuns])).toEqual([['compbig', 12]]);
  expect(plan.runs[0].argv).toEqual(expect.arrayContaining(['--plan', 'S1@90*6,S13@90*6', '--fresh', '1']));
});

// ---------------------------------------------------------------- the editor marks the analysis reads are still there
it('every probe mark the analysis reads still has a pm() call site in the editor', async () => {
  const wanted = new Set();
  for (const file of ['analyze.mjs', 'metrics.mjs', 'v2probe.mjs']) for (const m of (await fs.readFile(path.join(probeDir, file), 'utf8')).matchAll(/'((?:acc|ps|sc|pci|mat|cls|v2):[a-z-]+|lf)'/g)) wanted.add(m[1]);
  const src = path.resolve(import.meta.dirname, '../../app/src');
  const files = (await fs.readdir(src, { recursive: true })).filter(f => /\.tsx?$/.test(f) && !/(^|[\\/])__tests__[\\/]|\.test\./.test(f));
  const text = (await Promise.all(files.map(f => fs.readFile(path.join(src, f), 'utf8')))).join('\n');
  expect([...wanted].filter(name => !text.includes(`pm('${name}'`))).toEqual([]);
  expect(wanted.size).toBeGreaterThanOrEqual(30);
});

// instant-edit: the Test app pins its editor port; serveBundle without a port still takes a free one.
import fsp from 'node:fs/promises';
import netMod from 'node:net';
import osMod from 'node:os';
import pathMod from 'node:path';
import { serveBundle as serveBundleForPort } from '../probe/bundle.mjs';

it('serveBundle pins the requested port (the Test app keeps one editor origin across launches) and defaults to a free one', async () => {
  const dir = await fsp.mkdtemp(pathMod.join(osMod.tmpdir(), 'sq-serve-'));
  await fsp.writeFile(pathMod.join(dir, 'index.html'), '<!doctype html><title>x</title>');
  const free = await new Promise(resolve => { const s = netMod.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const pinned = await serveBundleForPort(dir, { port: free });
  try {
    expect(pinned.port).toBe(free);
    expect(pinned.url).toBe(`http://localhost:${free}/`);
    expect((await fetch(`http://127.0.0.1:${free}/`)).status).toBe(200);
  } finally { await pinned.close(); }
  const any = await serveBundleForPort(dir);
  try { expect(any.port).toBeGreaterThan(0); } finally { await any.close(); }
  await fsp.rm(dir, { recursive: true, force: true });
});
