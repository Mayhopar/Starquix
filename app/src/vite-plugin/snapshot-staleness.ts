/**
 * Pure staleness primitives for astro-snapshot.json.
 *
 * Why: edits to preview-template/ made while the host dev server is DOWN
 * (agent/CLI sessions, git pull, branch switch) never reach the snapshot —
 * the SnapshotPatcher watcher only sees future events. configureServer runs
 * these checks at startup and rebuilds via scripts/build-snapshot.js when
 * stale. See docs/archive/plans/2026-06-10-snapshot-dx-design.md.
 */
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { SKIP_DIR_NAMES, SNAPSHOT_IGNORE_RE } from './snapshot-shared';

/** Max mtimeMs of every snapshot-eligible file under rootDir, or null if none. */
export async function maxSourceMtimeMs(rootDir: string): Promise<number | null> {
  let max: number | null = null;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing/unreadable dir → contributes nothing
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (SNAPSHOT_IGNORE_RE.test(full.split(path.sep).join('/'))) continue;
      try {
        const st = await stat(full);
        if (max === null || st.mtimeMs > max) max = st.mtimeMs;
      } catch {
        // deleted mid-walk — ignore
      }
    }
  }

  await walk(rootDir);
  return max;
}

/** Pure comparison. null source mtime = nothing to snapshot; null snapshot mtime = missing snapshot. */
export function isSnapshotStale(
  maxSourceMtime: number | null,
  snapshotMtime: number | null,
): boolean {
  if (maxSourceMtime === null) return false;
  if (snapshotMtime === null) return true;
  return maxSourceMtime > snapshotMtime;
}

/**
 * The dev iframe runs preview-template/public/scripts/bridge.js, NOT the TS
 * parts — editing parts/*.ts alone does nothing in dev. Used by index.ts to
 * print a loud reminder (design doc, gap G3).
 */
export function isBridgePartsFile(filePath: string): boolean {
  const norm = filePath.split(path.sep).join('/');
  return /\/src\/bridge\/parts\/[^/]+\.ts$/.test(norm) && !norm.includes('__tests__');
}
