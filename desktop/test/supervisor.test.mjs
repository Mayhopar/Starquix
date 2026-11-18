import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInstance, prepareSpare, closeSpare, currentSparePid, SPARE_REPLENISH_MS, killTree, exitOf } from '../src/supervisor.mjs';
const roots = []; const instances = [];
const templateDir = path.resolve(import.meta.dirname, '../../preview-template');
const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
async function fixture(config = 'export default {}') {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-runtime-')); roots.push(projectDir);
  await fs.mkdir(path.join(projectDir, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(projectDir, 'astro.config.mjs'), config);
  await fs.writeFile(path.join(projectDir, 'src/pages/index.astro'), '<h1>Real child</h1>');
  return projectDir;
}
function start(projectDir, extra = {}) {
  const inst = createInstance({ projectId: path.basename(projectDir), lease: crypto.randomUUID(), projectDir, templateDir, depsDir, ...extra });
  instances.push(inst); return inst;
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map(i => i.stop()));
  await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true })));
});
it('cancels a pending startup and leaves no child or restart timer', async () => {
  const inst = start(await fixture(), { runnerFile: new URL('./fixtures/hung-runner.mjs', import.meta.url), bootMs: 300 });
  const rejected = expect(inst.ready).rejects.toThrow();
  await expect.poll(() => inst.state().pid).not.toBeNull();
  const pid = inst.state().pid;
  await inst.stop(); await rejected;
  expect(inst.state()).toMatchObject({ phase: 'stopped', pid: null });
  expect(alive(pid)).toBe(false);
});
it('cleans up after bounded startup failure', async () => {
  const inst = start(await fixture(), { runnerFile: new URL('./fixtures/hung-runner.mjs', import.meta.url), bootMs: 300 });
  await expect(inst.ready).rejects.toThrow();
  expect(inst.state()).toMatchObject({ phase: 'error', pid: null });
}, 20_000);
it('boots a real page, protects local endpoints and restarts a new PID/generation', async () => {
  const inst = start(await fixture()); const first = await inst.ready;
  expect((await fetch(first.url + '/')).status).toBe(200);
  expect((await fetch(first.url + '/__sq/local/pages')).status).toBe(403);
  expect((await fetch(first.url + '/__sq/desktop-health')).status).toBe(403);
  expect((await inst.request('/__sq/local/pages')).status).toBe(200);
  const old = inst.state(); process.kill(old.pid, 'SIGKILL');
  await expect.poll(() => inst.state().phase === 'running' && inst.state().generation > old.generation, { timeout: 90_000 }).toBe(true);
  expect(inst.state().pid).toBeGreaterThan(0);
  expect(inst.state().pid).not.toBe(old.pid);
  // Same port → same origin: the editor's canvas keeps its frame across the restart (A4/A5).
  expect(inst.state().url).toBe(first.url);
  expect(await (await inst.request('/')).text()).toContain('Real child');
  const last = inst.state().pid; await inst.stop();
  expect(alive(last)).toBe(false);
}, 150_000);
it('a new lease for the same project comes back on its port (the editor reopens after a crash)', async () => {
  const dir = await fixture();
  const first = await start(dir).ready;
  await instances.pop().stop();
  const again = await start(dir).ready;
  expect(again.url).toBe(first.url);
  expect(await (await instances.at(-1).request('/')).text()).toContain('Real child');
}, 150_000);
it('a restart whose port was taken meanwhile comes up on another one', async () => {
  const inst = start(await fixture()); const first = await inst.ready;
  const port = Number(new URL(first.url).port);
  const old = inst.state(); process.kill(old.pid, 'SIGKILL');
  const squatter = net.createServer(); // takes the port the moment the dead child releases it
  const grab = () => new Promise(resolve => { squatter.once('error', () => resolve(false)); squatter.listen(port, '127.0.0.1', () => resolve(true)); });
  await expect.poll(grab, { timeout: 10_000, intervals: [10] }).toBe(true);
  try {
    await expect.poll(() => inst.state().phase === 'running' && inst.state().generation > old.generation, { timeout: 90_000 }).toBe(true);
    expect(inst.state().url).not.toBe(first.url);
    expect(await (await inst.request('/')).text()).toContain('Real child');
  } finally { squatter.close(); }
}, 150_000);
it('boots fallback after a throwing config, preserving the original bytes', async () => {
  const original = 'throw new Error("fixture config failure")';
  const dir = await fixture(original); const inst = start(dir); await inst.ready;
  expect(await (await inst.request('/')).text()).toContain('Real child');
  expect(await fs.readFile(path.join(dir, 'astro.config.mjs'), 'utf8')).toBe(original);
}, 120_000);
it('a crash during boot retries the user config, never the fallback', async () => {
  const dir = await fixture(); const inst = start(dir, { runnerFile: new URL('./fixtures/crash-once-runner.mjs', import.meta.url) });
  await inst.ready;
  const boots = (await fs.readFile(path.join(dir, '.sq/configs.log'), 'utf8')).trim().split('\n');
  expect(boots.map(f => path.basename(f))).toEqual(['desktop.config.mjs', 'desktop.config.mjs']);
}, 120_000);
it('a prepared spare serves a first boot; it is replenished after, and closeSpare kills it', async () => {
  const sparePid = prepareSpare({ depsDir });
  const inst = start(await fixture(), { spares: true }); const { url } = await inst.ready;
  expect(inst.state().pid).toBe(sparePid);
  expect(await (await inst.request('/')).text()).toContain('Real child');
  expect((await fetch(url + '/__sq/local/pages')).status).toBe(403); // same guard, same secret path
  const next = prepareSpare({ depsDir }); expect(next).not.toBe(sparePid); // the taken spare is no longer the spare
  for (const cache of ['.vite', '.astro']) await expect(fs.access(path.join(depsDir, cache))).rejects.toThrow(); // warm-up never writes the shared deps
  await closeSpare();
  await expect.poll(() => alive(next)).toBe(false);
}, 120_000);
it('a taken spare is replenished even if its taker stops right away (back to Projects)', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const first = prepareSpare({ depsDir });
    const inst = start(await fixture(), { spares: true });
    await vi.waitFor(() => expect(inst.state().pid).toBe(first), { timeout: 60_000 });
    await inst.stop();                                   // the user left before replenish time
    await vi.advanceTimersByTimeAsync(SPARE_REPLENISH_MS);
    const next = currentSparePid();                     // replenished by the supervisor itself
    expect(next).toBeTruthy(); expect(next).not.toBe(first); expect(alive(next)).toBe(true);
  } finally { vi.useRealTimers(); await closeSpare(); }
}, 120_000);
it('a project with its own node_modules never takes the spare', async () => {
  const sparePid = prepareSpare({ depsDir });
  const dir = await fixture(); await fs.cp(depsDir, path.join(dir, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const inst = start(dir, { spares: true }); await inst.ready;
  expect(inst.state().pid).not.toBe(sparePid);
  await closeSpare(); await expect.poll(() => alive(sparePid)).toBe(false);
}, 180_000);
it('an uploaded public asset is served by the time the upload answers', async () => {
  const inst = start(await fixture()); await inst.ready;
  const misses = [];
  for (const name of ['a.png', 'b.png', 'c.png']) {
    const up = await inst.request(`/__sq/local/asset?name=${name}`, { method: 'POST', body: new Uint8Array([137, 80, 78, 71]),
      headers: { 'content-type': 'application/octet-stream' } });
    expect(up.status).toBe(200);
    const { src } = await up.json();
    const got = await inst.request(src); await got.arrayBuffer();
    if (got.status !== 200) misses.push(`${src} ${got.status}`);
  }
  expect(misses).toEqual([]);
}, 120_000);
it('renders a page using astro:transitions and a Tailwind plugin through the shared (symlinked) deps', async () => {
  const dir = await fixture("import tailwind from '@astrojs/tailwind';\nexport default { integrations: [tailwind()] };");
  await fs.writeFile(path.join(dir, 'tailwind.config.mjs'), "import typography from '@tailwindcss/typography';\nexport default { content: ['./src/**/*.astro'], plugins: [typography] };");
  await fs.writeFile(path.join(dir, 'src/pages/index.astro'), "---\nimport { ViewTransitions } from 'astro:transitions';\n---\n<html><head><ViewTransitions /></head><body><h1 class='prose'>Real child</h1></body></html>");
  const inst = start(dir); await inst.ready;
  const page = await inst.request('/');
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Real child');
}, 120_000);
it('uses two independent cache trees with shared dependencies', async () => {
  const a = await fixture(); const b = await fixture();
  const one = start(a); const two = start(b); await Promise.all([one.ready, two.ready]);
  await Promise.all([one.request('/'), two.request('/')]);
  expect(await fs.realpath(path.join(a, 'node_modules'))).toBe(await fs.realpath(path.join(b, 'node_modules')));
  expect(await fs.realpath(path.join(a, '.sq/cache'))).not.toBe(await fs.realpath(path.join(b, '.sq/cache')));
}, 120_000);

// Windows (2026-11-10, CI log "no running instance of the task"): the child exited before taskkill ran and Node had not
// dispatched 'exit' yet — killTree rejected, so quit skipped closing the spare and a restart ended in an error state.
// Under load (2026-11-10, the suite at load 44–149) stop() threw `kill EPERM` twice: macOS answers EPERM for
// SIGKILL to a group whose leader is already a zombie, and Node had not dispatched that leader's 'exit' yet.
it.skipIf(process.platform === 'win32')('a group whose leader died but whose exit Node has not seen yet is gone, not a failure', async () => {
  const child = spawn('sh', ['-c', "trap '' TERM; while :; do sleep 1; done"], { detached: true, stdio: 'ignore' });
  const exited = exitOf(child);
  const kill = process.kill.bind(process);
  const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid !== -child.pid || signal !== 'SIGKILL') return kill(pid, signal);
    kill(child.pid, 'SIGKILL'); // the leader dies now; Node dispatches its 'exit' on a later turn
    throw Object.assign(new Error('kill EPERM'), { code: 'EPERM', syscall: 'kill' }); // the kernel's answer for that zombie
  });
  try {
    await expect(killTree(child, exited)).resolves.toBeUndefined();
    expect(child.signalCode).toBe('SIGKILL');
  } finally { spy.mockRestore(); if (child.exitCode === null && child.signalCode === null) kill(-child.pid, 'SIGKILL'); }
}, 20_000);
it('Windows: taskkill on a child that already exited is a finished kill, not a failure', async () => {
  const gone = 2 ** 22 + 12345; // no such process
  const child = { pid: gone, exitCode: null, signalCode: null, connected: false };
  // 'exit' is dispatched only after the 1.5 s grace, i.e. after taskkill already ran and found nothing.
  const exited = new Promise(r => setTimeout(() => { child.exitCode = 1; r(); }, 1700));
  const run = vi.fn(async () => { throw Object.assign(new Error('ERROR: The process "x" not found.'), { code: 128 }); });
  await expect(killTree(child, exited, { platform: 'win32', run })).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledWith('taskkill', ['/PID', String(gone), '/T', '/F'], { windowsHide: true });
  // A live child that taskkill could not stop still fails loudly.
  const live = { pid: process.pid, exitCode: null, signalCode: null, connected: false };
  await expect(killTree(live, new Promise(() => {}), { platform: 'win32', run })).rejects.toThrow(/not found/);
});
