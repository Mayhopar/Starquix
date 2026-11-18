// Publish into an existing repo (docs/plans/2026-10-18-publish-into-existing-repo-design.md E2/E3): which of GitHub's
// files the new version keeps. Pure; the preview (GitHub's REST tree) and the publish (the fetched tree) share it.

// Import's own skip list (app/src/services/projectImport/importValidation.ts isSkippedDir): the project never brings
// these in, so it can't mean to delete GitHub's copies.
const SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.vercel', '.netlify', '.output']);
export const unmanaged = path => path.split('/').some(p => SKIP.has(p) || p.startsWith('.'));
/** Never in the project folder: node_modules is a symlink to the shared runtime deps, .sq/ is ours, dist/ is build output. */
const dropKey = path => {
  const parts = path.split('/');
  return parts.includes('node_modules') ? 'node_modules' : parts[0] === '.sq' || parts[0] === 'dist' ? parts[0] : null;
};

/**
 * remote: GitHub's tip as flat entries `{ path, mode, type, oid }` (blobs, gitlinks; tree entries are ignored).
 * local: Map(path → oid) of the project's files as a save keeps them.
 * keep = GitHub's entries the new version carries over (GitHub's copy wins over the project's); every other GitHub path is
 * replaced by the project: `removed` lists GitHub-only ones, `dropped` counts the ones the folder can't hold.
 */
export function partition(remote, local) {
  const dirs = new Set([...local.keys()].flatMap(p => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const clashes = p => dirs.has(p) || p.split('/').slice(0, -1).some((_, i, a) => local.has(a.slice(0, i + 1).join('/')));
  const out = { keep: [], removed: [], dropped: {}, changed: 0, added: 0, submodules: false };
  const seen = new Set();
  for (const e of remote) {
    if (e.type === 'commit') { out.submodules = true; continue; }
    if (e.type !== 'blob') continue;
    seen.add(e.path);
    const drop = dropKey(e.path);
    if (drop) out.dropped[drop] = (out.dropped[drop] ?? 0) + 1;
    else if (!unmanaged(e.path)) {
      if (!local.has(e.path)) out.removed.push(e.path);
      else if (local.get(e.path) !== e.oid) out.changed++;
    } else if (e.mode === '120000' || e.path.split('/').some(p => p.toLowerCase() === '.git') || clashes(e.path)) out.removed.push(e.path);
    else out.keep.push(e);
  }
  for (const p of local.keys()) if (!seen.has(p)) out.added++;
  return out;
}

/** A .gitattributes that routes files through Git LFS: GitHub holds pointers, the project would hold the real bytes. */
export const lfs = text => /\bfilter\s*=\s*lfs\b/.test(text ?? '');
