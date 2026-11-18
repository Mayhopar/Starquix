// App-managed project folders: portable path guards, atomic first seed, disk snapshot, outside-edit reads.
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const absent = error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; };
/** Never mirrored into the editor (snapshot, outside-edit reads): tooling, our state, agent-private state. */
export const SKIP = new Set(['node_modules', '.sq', '.git', 'dist', '.claude', '.codex', '.opencode']);
export const skipped = rel => rel.split('/').some(p => SKIP.has(p));
/** A live shell can delete anything between two calls: null, never a throw that loses the whole burst. */
const bytesOf = async full => { const bytes = await fs.readFile(full).catch(absent); return bytes && new Uint8Array(bytes); };
async function readTree(dir, rel, files) {
  for (const entry of (await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(absent)) ?? []) {
    if (SKIP.has(entry.name)) continue;
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) console.warn(`[projects] skipped symlink ${name}`); // never followed
    else if (entry.isDirectory()) await readTree(dir, name, files);
    else if (entry.isFile()) { const bytes = await bytesOf(path.join(dir, name)); if (bytes) files[name] = bytes; }
  }
  return files;
}
/** Windows: an antivirus scan of the files just written can refuse a folder rename for a moment — retry briefly (~5 s). */
export async function renameFolder(from, to, platform = process.platform) {
  for (let wait = 10; ; wait *= 2) {
    try { return await fs.rename(from, to); } catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || wait > 2560) throw error;
      await delay(wait);
    }
  }
}
export function projectDirFor(root, id) {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || reserved.test(id)) throw new Error('Invalid project id');
  return path.join(path.resolve(root), id);
}
export function seedPathFor(dir, rel) {
  if (typeof rel !== 'string' || /[\\:\0]/.test(rel) || path.posix.isAbsolute(rel)
      || rel.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || reserved.test(p))
      || ['node_modules', '.sq', '.git'].includes(rel.split('/')[0])) throw new Error('Invalid seed path');
  return path.join(dir, ...rel.split('/'));
}
export function createProjects(root, { writeFile = fs.writeFile } = {}) {
  const lanes = new Map();
  function serial(id, work) {
    const run = (lanes.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    lanes.set(id, run);
    void run.finally(() => { if (lanes.get(id) === run) lanes.delete(id); }).catch(() => {});
    return run;
  }
  /** Published = a real directory carrying `.sq/seed-complete.json`. A bare
   *  directory is incomplete/foreign: refused, never overwritten. */
  async function exists(id) {
    const dir = projectDirFor(root, id);
    const stat = await fs.lstat(dir).catch(absent);
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Project must be an owned directory');
    const marker = await fs.readFile(path.join(dir, '.sq/seed-complete.json'), 'utf8').catch(absent);
    if (!marker || JSON.parse(marker).version !== 1) throw new Error('Uninitialized project directory');
    return true;
  }
  /** Stage → marker → rename. Atomic publication, not a power-loss durability claim. */
  async function seed(id, files, signal) {
    return serial(id, async () => {
      const dir = projectDirFor(root, id);
      signal?.throwIfAborted();
      if (await exists(id)) return dir;
      if (!files || !Object.keys(files).length) throw new Error('New project requires seed files');
      for (const [rel, bytes] of Object.entries(files)) {
        seedPathFor(dir, rel);
        if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) throw new Error('Invalid seed bytes');
      }
      await fs.mkdir(root, { recursive: true });
      const stage = await fs.mkdtemp(path.join(root, `.${id}-seed-`));
      try {
        for (const [rel, bytes] of Object.entries(files)) {
          signal?.throwIfAborted();
          const to = seedPathFor(stage, rel);
          await fs.mkdir(path.dirname(to), { recursive: true }); await writeFile(to, bytes);
        }
        await fs.mkdir(path.join(stage, '.sq'));
        await fs.writeFile(path.join(stage, '.sq/seed-complete.json'), '{"version":1}');
        signal?.throwIfAborted();
        await renameFolder(stage, dir);
        return dir;
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    });
  }
  async function snapshot(id) {
    if (!(await exists(id))) throw new Error('Project not found');
    return readTree(projectDirFor(root, id), '', {});
  }
  /** Outside edits: current bytes under the changed paths; a missing path is `gone` (its rows go). */
  async function read(id, rels) {
    const dir = projectDirFor(root, id); const real = await fs.realpath(dir); const files = {}; const gone = [];
    for (const rel of new Set(rels)) {
      if (typeof rel !== 'string' || /[\\\0]/.test(rel) || rel.split('/').some(p => !p || p === '.' || p === '..') || skipped(rel)) continue;
      const full = path.join(dir, rel);
      const parent = await fs.realpath(path.dirname(full)).catch(absent);
      if (parent && parent !== real && !parent.startsWith(real + path.sep)) continue; // under a symlinked folder
      const stat = await fs.lstat(full).catch(absent);
      if (stat?.isDirectory()) { await readTree(dir, rel, files); continue; }
      if (stat && !stat.isFile()) continue; // a symlink: never followed
      const bytes = stat && await bytesOf(full);
      if (bytes) files[rel] = bytes; else gone.push(rel);
    }
    return { files, gone };
  }
  return { exists, seed, snapshot, read, serial };
}
