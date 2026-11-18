// The production editor bundle of THIS worktree, built once per source state and served like the packaged app's: gates run on a production
// bundle (the dev editor is 3-5x slower in React, R11) whose process topology matches starquix://app (the editor on http://localhost:<port>, the
// canvas on http://127.0.0.1:<port>: two sites = two renderer processes).
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { editorFile } from '../src/editor.mjs';

const MARKER = '.sq-probe-bundle.json';
const REQUIRED = ['index.html', 'package.json'];
// not read by `vite build` unless present: the build config and the snapshot whose version is baked into the bundle
const OPTIONAL = ['vite.config.ts', 'tsconfig.json', 'public/astro-snapshot.json'];
const inBundle = rel => !/(^|[\\/])__tests__[\\/]|\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
const exists = p => fs.access(p).then(() => true, () => false);

async function walk(root) {
  const out = [];
  const visit = async rel => {
    for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) await visit(r); else if (e.isFile()) out.push(r);
    }
  };
  await visit('');
  return out;
}

/** 16 hex chars over app/src (tests excluded: they are not in the bundle), index.html, package.json, the build config and the root lock. */
export async function bundleHash({ appDir, lockFile }) {
  const inputs = [...(await walk(path.join(appDir, 'src'))).filter(inBundle).map(f => path.join('src', f)), ...REQUIRED];
  for (const rel of OPTIONAL) if (await exists(path.join(appDir, rel))) inputs.push(rel);
  const named = [...inputs.map(rel => [rel.split(path.sep).join('/'), path.join(appDir, rel)]), ['package-lock.json (root)', lockFile]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const hash = createHash('sha256'); let bytes = 0;
  for (const [name, file] of named) { const body = await fs.readFile(file); bytes += body.length; hash.update(`${name}\0${body.length}\0`); hash.update(body); }
  return { hash: hash.digest('hex').slice(0, 16), files: named.length, bytes };
}

/** cd app && VITE_API_URL= vite build --outDir <outDir> --emptyOutDir (what `npm run editor` in desktop/ runs, without the tsc pass). */
export function viteBuild({ appDir, outDir }) {
  const vite = path.join(path.dirname(createRequire(path.join(appDir, 'package.json')).resolve('vite/package.json')), 'bin/vite.js');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: appDir, env: { ...process.env, VITE_API_URL: '' }, maxBuffer: 1 << 26 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`vite build failed: ${error.message}\n${String(stderr || stdout).slice(-2000)}`)); else resolve();
    });
  });
}

/** The bundle for the current sources: reused while the hash holds, built (into a temp dir, then moved into place) when it does not.
 *  A bundle counts only with its completion marker; the newest `keep` are kept. */
export async function ensureBundle({ appDir, lockFile, cacheRoot, build = viteBuild, keep = 4 }) {
  const { hash } = await bundleHash({ appDir, lockFile });
  const dir = path.join(cacheRoot, hash);
  const ready = async d => (await exists(path.join(d, MARKER))) && (await exists(path.join(d, 'index.html')));
  if (await ready(dir)) return { dir, hash, built: false, ms: 0 };
  await fs.mkdir(cacheRoot, { recursive: true });
  const staging = `${dir}.tmp-${process.pid}`;
  await fs.rm(staging, { recursive: true, force: true });
  const t0 = Date.now();
  try {
    await build({ appDir, outDir: staging });
    if (!(await exists(path.join(staging, 'index.html')))) throw new Error(`the editor build wrote no index.html into ${staging}`);
    await fs.writeFile(path.join(staging, MARKER), JSON.stringify({ hash, builtAt: new Date().toISOString() }));
    if (!(await ready(dir))) { await fs.rm(dir, { recursive: true, force: true }); await fs.rename(staging, dir); } // else another run finished first
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  const bundles = [];
  for (const name of await fs.readdir(cacheRoot)) {
    const marker = await fs.stat(path.join(cacheRoot, name, MARKER)).catch(() => null);
    if (marker) bundles.push({ name, at: marker.mtimeMs });
  }
  for (const old of bundles.sort((a, b) => b.at - a.at).slice(keep)) if (old.name !== hash) await fs.rm(path.join(cacheRoot, old.name), { recursive: true, force: true });
  return { dir, hash, built: true, ms: Date.now() - t0 };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8' };

/** Serves `root` on a free loopback port (never the owner's :3061; `port` pins one, e.g. the Test app's stable origin) with the packaged app's file rules (editorFile: SPA fallback, nothing outside the bundle).
 *  `url` says `localhost`: a different SITE than the 127.0.0.1 canvas, so the editor and the canvas run in separate renderer processes. */
export async function serveBundle(root, { host = '127.0.0.1', port: wanted = 0 } = {}) {
  const base = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      const file = await editorFile(base, new URL(req.url, 'http://localhost').pathname);
      if (!file) { res.writeHead(404).end('Not found'); return; }
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-length': body.length }).end(body);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(wanted, host, resolve); });
  const { port } = server.address();
  return { port, url: `http://localhost:${port}/`, close: () => new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
