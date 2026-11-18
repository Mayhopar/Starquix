import { createHash } from 'crypto';

export interface Snapshot {
  version: string;
  files: Record<string, string>; // base64-encoded
}

export const SKIP_DIR_NAMES = new Set(['.git', '.astro', 'dist', 'node_modules', '__tests__']);

/**
 * Editor-swap, OS metadata, and source-map files churn fast and aren't
 * meaningful snapshot content. Shared by the watcher filter (index.ts),
 * the staleness walker (snapshot-staleness.ts) and scripts/build-snapshot.js.
 *
 * `.sq-folders.json` is the Assets-panel folder manifest. It lives next to the
 * library components but is EDITOR metadata, not preview code — the iframe
 * never reads it. Without this, every folder drag raised a false "preview code
 * changed on disk — reload the editor" toast and churned the snapshot version.
 */
export const SNAPSHOT_IGNORE_RE = /(?:^|\/)(?:\.DS_Store|\.sq-folders\.json|.+\.swp|.+\.swo|.+~|.+\.tmp|.+\.map|4913)$/;

/** Over the paths in code-unit order: a directory listing's order differs by OS (APFS vs NTFS) and an added file
 *  lands last in a patched map — the same files must give the same version everywhere (scripts/build-snapshot.js). */
export function computeSnapshotVersion(files: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHash('md5').update(JSON.stringify(sorted)).digest('hex').slice(0, 12);
}
