/**
 * Windows port (2026-11-10): the snapshot version is a hash of its files; a directory listing's order differs by OS
 * (APFS code-unit order vs NTFS case-insensitive), so Windows computed another version for the same files and
 * `build-snapshot.js --check` called the committed snapshot stale. The version is over the paths in code-unit order.
 */
import { describe, it, expect } from 'vitest';
import { computeSnapshotVersion } from '../snapshot-shared';

describe('computeSnapshotVersion', () => {
  it('the same files give the same version in any listing order (NTFS order, a patched map with an added file)', () => {
    const files = { 'README.md': 'cg==', 'astro.config.mjs': 'YQ==', 'src/pages/index.astro': 'aQ==' };
    const ntfs = { 'astro.config.mjs': 'YQ==', 'README.md': 'cg==', 'src/pages/index.astro': 'aQ==' };
    expect(computeSnapshotVersion(ntfs)).toBe(computeSnapshotVersion(files));
    expect(computeSnapshotVersion({ ...files, 'public/a.css': 'Yg==' })).toBe(computeSnapshotVersion({ 'public/a.css': 'Yg==', ...files }));
    expect(computeSnapshotVersion({ ...files, 'README.md': 'eA==' })).not.toBe(computeSnapshotVersion(files));
  });
});
