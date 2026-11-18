import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { maxSourceMtimeMs, isSnapshotStale, isBridgePartsFile } from './snapshot-staleness';

describe('isSnapshotStale', () => {
  it('is stale when a source file is newer than the snapshot', () => {
    expect(isSnapshotStale(2000, 1000)).toBe(true);
  });
  it('is fresh when the snapshot is newer than every source file', () => {
    expect(isSnapshotStale(1000, 2000)).toBe(false);
  });
  it('is fresh on equal mtimes (snapshot written after the last edit)', () => {
    expect(isSnapshotStale(1000, 1000)).toBe(false);
  });
  it('is stale when the snapshot file is missing', () => {
    expect(isSnapshotStale(1000, null)).toBe(true);
  });
  it('is fresh when there are no source files at all', () => {
    expect(isSnapshotStale(null, null)).toBe(false);
    expect(isSnapshotStale(null, 1000)).toBe(false);
  });
});

describe('maxSourceMtimeMs', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'snap-stale-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns the max mtime across nested files', async () => {
    await mkdir(path.join(root, 'src', 'layouts'), { recursive: true });
    const oldFile = path.join(root, 'package.json');
    const newFile = path.join(root, 'src', 'layouts', 'Layout.astro');
    await writeFile(oldFile, '{}');
    await writeFile(newFile, '<html />');
    await utimes(oldFile, new Date(1000_000), new Date(1000_000));
    await utimes(newFile, new Date(2000_000), new Date(2000_000));
    expect(await maxSourceMtimeMs(root)).toBe(2000_000);
  });

  it('skips SKIP_DIR_NAMES directories (node_modules etc.)', async () => {
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    const skipped = path.join(root, 'node_modules', 'x.js');
    const kept = path.join(root, 'a.txt');
    await writeFile(skipped, 'x');
    await writeFile(kept, 'a');
    await utimes(skipped, new Date(9000_000), new Date(9000_000));
    await utimes(kept, new Date(1000_000), new Date(1000_000));
    expect(await maxSourceMtimeMs(root)).toBe(1000_000);
  });

  // Regression 2026-08-09: the Assets folder manifest lives next to the library
  // components, so every folder drag raised a false "preview code changed on
  // disk — reload the editor" toast. It is editor metadata, not preview code.
  it('skips the Assets folder manifest (.sq-folders.json)', async () => {
    await mkdir(path.join(root, 'src', 'components', 'library'), { recursive: true });
    const manifest = path.join(root, 'src', 'components', 'library', '.sq-folders.json');
    const kept = path.join(root, 'a.txt');
    await writeFile(manifest, '{}');
    await writeFile(kept, 'a');
    await utimes(manifest, new Date(9000_000), new Date(9000_000));
    await utimes(kept, new Date(1000_000), new Date(1000_000));
    expect(await maxSourceMtimeMs(root)).toBe(1000_000);
  });

  it('skips churn files matched by the ignore regex (.DS_Store, *.map, vim swaps)', async () => {
    const churn = path.join(root, '.DS_Store');
    const kept = path.join(root, 'a.txt');
    await writeFile(churn, 'x');
    await writeFile(kept, 'a');
    await utimes(churn, new Date(9000_000), new Date(9000_000));
    await utimes(kept, new Date(1000_000), new Date(1000_000));
    expect(await maxSourceMtimeMs(root)).toBe(1000_000);
  });

  it('returns null for an empty or missing directory', async () => {
    expect(await maxSourceMtimeMs(path.join(root, 'does-not-exist'))).toBe(null);
    expect(await maxSourceMtimeMs(root)).toBe(null);
  });
});

describe('isBridgePartsFile', () => {
  it('matches TS files under src/bridge/parts', () => {
    expect(isBridgePartsFile('/repo/app/src/bridge/parts/dom-updates.ts')).toBe(true);
  });
  it('does not match tests, non-TS files, or other dirs', () => {
    expect(isBridgePartsFile('/repo/app/src/bridge/parts/__tests__/harness.ts')).toBe(false);
    expect(isBridgePartsFile('/repo/app/src/bridge/IFrameBridgeScript.ts')).toBe(false);
    expect(isBridgePartsFile('/repo/preview-template/public/scripts/bridge.js')).toBe(false);
  });
});
