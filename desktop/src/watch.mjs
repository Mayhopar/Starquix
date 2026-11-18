// Agent multiplayer (owner 2026-11-08, docs/plans/2026-11-08-agent-multiplayer-design.md, ledger E): the open
// project's folder is watched for as long as it is open — an agent in the terminal, in another app or over MCP
// writes files, and the editor merges what it sees live. One watcher, owned by main (it was the terminal's).
import fs from 'node:fs';
import path from 'node:path';
import { skipped } from './projects.mjs';

const QUIET = '.astro'; // Astro rewrites it on every reload: syncing it would loop

/**
 * read(id, rels) → { files, gone } (projects.read); emit('disk-changed', id, { files, gone }).
 * Lifetime mirrors the session: keepOnly(id, dir) when a project (re)opens, release(id) when its session stops —
 * a reload or an instance recovery reopens it within the grace and keeps the same watcher.
 */
export function createWatchers({ read, emit, watch = fs.watch, debounceMs = 150, graceMs = 30_000 }) {
  const watched = new Map();

  function start(id, dir) {
    const s = { dir, watcher: null, pending: new Set(), flush: null, grace: null, retry: null };
    const flush = () => {
      const rels = [...s.pending]; s.pending.clear();
      read(id, rels).then(change => {
        if (watched.get(id) === s && (change.gone.length || Object.keys(change.files).length)) emit('disk-changed', id, change);
      }, error => console.error('[project watch]', error));
    };
    const attach = () => {
      if (watched.get(id) !== s) return;
      try {
        s.watcher = watch(dir, { recursive: true }, (_event, name) => {
          if (!name || watched.get(id) !== s) return; // shortcut: macOS FSEvents names every file; a nameless event waits for the next open's full mirror
          const rel = String(name).split(path.sep).join('/');
          if (skipped(rel) || rel.split('/').includes(QUIET)) return;
          s.pending.add(rel); clearTimeout(s.flush); s.flush = setTimeout(flush, debounceMs);
        });
        s.watcher.on('error', error => { console.error('[project watch]', error); s.watcher?.close(); s.watcher = null; });
      } catch (error) {
        // The session opens before an import seeds a new project's folder (ipc.mjs start → projects.seed): wait for it.
        if (error?.code === 'ENOENT') { s.retry = setTimeout(attach, 250); return; }
        console.error('[project watch]', error);
      }
    };
    watched.set(id, s);
    attach();
  }

  function stop(id) {
    const s = watched.get(id); if (!s) return;
    watched.delete(id); clearTimeout(s.flush); clearTimeout(s.grace); clearTimeout(s.retry); s.watcher?.close();
  }

  return {
    keepOnly(id, dir) {
      for (const other of [...watched.keys()]) if (other !== id) stop(other);
      const s = watched.get(id);
      if (s) clearTimeout(s.grace); else start(id, dir);
    },
    release(id) {
      const s = watched.get(id); if (!s) return;
      clearTimeout(s.grace); s.grace = setTimeout(() => stop(id), graceMs);
    },
    closeAll() { for (const id of [...watched.keys()]) stop(id); },
  };
}
