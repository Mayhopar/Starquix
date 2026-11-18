// Main-owned lifetime of ONE project's Astro child: readiness deadline, identity
// check, bounded restart with backoff, one fresh-process config fallback and
// process-tree cleanup. The handle exists before startup completes.
import { fork, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { installSqFiles } from './instance.mjs';
import { ensureContentConfig, upgradeSite } from './astro-upgrade.mjs';
import { installPackages, linkNodeModules, missingPackages } from './deps.mjs';
import { installDesktopConfig } from './wrapper.mjs';
import { abortSafe } from './abort-safe.mjs';
const exec = promisify(execFile);
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const terminations = new WeakMap();
export function killTree(child, exited, options) {
  if (!child) return Promise.resolve();
  if (!terminations.has(child)) terminations.set(child, terminateTree(child, exited, options));
  return terminations.get(child);
}
const isAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
async function terminateTree(child, exited, { platform = process.platform, run = exec } = {}) {
  if (!child?.pid) return;
  const pid = child.pid;
  if (child.connected) { try { child.send({ type: 'stop' }); } catch {} }
  await Promise.race([exited, delay(1500)]);
  if (platform === 'win32') {
    if (child.exitCode === null && child.signalCode === null) {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(error => { // no console flash
        // "no running instance": it exited before taskkill and Node has not dispatched 'exit' yet — gone, not a failure.
        if (child.exitCode === null && child.signalCode === null && isAlive(pid)) throw error;
      });
    }
  } else {
    // detached ⇒ the child leads its own group: esbuild and other descendants go too.
    // macOS answers EPERM (not ESRCH) for a group whose leader is already a zombie — also BEFORE Node
    // has dispatched that leader's 'exit' (a starved event loop: stop() threw `kill EPERM` under load,
    // 2026-11-10). So EPERM waits for the exit; a leader that never exits still fails below.
    const signalGroup = async signal => {
      try { process.kill(-pid, signal); } catch (e) {
        if (e.code === 'ESRCH') return;
        if (e.code === 'EPERM' && await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) return;
        throw e;
      }
    };
    await signalGroup('SIGTERM');
    await delay(100);
    await signalGroup('SIGKILL');
  }
  await Promise.race([exited, delay(5000).then(() => { throw new Error('Owned child did not exit'); })]);
}
const RUNNER = new URL('./runner.mjs', import.meta.url);
// SQ_CPU_PROF=<dir>: each Astro child writes a .cpuprofile on exit (scripts/profile.mjs).
/** projectId → the port its last verified child served on. Every boot of the project asks for it
 *  again — a crash restart in the same lease AND the editor's reopen on a fresh lease: same origin,
 *  so the canvas iframe's document change stays paint-held (A4/A5). Taken → the next free port. */
const lastPorts = new Map();
export const forkRunner = (runnerFile, cwd, env) => fork(runnerFile, [], { cwd,
  execArgv: process.env.SQ_CPU_PROF ? ['--cpu-prof', `--cpu-prof-dir=${process.env.SQ_CPU_PROF}`] : [],
  detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  // VITEST unset: Astro 7's dev server skips every page route when it sees it (a test parent leaks it).
  env: { ...process.env, VITEST: undefined, ELECTRON_RUN_AS_NODE: '1', ASTRO_TELEMETRY_DISABLED: '1', ASTRO_DISABLE_UPDATE_CHECK: 'true', ...env } });
export const pipeOutput = child => { child.stdout?.on('data', d => process.stdout.write(d)); child.stderr?.on('data', d => process.stderr.write(d)); };
export const exitOf = child => new Promise(r => { if (child.exitCode !== null || child.signalCode !== null) r(); else child.once('exit', () => r()); });

/** ONE pre-forked runner with Astro already imported from the shared deps: a project's
 *  first boot takes it instead of paying the import (runner SQ_SPARE_FROM). */
let spare = null;
// SQ_IPC_LOG=1: spare lifecycle on the same line protocol the profiler reads.
const trace = (name, extra = {}) => { if (process.env.SQ_IPC_LOG) console.log('[sq-ipc]', JSON.stringify({ at: Date.now(), name, route: '', ms: 0, ...extra })); };
export const SPARE_REPLENISH_MS = 5000;
export function prepareSpare({ depsDir, runnerFile = RUNNER }) {
  if (spare) return spare.pid;
  const from = path.dirname(depsDir); const child = forkRunner(runnerFile, from, { SQ_SPARE_FROM: from });
  pipeOutput(child); trace('spare-forked', { pid: child.pid });
  child.on('message', m => { if (m?.type === 'spare-warm') trace('spare-warm', { pid: child.pid }); });
  child.once('exit', (code, signal) => { trace('spare-exit', { pid: child.pid, code, signal }); if (spare === child) spare = null; });
  spare = child; return child.pid;
}
let replenish = null;
/** Taking the spare schedules its replacement, independent of the taker: a user who opens a
 *  project and goes back to Projects within seconds still finds a warm spare (log-proven:
 *  the replacement used to die with the taker's lease). Late enough not to compete with the open. */
function takeSpare(opts) {
  const child = spare; spare = null;
  clearTimeout(replenish); replenish = setTimeout(() => { replenish = null; prepareSpare(opts); }, SPARE_REPLENISH_MS);
  const usable = child?.connected && child.exitCode === null && child.signalCode === null ? child : null;
  trace(usable ? 'spare-taken' : 'spare-missing', { pid: child?.pid ?? null });
  return usable;
}
export const currentSparePid = () => spare?.pid ?? null;
export async function closeSpare() { clearTimeout(replenish); replenish = null; const child = spare; spare = null; if (child) await killTree(child, exitOf(child)); }

/** The deadline bounds a WEDGED child, never a busy one: a live dev server on a loaded machine
 *  answers late (first renders 4.6–8.6 s at load ~42 on a one-page site, past 10 s under the full
 *  test load — the old 10 s cut real answers off, 2026-11-10). A dead child fails at once anyway
 *  (connection refused/reset); the caller's abort still cancels sooner. */
const REQUEST_MS = 120_000;
/** The ONLY way main talks to an instance: secret header, no redirects, a
 *  deadline, and the caller's abort forwarded — never into undici while its fetch() is on the stack (abort-safe.mjs). */
export function privateFetch(token, lifetime, timeoutMs = REQUEST_MS) {
  return (url, init = {}) => {
    const headers = new Headers(init.headers); headers.set('x-sq-desktop-token', token);
    return abortSafe(fetch)(url, { ...init, headers, redirect: 'error',
      signal: AbortSignal.any([lifetime, AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]) });
  };
}
export function createInstance({ projectId, lease, projectDir, templateDir, depsDir,
  onState = () => {}, runnerFile = RUNNER, bootMs = 45_000, spares = false }) {
  const token = randomBytes(32).toString('hex');
  const abort = new AbortController(); const first = deferred();
  void first.promise.catch(() => {});
  let child = null; let exitPromise = Promise.resolve(); let stopping;
  let snapshot = { phase: 'starting', url: null, generation: 0, pid: null, error: null };
  function publish(patch) { snapshot = { ...snapshot, ...patch }; onState({ ...snapshot }); }
  const raw = privateFetch(token, abort.signal);
  const loop = (async () => {
    try {
      // First open of a site that declares more than the shared runtime: install its extras once.
      const missing = await missingPackages(projectDir, depsDir);
      if (missing.length) publish({ phase: 'starting', detail: `Installing ${missing.map(([name]) => name).join(', ')}` });
      const extras = await installPackages(projectDir, missing, { npmCli: path.join(depsDir, 'npm/bin/npm-cli.js'), signal: abort.signal });
      await linkNodeModules(projectDir, depsDir, extras);
      await installSqFiles(templateDir, projectDir);
      // A site on older Astro file shapes moves to the shared Astro once, only when verified (astro-upgrade.mjs).
      const upgrade = await upgradeSite(projectDir, { depsDir, signal: abort.signal, onDetail: detail => publish({ phase: 'starting', detail }) })
        .catch(error => ({ status: 'error', reason: String(error?.message ?? error) }));
      if (upgrade.status !== 'skipped') console.log('[astro upgrade]', projectId, JSON.stringify(upgrade));
      await ensureContentConfig(projectDir);
      abort.signal.throwIfAborted();
      const configs = await installDesktopConfig(projectDir);
      // A spare preloaded the SHARED Astro: only a project on the shared deps may take it.
      const sharedDeps = spares && await fs.realpath(path.join(projectDir, 'node_modules/astro')).catch(() => null) === await fs.realpath(path.join(depsDir, 'astro'));
      let failures = 0; let fallback = false; let consecutiveCrashes = 0;
      while (!abort.signal.aborted) {
        const generation = snapshot.generation + 1;
        publish({ phase: 'starting', generation, url: null, error: null, detail: null });
        abort.signal.throwIfAborted();
        const boot = deferred(); const exited = deferred();
        void boot.promise.catch(() => {});
        const identity = { projectId, lease, generation };
        const env = { SQ_DESKTOP_TOKEN: token, SQ_DESKTOP_IDENTITY: JSON.stringify(identity),
          SQ_DESKTOP_CONFIG: fallback ? configs.fallback : configs.normal, SQ_DESKTOP_PORT: String(lastPorts.get(projectId) ?? '') };
        const reused = generation === 1 && sharedDeps ? takeSpare({ depsDir, runnerFile }) : null; // restarts always fork fresh
        if (reused) { child = reused; child.send({ type: 'start', cwd: projectDir, env }); }
        else { child = forkRunner(runnerFile, projectDir, env); pipeOutput(child); }
        exitPromise = exited.promise;
        publish({ pid: child.pid ?? null });
        child.once('error', error => { boot.reject(error); exited.resolve(); });
        child.once('exit', (code, signal) => { boot.reject(new Error(`Astro exited (${code ?? signal})`)); exited.resolve(); });
        if (child.exitCode !== null || child.signalCode !== null) { boot.reject(new Error('Astro exited')); exited.resolve(); }
        child.on('message', message => {
          if (message?.type === 'failed') boot.reject(Object.assign(new Error(message.error), { configFailed: true }));
          if (message?.type === 'ready' && Number.isInteger(message.port) && message.port > 0 && message.port < 65536) boot.resolve(message);
        });
        const deadline = setTimeout(() => boot.reject(new Error('Astro startup deadline')), bootMs);
        const cancel = () => boot.reject(new Error('Startup cancelled'));
        abort.signal.addEventListener('abort', cancel, { once: true });
        try {
          const { port, node, electron } = await boot.promise;
          const url = `http://127.0.0.1:${port}`;
          const health = await raw(url + '/__sq/desktop-health').then(r => r.json());
          if (JSON.stringify(health) !== JSON.stringify(identity)) throw new Error('Instance identity mismatch');
          const bridge = await raw(url + '/scripts/bridge.js');
          if (!bridge.ok || !/javascript/i.test(bridge.headers.get('content-type') ?? '')) throw new Error('Bridge identity failed');
          await bridge.arrayBuffer();
          abort.signal.throwIfAborted(); failures = 0; lastPorts.set(projectId, port); // only a verified instance's port
          clearTimeout(deadline);
          publish({ phase: 'running', url, childNode: node, childElectron: electron }); first.resolve({ url, generation });
          const runningSince = Date.now();
          await exited.promise;
          // Requests fail fast while the replacement boots.
          if (!abort.signal.aborted) publish({ phase: 'starting', url: null });
          consecutiveCrashes = Date.now() - runningSince < 10_000 ? consecutiveCrashes + 1 : 0;
          if (consecutiveCrashes >= 3) throw new Error('Repeated rapid child exits');
        } catch (error) {
          if (!abort.signal.aborted) {
            failures++;
            console.error('[desktop startup]', projectId, String(error));
            // Only Astro's own dev() rejection blames the user config; a crash, kill or
            // deadline retries it (the fallback drops the user's Tailwind setup).
            if (error.configFailed) fallback = true; // retained for this lease
            if (failures >= 3 || consecutiveCrashes >= 3) throw error;
          }
        } finally {
          clearTimeout(deadline); abort.signal.removeEventListener('abort', cancel);
          await killTree(child, exited.promise); child = null;
          publish({ pid: null });
        }
        if (!abort.signal.aborted) await delay(Math.min(250 * 2 ** failures, 2000), undefined, { signal: abort.signal });
      }
    } catch (error) {
      if (!abort.signal.aborted) publish({ phase: 'error', error: String(error), url: null });
      first.reject(error);
    } finally {
      first.reject(new Error('Instance stopped before readiness'));
      if (abort.signal.aborted) publish({ phase: 'stopped', url: null, pid: null });
    }
  })();
  return {
    ready: first.promise,
    state: () => ({ ...snapshot }),
    async request(route, init = {}) {
      if (snapshot.phase !== 'running') throw new Error('Instance unavailable');
      const url = new URL(route, snapshot.url);
      if (url.origin !== snapshot.url || url.username || url.password) throw new Error('Foreign instance request');
      return raw(url.href, init);
    },
    stop() {
      if (!stopping) stopping = (async () => {
        abort.abort(); first.reject(new Error('Startup cancelled'));
        await killTree(child, exitPromise); await loop;
      })();
      return stopping;
    },
  };
}
