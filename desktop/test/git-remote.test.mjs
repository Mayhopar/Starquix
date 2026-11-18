import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { createEngine } from '../src/git/engine.mjs';
import { bareRepo, startGitServer } from './helpers/git-server.mjs';

const dirs = [];
const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-git-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fsp.rm(d, { recursive: true, force: true }))); });
const author = { name: 'Starquix', email: 'noreply@starquix.app' };
let root; let server;
beforeAll(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-remote-')); server = await startGitServer(root); });
afterAll(async () => { await server.close(); await fsp.rm(root, { recursive: true, force: true }); });
const remoteUrl = () => server.url(bareRepo(root, `r${Math.random().toString(36).slice(2)}`));
const write = (dir, f, t) => fsp.writeFile(path.join(dir, f), t);

it('push publishes; a second clone is behind; push from behind is rejected as "behind"', async () => {
  const url = remoteUrl();
  const dirA = await tmp(); const A = createEngine(dirA, { http });
  await write(dirA, 'a', '1'); await A.save('one', author);
  expect(await A.remote()).toBe(null);
  await A.setRemote(url);
  expect(await A.remote()).toBe(url);
  expect(await A.counts()).toEqual({ ahead: 1, behind: 0 });
  await A.push();
  expect(await A.counts()).toEqual({ ahead: 0, behind: 0 });

  const dirB = await tmp();
  await git.clone({ fs, http, dir: dirB, url, singleBranch: true });
  const B = createEngine(dirB, { http });
  await write(dirB, 'b', 'from B'); await B.save('two (B)', author); await B.push();

  await write(dirA, 'a', '2'); await A.save('three (A)', author);
  await expect(A.push()).rejects.toMatchObject({ message: 'Pull first', code: 'behind' });
  await A.fetchRemote();
  expect(await A.counts()).toEqual({ ahead: 1, behind: 1 });
});

const read = (dir, f) => fsp.readFile(path.join(dir, f), 'utf8');
/** A published with a.txt + b.txt; B is a clone of it. */
async function pair() {
  const url = remoteUrl();
  const dirA = await tmp(); const A = createEngine(dirA, { http });
  await write(dirA, 'a.txt', 'base\n'); await write(dirA, 'b.txt', 'base\n');
  await A.save('base', author); await A.setRemote(url); await A.push();
  const dirB = await tmp();
  await git.clone({ fs, http, dir: dirB, url, singleBranch: true });
  return { dirA, A, dirB, B: createEngine(dirB, { http }) };
}
/** B and A both edit a.txt; B also adds c.txt and pushes; A pulls. */
async function conflicted() {
  const p = await pair();
  await write(p.dirB, 'a.txt', 'theirs\n'); await write(p.dirB, 'c.txt', 'new\n');
  await p.B.save('B edits', author); await p.B.push();
  await write(p.dirA, 'a.txt', 'mine\n'); await p.A.save('A edits', author);
  const theirs = (await p.B.history())[0].oid;
  return { ...p, theirs, result: await p.A.pull(author) };
}

it('pull fast-forwards when only the remote moved (adds, edits and deletes land on disk)', async () => {
  const { dirA, A, dirB, B } = await pair();
  await write(dirB, 'a.txt', 'remote\n'); await write(dirB, 'c.txt', 'new\n'); await fsp.rm(path.join(dirB, 'b.txt'));
  await B.save('remote', author); await B.push();
  expect(await A.pull(author)).toEqual({ conflicts: [] });
  expect(await read(dirA, 'a.txt')).toBe('remote\n');
  expect(await read(dirA, 'c.txt')).toBe('new\n');
  expect(fs.existsSync(path.join(dirA, 'b.txt'))).toBe(false);
  expect((await A.status()).changed).toBe(0);
  expect(await A.counts()).toEqual({ ahead: 0, behind: 0 });
});

it('pull merges non-conflicting divergent work into a two-parent version', async () => {
  const { dirA, A, dirB, B } = await pair();
  await write(dirB, 'b.txt', 'remote b\n'); await B.save('B', author); await B.push();
  await write(dirA, 'a.txt', 'local a\n'); await A.save('A', author);
  expect(await A.pull(author)).toEqual({ conflicts: [] });
  expect(await read(dirA, 'a.txt')).toBe('local a\n');
  expect(await read(dirA, 'b.txt')).toBe('remote b\n');
  expect((await A.history())[0].parents).toHaveLength(2);
  expect((await A.status()).changed).toBe(0);
  await A.push();
});

it('pull with a conflict: files listed, Mine pre-applied (no markers), clean side merged', async () => {
  const { dirA, A, result, theirs } = await conflicted();
  expect(result).toEqual({ conflicts: ['a.txt'] });
  expect(await read(dirA, 'a.txt')).toBe('mine\n');
  expect(await read(dirA, 'c.txt')).toBe('new\n');
  expect(await A.mergeState()).toMatchObject({ theirs, files: { 'a.txt': 'mine' } });
});

it('resolve theirs + finish creates a two-parent merge version that pushes', async () => {
  const { dirA, A } = await conflicted();
  await A.resolve('a.txt', 'theirs');
  expect(await read(dirA, 'a.txt')).toBe('theirs\n');
  await A.finish(author);
  const [top] = await A.history();
  expect(top.parents).toHaveLength(2);
  expect(await A.mergeState()).toBe(null);
  expect((await A.status()).changed).toBe(0);
  await A.push();
});

it('abort restores the pre-pull tree', async () => {
  const { dirA, A } = await conflicted();
  await A.abort();
  expect(await read(dirA, 'a.txt')).toBe('mine\n');
  expect(fs.existsSync(path.join(dirA, 'c.txt'))).toBe(false);
  expect(await A.mergeState()).toBe(null);
  expect((await A.status()).changed).toBe(0);
});

it('merge state survives a new engine instance (app restart)', async () => {
  const { dirA } = await conflicted();
  const again = createEngine(dirA, { http });
  expect(await again.mergeState()).toMatchObject({ files: { 'a.txt': 'mine' } });
  await again.resolve('a.txt', 'theirs'); await again.finish(author);
  expect(await again.mergeState()).toBe(null);
});

it('save/switch/restore/push/discard/createBranch/pull are refused while merging', async () => {
  const { A } = await conflicted();
  const v = (await A.history())[0].oid;
  for (const call of [() => A.save('x', author), () => A.switchBranch('main'), () => A.restore(v, author),
    () => A.push(), () => A.discard(), () => A.createBranch('x'), () => A.pull(author)]) {
    await expect(call()).rejects.toMatchObject({ code: 'merging' });
  }
  expect(await A.status()).toMatchObject({ merging: true, conflicts: { 'a.txt': 'mine' } });
});

it('resolve rejects a file that is not conflicted', async () => {
  const { A } = await conflicted();
  await expect(A.resolve('b.txt', 'theirs')).rejects.toThrow('Not a conflicted file');
});

// e2e G2: a git op that rewrote UNCHANGED files touched astro.config.mjs → the project's `astro dev`
// restarted mid-merge and the editor lost its instance. Ops must only write files whose content changes.
describe('disk-rewriting ops never touch unchanged files', () => {
  const OLD = new Date('2001-01-01T00:00:00Z');
  const pin = dir => fsp.utimes(path.join(dir, 'b.txt'), OLD, OLD);
  const untouched = async dir => expect((await fsp.stat(path.join(dir, 'b.txt'))).mtimeMs).toBe(OLD.getTime());

  it('pull (fast-forward) + pull (merge)', async () => {
    const { dirA, A, dirB, B } = await pair();
    await write(dirB, 'a.txt', 'remote\n'); await B.save('r', author); await B.push();
    await pin(dirA); await A.pull(author); await untouched(dirA);
    await write(dirB, 'c.txt', 'c\n'); await B.save('r2', author); await B.push();
    await write(dirA, 'd.txt', 'd\n'); await A.save('local', author);
    await pin(dirA); await A.pull(author); await untouched(dirA);
  });
  it('pull with conflict, resolve, finish', async () => {
    const p = await pair();
    await write(p.dirB, 'a.txt', 'theirs\n'); await p.B.save('B', author); await p.B.push();
    await write(p.dirA, 'a.txt', 'mine\n'); await p.A.save('A', author);
    await pin(p.dirA);
    await p.A.pull(author); await untouched(p.dirA);
    await p.A.resolve('a.txt', 'theirs'); await p.A.finish(author); await untouched(p.dirA);
  });
  it('abort', async () => {
    const p = await pair();
    await write(p.dirB, 'a.txt', 'theirs\n'); await p.B.save('B', author); await p.B.push();
    await write(p.dirA, 'a.txt', 'mine\n'); await p.A.save('A', author);
    await p.A.pull(author); await pin(p.dirA); await p.A.abort(); await untouched(p.dirA);
  });
  it('restore, switchBranch, discard', async () => {
    const dir = await tmp(); const E = createEngine(dir, { http });
    await write(dir, 'a.txt', '1'); await write(dir, 'b.txt', 'same'); const v1 = await E.save('one', author);
    await write(dir, 'a.txt', '2'); await E.save('two', author);
    await pin(dir); await E.restore(v1, author); await untouched(dir);
    await E.createBranch('x'); await write(dir, 'a.txt', '3'); await E.save('x', author);
    await pin(dir); await E.switchBranch('main'); await untouched(dir);
    await write(dir, 'a.txt', 'dirty'); await pin(dir); await E.discard(); await untouched(dir);
  });
});

// docs/plans/2026-10-20-publish-branch-selection-design.md R11: isomorphic-git's deleteRemote keeps refs/remotes/origin/*, so
// after "Use another repository" every other branch still compared itself with the OLD repo (its counts, its pushes).
it('R11. removeRemote also drops the old repository\'s tracking refs: every branch starts unpushed on the next repo', async () => {
  const dir = await tmp(); const E = createEngine(dir, { http });
  await write(dir, 'a', '1'); await E.save('one', author);
  await E.setRemote(remoteUrl()); await E.push();
  await E.createBranch('feature'); await write(dir, 'a', '2'); await E.save('two', author); await E.push();
  expect((await git.listBranches({ fs, dir, remote: 'origin' })).sort()).toEqual(['feature', 'main']);
  await E.removeRemote();
  expect(await E.remote()).toBe(null);
  expect(await git.listBranches({ fs, dir, remote: 'origin' })).toEqual([]);
  await E.setRemote(remoteUrl());
  expect(await E.counts()).toEqual({ ahead: 2, behind: 0 });
});
