/** Shared read/transform/write serialization for every writer of a user's file:
 *  source CAS, HMR writes, and the sq-project-fs writers. */
import { realpathSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
const tails = new Map();
function canonicalPath(file) {
  try { return realpathSync(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(file);
    if (parent === file) throw error;
    return join(canonicalPath(parent), basename(file));
  }
}
export function withSourceFileLock(file, work) {
  file = canonicalPath(file);
  const previous = tails.get(file) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  tails.set(file, current);
  const clear = () => { if (tails.get(file) === current) tails.delete(file); };
  void current.then(clear, clear);
  return current;
}
/** Several files at once. Locks are taken in ONE order (sorted canonical paths),
 *  so two multi-file holders never wait on each other in a cycle. */
export function withSourceFileLocks(files, work) {
  const [first, ...rest] = [...new Set(files.map(canonicalPath))].sort();
  return first === undefined ? Promise.resolve().then(() => work()) : withSourceFileLock(first, () => withSourceFileLocks(rest, work));
}
