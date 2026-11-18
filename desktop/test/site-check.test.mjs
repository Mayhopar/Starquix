// The pre-publish type check (docs/plans/2026-10-20-prepublish-type-check-design.md): the site's own `astro check` on a
// temp copy; every way it can't run is `{ ran: false }`, never a throw — a failed check never blocks a publish (8–17).
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkSite } from '../src/site-build.mjs';

const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const temp = async prefix => { const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(d); return d; };
/** A project like the editor's (node_modules linked to the shared runtime); `pkg` = its package.json text. */
async function project(pkg = JSON.stringify({ type: 'module', scripts: { build: 'astro check && astro build' } })) {
  const dir = await temp('sq-check-project-');
  if (pkg !== null) await fs.writeFile(path.join(dir, 'package.json'), pkg);
  await fs.mkdir(path.join(dir, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/pages/index.astro'), '<h1>Hi</h1>');
  await fs.symlink(depsDir, path.join(dir, 'node_modules'), 'junction');
  return dir;
}
const fixture = name => new URL(`./fixtures/${name}`, import.meta.url);
const NONE = { ran: false, errors: [], total: 0 };

it('8/10. no package.json, broken JSON, no build, a build without astro check (or reaching it via npm run) → ran false, no copy', async () => {
  const builds = [null, '{', '{"scripts":{}}', '{"scripts":{"build":"astro build"}}', '{"scripts":{"build":"npm run check && astro build"}}'];
  for (const pkg of builds) {
    const tmpRoot = await temp('sq-check-tmp-');
    expect(await checkSite(await project(pkg), { runnerFile: fixture('check-errors-runner.mjs'), tmpRoot })).toEqual(NONE);
    expect(await fs.readdir(tmpRoot)).toEqual([]);
  }
});

it('19/20/29/30. the errors come back (first 100 + total); the project gets nothing; temp is removed', async () => {
  const dir = await project();
  const before = (await fs.readdir(dir, { recursive: true })).sort();
  const tmpRoot = await temp('sq-check-tmp-');
  const out = await checkSite(dir, { runnerFile: fixture('check-errors-runner.mjs'), tmpRoot });
  expect(out.ran).toBe(true);
  expect(out.total).toBe(101);
  expect(out.errors).toHaveLength(100);
  expect(out.errors[0]).toEqual({ file: 'src/pages/index.astro', line: 1, column: 5, code: 'ts(2339)', message: 'error 0' });
  expect((await fs.readdir(dir, { recursive: true })).sort()).toEqual(before);
  expect(await fs.readdir(tmpRoot)).toEqual([]);
});

it('9/19/29/32. the real runner (sync + AstroCheck, @astrojs/check from the shared runtime): the error, its project path, 1-based line; the project gets nothing', async () => {
  const dir = await project();
  await fs.writeFile(path.join(dir, 'tsconfig.json'), '{ "extends": "astro/tsconfigs/strict" }');
  await fs.writeFile(path.join(dir, 'src/pages/index.astro'), '---\nconst n: number = "x";\n---\n<h1>{n}</h1>');
  const before = (await fs.readdir(dir, { recursive: true })).sort();
  const tmpRoot = await temp('sq-check-tmp-');
  const out = await checkSite(dir, { tmpRoot });
  expect(out).toMatchObject({ ran: true, total: 1 });
  expect(out.errors[0]).toMatchObject({ file: 'src/pages/index.astro', line: 2, column: 7, code: 'ts(2322)' });
  expect((await fs.readdir(dir, { recursive: true })).sort()).toEqual(before); // sync wrote .astro/ + env.d.ts into the copy only
  expect(await fs.readdir(tmpRoot)).toEqual([]);
  await fs.writeFile(path.join(dir, 'src/pages/index.astro'), '---\nconst n: number = 1;\n---\n<h1>{n}</h1>');
  expect(await checkSite(dir, { tmpRoot })).toEqual({ ran: true, errors: [], total: 0 });
}, 120_000);

it('12. a project whose own node_modules has no @astrojs/check → ran false', async () => {
  const dir = await project();
  await fs.rm(path.join(dir, 'node_modules')); await fs.mkdir(path.join(dir, 'node_modules')); // its own (empty), not the shared link
  expect(await checkSite(dir, { tmpRoot: await temp('sq-check-tmp-') })).toEqual(NONE);
}, 60_000);

it('14/15. a child that dies, or runs past the deadline (killed) → ran false, temp removed', async () => {
  for (const [runner, timeoutMs] of [['exit-runner.mjs', 60_000], ['hung-runner.mjs', 300]]) {
    const tmpRoot = await temp('sq-check-tmp-');
    expect(await checkSite(await project(), { runnerFile: fixture(runner), timeoutMs, tmpRoot })).toEqual(NONE);
    expect(await fs.readdir(tmpRoot)).toEqual([]);
  }
});
