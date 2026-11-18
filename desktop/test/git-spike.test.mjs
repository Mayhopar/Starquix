// Pins the isomorphic-git merge behavior the pull/Mine-Theirs flow depends on (D3).
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';

const dirs = [];
const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-git-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fsp.rm(d, { recursive: true, force: true }))); });
const author = { name: 't', email: 't@t' };
async function commitFile(dir, file, text, message) {
  await fsp.writeFile(path.join(dir, file), text);
  await git.add({ fs, dir, filepath: file });
  return git.commit({ fs, dir, message, author });
}

it('merge with abortOnConflict:false reports per-file conflicts and keeps clean merges', async () => {
  const dir = await tmp();
  await git.init({ fs, dir, defaultBranch: 'main' });
  await commitFile(dir, 'a.txt', 'base\n', 'base');
  await commitFile(dir, 'b.txt', 'base\n', 'base b');
  await git.branch({ fs, dir, ref: 'theirs' });
  await commitFile(dir, 'a.txt', 'mine\n', 'mine a');
  await git.checkout({ fs, dir, ref: 'theirs' });
  await commitFile(dir, 'a.txt', 'theirs\n', 'theirs a');
  await commitFile(dir, 'c.txt', 'new\n', 'theirs c');
  await git.checkout({ fs, dir, ref: 'main' });
  let error;
  try { await git.merge({ fs, dir, ours: 'main', theirs: 'theirs', abortOnConflict: false, author }); }
  catch (e) { error = e; }
  expect(error?.code).toBe('MergeConflictError');
  expect(error.data.filepaths).toEqual(['a.txt']);
  expect(fs.existsSync(path.join(dir, 'c.txt'))).toBe(true); // clean side merged into workdir
});
