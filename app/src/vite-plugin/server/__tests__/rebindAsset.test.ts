// task-142 data-aware image swap: rebind = new file next to the bound asset,
// content refs repointed, binding survives. Regression: astro <Image> images
// were unswappable (node_modules attribution → no source location).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { rebindLocalAsset, rebindToExisting, repointContentRefs, resolveBoundAsset } from '../../project-fs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-rebind-'));
  mkdirSync(path.join(dir, 'src/content/works/images/Petcube'), { recursive: true });
  writeFileSync(path.join(dir, 'src/content/works/images/Petcube/old.png'), 'OLDBYTES');
  writeFileSync(path.join(dir, 'src/content/works/Petcube.mdx'), [
    '---',
    'title: Petcube Tracker',
    'image: ./images/Petcube/old.png',
    '---',
    'Body with ![inline](./images/Petcube/old.png) too.',
    'Unrelated: ./images/Other/old.png stays.',
  ].join('\n'));
  mkdirSync(path.join(dir, 'src/content/works/images/Other'), { recursive: true });
  writeFileSync(path.join(dir, 'src/content/works/images/Other/old.png'), 'OTHER');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const OLD = 'src/content/works/images/Petcube/old.png';

describe('rebindLocalAsset', () => {
  it('writes the new file next to the old one and repoints only resolving refs', async () => {
    const r = await rebindLocalAsset(dir, OLD, 'new photo.jpg', Buffer.from('NEWBYTES'));
    expect(r.newAsset).toBe('src/content/works/images/Petcube/new_photo.jpg');
    expect(readFileSync(path.join(dir, r.newAsset), 'utf8')).toBe('NEWBYTES');
    const mdx = readFileSync(path.join(dir, 'src/content/works/Petcube.mdx'), 'utf8');
    expect(mdx).toContain('image: ./images/Petcube/new_photo.jpg');
    expect(mdx).toContain('![inline](./images/Petcube/new_photo.jpg)');
    // same basename, different directory — must NOT be touched
    expect(mdx).toContain('./images/Other/old.png');
    expect(r.updatedFiles).toEqual(['src/content/works/Petcube.mdx']);
  });

  it('accepts the absolute (bridge-decoded /@fs) form of the old asset', async () => {
    const abs = path.join(dir, OLD);
    const r = await rebindLocalAsset(dir, abs, 'n.png', Buffer.from('X'));
    expect(r.updatedFiles.length).toBe(1);
  });

  it('no reference found → error and no orphan file left', async () => {
    const orphan = 'src/content/works/images/Other/old.png'; // exists but unreferenced-by-resolution? it IS referenced textually
    // craft a truly unreferenced asset
    writeFileSync(path.join(dir, 'src/content/works/images/Petcube/lonely.png'), 'L');
    await expect(
      rebindLocalAsset(dir, 'src/content/works/images/Petcube/lonely.png', 'n.png', Buffer.from('X')),
    ).rejects.toThrow(/no content reference/);
    expect(existsSync(path.join(dir, 'src/content/works/images/Petcube/n.png'))).toBe(false);
    void orphan;
  });

  it('refuses assets outside src/ (public, node_modules, traversal)', () => {
    expect(() => resolveBoundAsset(dir, 'public/uploads/a.png')).toThrow(/outside src/);
    expect(() => resolveBoundAsset(dir, 'src/node_modules/x/a.png')).toThrow(/outside src/);
    expect(() => resolveBoundAsset(dir, '../elsewhere/a.png')).toThrow(/outside src/);
  });
});

describe('rebindToExisting (undo/redo)', () => {
  it('round-trips: swap then repoint back restores the original refs', async () => {
    const before = readFileSync(path.join(dir, 'src/content/works/Petcube.mdx'), 'utf8');
    const r = await rebindLocalAsset(dir, OLD, 'n.png', Buffer.from('X'));
    await rebindToExisting(dir, r.newAsset, OLD);
    const after = readFileSync(path.join(dir, 'src/content/works/Petcube.mdx'), 'utf8');
    expect(after).toBe(before);
  });

  it('refuses cross-directory repoints', async () => {
    await expect(
      rebindToExisting(dir, OLD, 'src/content/works/images/Other/old.png'),
    ).rejects.toThrow(/share a directory/);
  });
});

describe('repointContentRefs token boundary', () => {
  it('does not corrupt longer filenames containing the old basename', async () => {
    writeFileSync(path.join(dir, 'src/content/works/images/Petcube/old.png.bak'), 'B');
    writeFileSync(path.join(dir, 'src/content/works/Extra.mdx'),
      'backup: ./images/Petcube/old.png.bak\nreal: ./images/Petcube/old.png\n');
    const updated = await repointContentRefs(dir, path.join(dir, OLD), 'fresh.png');
    const extra = readFileSync(path.join(dir, 'src/content/works/Extra.mdx'), 'utf8');
    expect(extra).toContain('./images/Petcube/old.png.bak');
    expect(extra).toContain('real: ./images/Petcube/fresh.png');
    expect(updated).toContain('src/content/works/Extra.mdx');
  });
});
