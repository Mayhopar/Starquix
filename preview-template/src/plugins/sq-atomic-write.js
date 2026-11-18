/**
 * THE way a user's file is replaced: sibling temp + rename, in ONE place.
 *
 * PLAIN JS and in the plugin dir on purpose: the writers run inside the
 * instance's `astro dev`, which gets only the plugin dir's `.js` files
 * (desktop/src/instance.mjs SQ_FILES) — no TypeScript build step.
 */
import { renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

// Windows: an antivirus or indexer scan of the fresh temp file can refuse the rename for a moment (EPERM/EACCES/EBUSY);
// retry briefly (~2.5 s in all), as Vite and graceful-fs do. Elsewhere a rename never needs it.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
export function renameReplacing(from, to, platform = process.platform) {
  for (let wait = 10; ; wait *= 2) {
    try { return renameSync(from, to); } catch (error) {
      if (platform !== 'win32' || !BUSY.has(error?.code) || wait > 1280) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait); // sync on purpose: the writers are sync
    }
  }
}

/** Suffix of the temp file the atomic write goes through. */
export const TMP_SUFFIX = '.sq-stamp-tmp';

/** Remove a temp file, ignoring failure — it is inert either way. */
export function discardTmp(tmp) {
  try {
    unlinkSync(tmp);
  } catch {
    /* the temp file is inert; leaving it is better than throwing here */
  }
}

/**
 * Replace (or create) ONE file in a single step: the bytes go to a sibling temp
 * file that is then renamed over the target. A crash or a full disk mid-write
 * leaves the old bytes, never a torn file that matches neither CAS state
 * (source-command, audit 2026-10-18). The caller owns containment and locking.
 */
export function writeFileAtomic(abs, data, encoding = 'utf8') {
  const tmp = `${abs}${TMP_SUFFIX}`;
  let mode;
  try { mode = statSync(abs).mode; } catch { /* a new file */ }
  try {
    writeFileSync(tmp, data, { encoding, mode });
    renameReplacing(tmp, abs);
  } catch (error) {
    discardTmp(tmp);
    throw error;
  }
}
