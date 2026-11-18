import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjects, projectDirFor, renameFolder, seedPathFor } from '../src/projects.mjs';
const roots = [];
async function root() { const p = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-projects-')); roots.push(p); return p; }
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });

it('uses native separators and rejects traversal, reserved names and runtime seeds', async () => {
  const r = await root();
  expect(projectDirFor(r, 'browser_abc-1')).toBe(path.join(r, 'browser_abc-1'));
  expect(seedPathFor(path.join(r, 'p'), 'src/pages/index.astro')).toBe(path.join(r, 'p', 'src', 'pages', 'index.astro'));
  for (const id of ['', '..', '../x', 'a/b', 'a\\b', 'CON', 'nul']) expect(() => projectDirFor(r, id)).toThrow();
  for (const rel of ['../x', '/x', 'C:\\x', 'a\\..\\x', 'src/../../x', 'node_modules/x', '.sq/x', '.git/x', 'a:stream', 'a./b']) {
    expect(() => seedPathFor(path.join(r, 'p'), rel)).toThrow();
  }
});
it('never publishes a partially written project; retry copies every byte', async () => {
  const r = await root(); let writes = 0;
  const projects = createProjects(r, { writeFile: async (...args) => {
    if (++writes === 2) throw new Error('injected disk failure');
    return fs.writeFile(...args);
  } });
  const files = { 'src/pages/index.astro': '<h1>complete</h1>', 'public/a.bin': new Uint8Array([0, 255]) };
  await expect(projects.seed('p', files)).rejects.toThrow('injected');
  expect(await projects.exists('p')).toBe(false);
  expect(await fs.readdir(r)).toEqual([]);
  await projects.seed('p', files);
  expect(await projects.snapshot('p')).toEqual({
    'src/pages/index.astro': new Uint8Array(Buffer.from('<h1>complete</h1>')),
    'public/a.bin': new Uint8Array([0, 255]),
  });
});
it('serializes duplicate seeds and preserves the published project', async () => {
  const projects = createProjects(await root());
  const [a, b] = await Promise.all([projects.seed('p', { 'a.txt': 'first' }), projects.seed('p', { 'a.txt': 'second' })]);
  expect(a).toBe(b);
  expect(Buffer.from((await projects.snapshot('p'))['a.txt']).toString()).toBe('first');
});
it('cancels before publication and refuses a foreign directory', async () => {
  const r = await root(); const projects = createProjects(r);
  const c = new AbortController(); c.abort();
  await expect(projects.seed('p', { 'a.txt': 'x' }, c.signal)).rejects.toThrow();
  expect(await projects.exists('p')).toBe(false);
  await fs.mkdir(path.join(r, 'p'));
  await expect(projects.seed('p', { 'a.txt': 'x' })).rejects.toThrow('Uninitialized');
});
it('refuses a project id that is a link to an outside directory', async () => {
  const r = await root(); const outside = await root();
  await fs.mkdir(path.join(outside, '.sq')); await fs.writeFile(path.join(outside, '.sq/seed-complete.json'), '{"version":1}');
  await fs.symlink(outside, path.join(r, 'p'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(createProjects(r).exists('p')).rejects.toThrow('owned directory');
});
it('serial is exported: git ops on one project run one at a time, other projects do not wait', async () => {
  const projects = createProjects(await root()); const order = [];
  let release; const gate = new Promise(r => { release = r; });
  const a1 = projects.serial('a', async () => { await gate; order.push('a1'); });
  const a2 = projects.serial('a', async () => { order.push('a2'); });
  await projects.serial('b', async () => { order.push('b'); });
  release(); await Promise.all([a1, a2]);
  expect(order).toEqual(['b', 'a1', 'a2']);
});
it('snapshot and read: agent-private folders stay out, symlinks are skipped not followed (an agent can make one)', async () => {
  const r = await root(); const outside = await root(); const projects = createProjects(r);
  await projects.seed('p', { 'src/pages/index.astro': 'x', 'CLAUDE.md': 'notes' });
  const dir = projectDirFor(r, 'p');
  for (const d of ['.claude', '.codex', '.opencode']) { await fs.mkdir(path.join(dir, d)); await fs.writeFile(path.join(dir, d, 's.json'), '{}'); }
  await fs.writeFile(path.join(outside, 'secret'), 's');
  await fs.symlink(outside, path.join(dir, 'src/linked'), 'dir');
  await fs.symlink(path.join(outside, 'secret'), path.join(dir, 'public-secret'));
  expect(Object.keys(await projects.snapshot('p')).sort()).toEqual(['CLAUDE.md', 'src/pages/index.astro']);
  const read = await projects.read('p', ['src/linked/secret', 'public-secret', '.claude/s.json', 'node_modules/x', '../x', 'src/pages/index.astro', 'src/gone.md']);
  expect(Object.keys(read.files)).toEqual(['src/pages/index.astro']);
  expect(read.gone).toEqual(['src/gone.md']);
});
it('read: a changed folder returns every file under it (a moved-in folder fires one event)', async () => {
  const r = await root(); const projects = createProjects(r);
  await projects.seed('p', { 'src/pages/index.astro': 'x' });
  const blog = path.join(projectDirFor(r, 'p'), 'src/content/blog');
  await fs.mkdir(blog, { recursive: true }); await fs.writeFile(path.join(blog, 'a.md'), 'a'); await fs.writeFile(path.join(blog, 'b.md'), 'b');
  expect(Object.keys((await projects.read('p', ['src/content/blog'])).files).sort()).toEqual(['src/content/blog/a.md', 'src/content/blog/b.md']);
});
it('read: a path whose folder became a file is gone and the rest of the burst survives', async () => {
  const r = await root(); const projects = createProjects(r);
  await projects.seed('p', { 'a': 'file now', 'b.md': 'b' });
  const read = await projects.read('p', ['a/old.md', 'a/deep/old.md', 'b.md']);
  expect(Object.keys(read.files)).toEqual(['b.md']);
  expect(read.gone).toEqual(['a/old.md', 'a/deep/old.md']);
});
it('read: what an agent deletes mid-read is gone or left out and the rest of the burst survives', async () => {
  const r = await root(); const projects = createProjects(r);
  await projects.seed('p', { 'keep.md': 'k', 'tmp.md': 't', 'blog/a.md': 'a', 'blog/tmp.md': 't', 'old/x.md': 'x' });
  const enoent = () => Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));
  const { readFile, readdir } = fs;
  const files = vi.spyOn(fs, 'readFile').mockImplementation((p, ...rest) => (/tmp\.md$/.test(p) ? enoent() : readFile(p, ...rest)));
  const dirs = vi.spyOn(fs, 'readdir').mockImplementation((p, ...rest) => (/old$/.test(p) ? enoent() : readdir(p, ...rest)));
  try {
    const read = await projects.read('p', ['keep.md', 'tmp.md', 'blog', 'old']);
    expect(Object.keys(read.files).sort()).toEqual(['blog/a.md', 'keep.md']);
    expect(read.gone).toEqual(['tmp.md']);
  } finally { files.mockRestore(); dirs.mockRestore(); }
});

