import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../src/git/engine.mjs';

const dirs = [];
const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-git-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fsp.rm(d, { recursive: true, force: true }))); });
const author = { name: 'Starquix', email: 'noreply@starquix.app' };

it('first save initializes the repo with .gitignore and lists the version', async () => {
  const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'index.astro'), '<h1>hi</h1>');
  await fsp.mkdir(path.join(dir, '.sq')); await fsp.writeFile(path.join(dir, '.sq/x.mjs'), '');
  const engine = createEngine(dir);
  expect(await engine.status()).toMatchObject({ initialized: false, changed: 2 }); // index.astro + .gitignore (.sq/ ignored)
  await engine.save('First', author);
  const s = await engine.status();
  expect(s).toMatchObject({ initialized: true, branch: 'main', changed: 0 });
  const log = await engine.history();
  expect(log.map(v => v.message)).toEqual(['First']);
  expect(await fsp.readFile(path.join(dir, '.gitignore'), 'utf8')).toContain('.sq/');
});

it('save with no changes is refused', async () => {
  const dir = await tmp(); await fsp.writeFile(path.join(dir, 'a'), '1');
  const engine = createEngine(dir); await engine.save('one', author);
  await expect(engine.save('two', author)).rejects.toThrow('Nothing to save');
});

it('deleted files are recorded in the version', async () => {
  const dir = await tmp(); await fsp.writeFile(path.join(dir, 'a'), '1'); await fsp.writeFile(path.join(dir, 'b'), '2');
  const engine = createEngine(dir); await engine.save('one', author);
  await fsp.rm(path.join(dir, 'b'));
  expect((await engine.status()).changed).toBe(1);
  await engine.save('two', author);
  expect((await engine.status()).changed).toBe(0);
});

it('restore writes the old tree as a NEW version and keeps history', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.writeFile(path.join(dir, 'a'), 'v1'); const v1 = await engine.save('one', author);
  await fsp.writeFile(path.join(dir, 'a'), 'v2'); await fsp.writeFile(path.join(dir, 'b'), 'new');
  await engine.save('two', author);
  await engine.restore(v1, author);
  expect(await fsp.readFile(path.join(dir, 'a'), 'utf8')).toBe('v1');
  expect(fs.existsSync(path.join(dir, 'b'))).toBe(false);
  expect((await engine.history()).map(v => v.message)).toEqual(['Restore: one', 'two', 'one']);
});

it('restore refuses while there are unsaved changes', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.writeFile(path.join(dir, 'a'), 'v1'); const v1 = await engine.save('one', author);
  await fsp.writeFile(path.join(dir, 'a'), 'dirty');
  await expect(engine.restore(v1, author)).rejects.toThrow('Unsaved changes');
});

it('creates and switches branches; switching while dirty is refused', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.writeFile(path.join(dir, 'a'), 'main'); await engine.save('one', author);
  await engine.createBranch('redesign');
  expect((await engine.status()).branch).toBe('redesign');
  await fsp.writeFile(path.join(dir, 'a'), 'redesign'); await engine.save('r', author);
  await fsp.writeFile(path.join(dir, 'a'), 'dirty');
  await expect(engine.switchBranch('main')).rejects.toThrow('Unsaved changes');
  await engine.discard();
  await engine.switchBranch('main');
  expect(await fsp.readFile(path.join(dir, 'a'), 'utf8')).toBe('main');
  expect(await engine.branches()).toEqual(['main', 'redesign']);
});

it('discard drops new + edited + deleted files but never touches ignored paths', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.writeFile(path.join(dir, 'a'), '1'); await fsp.writeFile(path.join(dir, 'b'), '2');
  await engine.save('one', author);
  await fsp.mkdir(path.join(dir, '.sq')); await fsp.writeFile(path.join(dir, '.sq/x'), 'runtime');
  await fsp.writeFile(path.join(dir, 'a'), 'edited'); await fsp.rm(path.join(dir, 'b'));
  await fsp.writeFile(path.join(dir, 'new'), 'n');
  await engine.discard();
  expect(await fsp.readFile(path.join(dir, 'a'), 'utf8')).toBe('1');
  expect(await fsp.readFile(path.join(dir, 'b'), 'utf8')).toBe('2');
  expect(fs.existsSync(path.join(dir, 'new'))).toBe(false);
  expect(await fsp.readFile(path.join(dir, '.sq/x'), 'utf8')).toBe('runtime');
  expect((await engine.status()).changed).toBe(0);
});

it('rejects invalid branch names', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.writeFile(path.join(dir, 'a'), '1'); await engine.save('one', author);
  await expect(engine.createBranch('../x')).rejects.toThrow('Invalid branch name');
});

// isomorphic-git's stat cache compares whole seconds (no racy-git check): a same-size edit in the
// same second as a save/status looked clean, and the next version silently missed it.
it('a same-size edit right after a save or status is still detected', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.writeFile(path.join(dir, 'a'), 'v1'); await engine.save('one', author);
  await fsp.writeFile(path.join(dir, 'a'), 'v2');
  expect((await engine.status()).changed).toBe(1);
  await engine.save('two', author);
  await engine.status();
  await fsp.writeFile(path.join(dir, 'a'), 'v3');
  expect((await engine.status()).files).toEqual(['a']);
});

it('ignored directories are not walked and never reported', async () => {
  const dir = await tmp(); const engine = createEngine(dir);
  await fsp.mkdir(path.join(dir, 'node_modules/pkg'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'node_modules/pkg/index.js'), 'x');
  await fsp.mkdir(path.join(dir, 'src/pages'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'src/pages/index.astro'), 'hi');
  expect((await engine.status()).files.sort()).toEqual(['.gitignore', 'src/pages/index.astro']);
});

// Real projects symlink node_modules to the app's shared runtime deps; `node_modules/` (dir-only)
// would not match the symlink and it would be committed + pushed.
it('a symlinked node_modules is never part of a version', async () => {
  const dir = await tmp(); const deps = await tmp();
  await fsp.symlink(deps, path.join(dir, 'node_modules'));
  await fsp.writeFile(path.join(dir, 'index.astro'), 'hi');
  const engine = createEngine(dir);
  expect((await engine.status()).files.sort()).toEqual(['.gitignore', 'index.astro']);
});

it('an imported project .gitignore keeps its lines and gains the runtime entries it lacks', async () => {
  const dir = await tmp();
  await fsp.writeFile(path.join(dir, '.gitignore'), '.env\ndist/\n');
  await fsp.mkdir(path.join(dir, '.sq')); await fsp.writeFile(path.join(dir, '.sq/x'), '');
  await fsp.writeFile(path.join(dir, 'a'), '1');
  const engine = createEngine(dir);
  expect((await engine.status()).files.sort()).toEqual(['.gitignore', 'a']);
  const lines = (await fsp.readFile(path.join(dir, '.gitignore'), 'utf8')).split('\n');
  expect(lines.filter(l => l === 'dist/')).toHaveLength(1);
  expect(lines).toEqual(expect.arrayContaining(['.env', 'node_modules', '.sq/']));
});

// Owner live test 2026-10-18: a freshly imported project (status ran, nothing saved) showed an EMPTY branch dropdown in
// Versions — git has no branch ref until the first commit.
it('branches lists the current branch before the first version exists', async () => {
  const dir = await tmp(); await fsp.writeFile(path.join(dir, 'a'), '1');
  const engine = createEngine(dir);
  await engine.status(); // initializes the repo, as the panel does
  expect(await engine.branches()).toEqual(['main']);
});
