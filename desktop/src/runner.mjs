// The Astro child: forked with Electron's Node (ELECTRON_RUN_AS_NODE), calls the
// locked Astro `dev()` API in the project dir and reports the ACTUAL bound port
// over IPC — no probe-then-bind, no stdout URL parsing.
import { createRequire, enableCompileCache } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Boot is mostly Node compiling Astro/Vite's module graph: reuse V8's code cache across children.
if (process.env.SQ_COMPILE_CACHE) enableCompileCache?.(process.env.SQ_COMPILE_CACHE);
let server; let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try { await server?.stop(); } finally { process.exit(0); }
}
process.on('message', message => { if (message?.type === 'stop') void stop(); });
process.on('disconnect', () => void stop());
// Node emits no 'disconnect' when main left before this process started (quit right after the fork): check once too.
if (process.send && !process.connected) void stop();
process.on('SIGTERM', () => void stop());

const importAstro = dir => import(pathToFileURL(createRequire(path.join(dir, 'package.json')).resolve('astro')).href);

/** dev() on an OS-assigned loopback port. Vite reads port 0 as "unset" and falls back
 *  to 5173 (startServer): until the first bind, force port 0; the address comes from
 *  httpServer.address(). Astro's auto-restart re-reads the inline config, so the bound
 *  port is pinned there afterwards (a restart rebinds the address main verified).
 *  Every boot after the project's first asks for its last port (SQ_DESKTOP_PORT, supervisor
 *  lastPorts): the same origin lets the editor's canvas keep its frame across a crash.
 *  Never strict: taken → Vite binds the next free one (its port-0 path never retries). */
async function startDev(astro, root, { vite, ...extra }) {
  const inlineConfig = { root, server: { port: Number(process.env.SQ_DESKTOP_PORT) || 0, host: '127.0.0.1' }, logLevel: 'warn', ...extra,
    vite: { ...vite, server: { ...vite?.server, strictPort: false }, plugins: [{
      name: 'sq-desktop-port', configureServer(vite) {
        if (inlineConfig.server.port !== 0 || !vite.httpServer) return;
        const listen = vite.httpServer.listen;
        vite.httpServer.listen = (_port, ...rest) => listen.call(vite.httpServer, 0, ...rest);
      },
    }] } };
  const started = await astro.dev(inlineConfig);
  inlineConfig.server.port = started.address.port;
  return started;
}

/** A spare pays Vite/Astro/compiler first-use costs on a throwaway site (measured:
 *  dev() 200 → 150 ms, first page 230 → 150 ms in the real project afterwards). */
async function warmUp(astro, depsFrom) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-warm-'));
  try {
    await fs.mkdir(path.join(dir, 'src/pages'), { recursive: true });
    await fs.symlink(path.join(depsFrom, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(dir, 'astro.config.mjs'), "import mdx from '@astrojs/mdx';\nimport tailwind from '@astrojs/tailwind';\n"
      + 'export default { integrations: [mdx(), tailwind({ applyBaseStyles: false })] };\n');
    await fs.writeFile(path.join(dir, 'tailwind.config.mjs'), "export default { content: ['./src/**/*.astro'] };\n");
    await fs.writeFile(path.join(dir, 'src/pages/index.astro'), '---\nconst n = 1;\n---\n<html><body><h1 class="p-4">{n}</h1></body></html>\n');
    // node_modules is the SHARED read-only deps: every cache stays in the throwaway dir.
    const warm = await startDev(astro, dir, { logLevel: 'error', cacheDir: path.join(dir, '.cache/astro'),
      vite: { cacheDir: path.join(dir, '.cache/vite') } });
    try { await (await fetch(`http://127.0.0.1:${warm.address.port}/`)).text(); } finally { await warm.stop(); }
  } catch { /* warm-up is best effort */ } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// SQ_SPARE_FROM=<dir with the shared node_modules>: a spare imports Astro and warms up
// while no project is open; main later hands it one: { type: 'start', cwd, env }.
if (process.env.SQ_SPARE_FROM) {
  const from = process.env.SQ_SPARE_FROM;
  const started = new Promise(resolve => process.on('message', m => { if (m?.type === 'start') resolve(m); }));
  await importAstro(from).then(astro => warmUp(astro, from)).catch(() => {}); // the project's own import below is authoritative
  process.send?.({ type: 'spare-warm' });
  const start = await started;
  Object.assign(process.env, start.env); process.chdir(start.cwd);
}
try {
  // Astro joins configFile onto root (core/config/config.js) — pass it root-relative.
  server = await startDev(await importAstro(process.cwd()), process.cwd(),
    { configFile: path.relative(process.cwd(), process.env.SQ_DESKTOP_CONFIG) });
  if (stopping) await stop();
  process.send?.({ type: 'ready', port: server.address.port, node: process.versions.node, electron: process.versions.electron });
} catch (error) {
  process.send?.({ type: 'failed', error: String(error?.stack ?? error) });
  process.exitCode = 1;
  // Explicit exit is intentional: partially constructed config/plugins may
  // leave watchers alive after a rejected dev(). Parent owns tree cleanup.
  setTimeout(() => process.exit(1), 20);
}