// Windows port (2026-11-10): an antivirus scan of the files just seeded can refuse the folder rename for a moment.
describe('renameFolder', () => {
  const busy = code => Object.assign(new Error(`${code}: rename`), { code });
  it('Windows: a briefly busy folder is retried until the rename lands; elsewhere the first refusal is the answer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-rename-'));
    const from = path.join(root, 'stage'); await fs.mkdir(from); await fs.writeFile(path.join(from, 'a.txt'), 'x');
    const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(busy('EPERM')).mockRejectedValueOnce(busy('EBUSY'));
    try {
      await renameFolder(from, path.join(root, 'site'), 'win32');
      expect(spy).toHaveBeenCalledTimes(3);
      expect(await fs.readFile(path.join(root, 'site', 'a.txt'), 'utf8')).toBe('x');
      spy.mockRejectedValueOnce(busy('EPERM'));
      await expect(renameFolder(path.join(root, 'site'), path.join(root, 'again'), 'darwin')).rejects.toThrow(/EPERM/);
      spy.mockRejectedValueOnce(busy('ENOSPC'));
      await expect(renameFolder(path.join(root, 'site'), path.join(root, 'again'), 'win32')).rejects.toThrow(/ENOSPC/);
    } finally { spy.mockRestore(); await fs.rm(root, { recursive: true, force: true }); }
  });
});
