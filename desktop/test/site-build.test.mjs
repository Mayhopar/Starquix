// The publish build: Astro's own build() of the project in a child, into a temp dir — real Astro from the shared
// runtime deps (docs/plans/2026-10-16-cloudflare-one-click-design.md, ledger 21–26, 40–41).
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSite, listSite } from '../src/site-build.mjs';
import { exitOf, forkRunner } from '../src/supervisor.mjs';

const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const temp = async prefix => { const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(d); return d; };
/** A project like the editor's: its own astro.config, node_modules linked to the shared runtime. */
async function project(config = 'export default {}', pages = { 'index.astro': '<html><body><h1>Built here</h1></body></html>' }) {
  const dir = await temp('sq-build-project-');
  await fs.mkdir(path.join(dir, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(dir, 'astro.config.mjs'), config);
  for (const [name, text] of Object.entries(pages)) await fs.writeFile(path.join(dir, 'src/pages', name), text);
  await fs.symlink(depsDir, path.join(dir, 'node_modules'), 'junction');
  return dir;
}
const entries = dir => fs.readdir(dir).then(n => n.sort());
/** Every path under the project but its node_modules link, with its bytes: "the project gets nothing" is checked byte for byte. */
async function snapshot(dir) {
  const out = {};
  for (const e of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    const full = path.join(e.parentPath, e.name); const rel = path.relative(dir, full);
    if (rel.split(path.sep)[0] === 'node_modules') continue;
    out[rel] = e.isFile() ? (await fs.readFile(full)).toString('base64') : e.isDirectory() ? 'dir' : 'other';
  }
  return out;
}

it('C2/41. builds the site with ITS astro.config into temp: pages + public files come back, the project folder gets nothing', async () => {
  const dir = await project("import tailwind from '@astrojs/tailwind';\nexport default { integrations: [tailwind()] };", {
    'index.astro': "<html><body><h1 class='p-4'>Built here</h1></body></html>",
    'about.astro': '<html><body>About</body></html>',
  });
  await fs.writeFile(path.join(dir, 'tailwind.config.mjs'), "export default { content: ['./src/**/*.astro'] };");
  await fs.mkdir(path.join(dir, 'public')); await fs.writeFile(path.join(dir, 'public/robots.txt'), 'User-agent: *');
  const before = await snapshot(dir);
  const tmpRoot = await temp('sq-build-tmp-');
  const files = await buildSite(dir, { tmpRoot });
  const byPath = Object.fromEntries(files.map(f => [f.path, f]));
  expect(byPath['/index.html'].bytes.toString()).toContain('Built here');
  expect(byPath['/index.html'].type).toBe('text/html; charset=utf-8');
  expect(byPath['/about/index.html']).toBeTruthy();
  expect(byPath['/robots.txt'].type).toBe('text/plain; charset=utf-8');
  // Astro ≥7 inlines a small stylesheet: the Tailwind rule reaches the page either way.
  expect(files.some(f => f.path.endsWith('.css') && f.type === 'text/css; charset=utf-8') || /\.p-4\s*\{/.test(byPath['/index.html'].bytes.toString())).toBe(true);
  expect(files.every(f => !f.path.includes('node_modules'))).toBe(true);
  expect(await snapshot(dir)).toEqual(before); // e2e C1: Astro 4's build writes src/env.d.ts when missing — never into the project
  expect(await entries(tmpRoot)).toEqual([]); // temp cleaned
}, 60_000);

it('23. a server site (output: server or an adapter) is refused before anything builds', async () => {
  for (const config of ["export default { output: 'server' };", "export default { adapter: { name: 'some-adapter', hooks: {} } };"]) {
    const dir = await project(config);
    const tmpRoot = await temp('sq-build-tmp-');
    await expect(buildSite(dir, { tmpRoot })).rejects.toMatchObject({ code: 'not-static' });
    expect(await entries(tmpRoot)).toEqual([]);
  }
}, 60_000);

it('21. a broken page → build-failed with Astro\'s own first line (no stack, no colors)', async () => {
  const dir = await project('export default {}', { 'index.astro': '---\nconst x = ;\n---\n<h1>{x}</h1>' });
  const e = await buildSite(dir, { tmpRoot: await temp('sq-build-tmp-') }).then(() => null, x => x);
  expect(e).toMatchObject({ code: 'build-failed' });
  expect(e.message).toMatch(/^Build failed with 1 error: src\/pages\/index\.astro:2:\d+: CompilerError: Unexpected/); // the line that says where and what
  expect(e.message.length).toBeLessThanOrEqual(300);
  expect(e.message).not.toMatch(/\n|\x1b\[|    at |\[astro|\/tmp\//);
}, 60_000);

it('26. no pages → build-failed "The site built no pages"', async () => {
  const dir = await project('export default {}', {});
  await expect(buildSite(dir, { tmpRoot: await temp('sq-build-tmp-') })).rejects.toMatchObject({ code: 'build-failed', message: 'The site built no pages' });
}, 60_000);

it('22. a build past the deadline is killed → build-failed', async () => {
  const dir = await project();
  const hung = new URL('./fixtures/hung-runner.mjs', import.meta.url);
  await expect(buildSite(dir, { runnerFile: hung, timeoutMs: 300, tmpRoot: await temp('sq-build-tmp-') }))
    .rejects.toMatchObject({ code: 'build-failed', message: 'The build took longer than 5 minutes' });
});

it('24/C2. listSite: every file with its served type (text = utf-8; unknown = no type), > 25 MiB → file-too-big', async () => {
  const dist = await temp('sq-dist-');
  await fs.mkdir(path.join(dist, 'a/b'), { recursive: true });
  for (const [name, text] of [['index.html', '<h1>'], ['a/b/x.js', '1'], ['a/data.json', '{}'], ['img.svg', '<svg/>'], ['f.woff2', 'w'], ['CNAME', 'x']]) {
    await fs.writeFile(path.join(dist, name), text);
  }
  const files = await listSite(dist);
  expect(Object.fromEntries(files.map(f => [f.path, f.type]))).toEqual({
    '/index.html': 'text/html; charset=utf-8', '/a/b/x.js': 'text/javascript; charset=utf-8', '/a/data.json': 'application/json',
    '/img.svg': 'image/svg+xml', '/f.woff2': 'font/woff2', '/CNAME': 'application/null',
  });
  expect(files.find(f => f.path === '/index.html').bytes.toString()).toBe('<h1>');
  await fs.writeFile(path.join(dist, 'big.mp4'), ''); await fs.truncate(path.join(dist, 'big.mp4'), 25 * 1024 * 1024 + 1);
  await expect(listSite(dist)).rejects.toMatchObject({ code: 'file-too-big', file: '/big.mp4' });
});

it('review 11. the build child exits as soon as main goes away (app quit mid-build) — it never finishes the build', async () => {
  const dir = await project();
  const child = forkRunner(new URL('../src/build-runner.mjs', import.meta.url), dir, { SQ_BUILD_OUT: await temp('sq-build-tmp-') });
  const exited = exitOf(child);
  child.disconnect();
  await exited;
  await expect(fs.access(path.join(dir, 'dist'))).rejects.toThrow(); // without the handler it builds to the end first
}, 60_000);
