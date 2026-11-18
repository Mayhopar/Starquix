import { describe, it, expect } from 'vitest';
import { writeLocalAsset, listLocalAssets, resolveLocalAssetFile } from '../project-fs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scaffold = (): string => mkdtempSync(join(tmpdir(), 'sq-asset-'));

function mediaScaffold(): string {
  const dir = scaffold();
  mkdirSync(join(dir, 'public', 'sub'), { recursive: true });
  mkdirSync(join(dir, 'src', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'public', 'a.png'), 'a');
  writeFileSync(join(dir, 'public', 'sub', 'b.jpg'), 'b');
  writeFileSync(join(dir, 'public', 'CV.pdf'), 'pdf');
  writeFileSync(join(dir, 'public', 'clip.mp4'), 'v');
  writeFileSync(join(dir, 'src', 'assets', 'c.svg'), '<svg/>');
  writeFileSync(join(dir, 'public', '.DS_Store'), 'junk');
  return dir;
}

describe('listLocalAssets (review: task-135 second half)', () => {
  it('lists public/** with served URLs and src/assets/** as import-based (url null)', () => {
    const items = listLocalAssets(mediaScaffold());
    expect(items).toContainEqual(expect.objectContaining({ url: '/a.png', file: 'public/a.png', kind: 'image' }));
    expect(items).toContainEqual(expect.objectContaining({ url: '/sub/b.jpg', file: 'public/sub/b.jpg', kind: 'image' }));
    expect(items).toContainEqual(expect.objectContaining({ file: 'src/assets/c.svg', url: null, kind: 'image' }));
    expect(items.find(i => i.file === 'public/CV.pdf')?.kind).toBe('file');
    expect(items.find(i => i.file === 'public/clip.mp4')?.kind).toBe('video');
    expect(items.some(i => i.file.includes('.DS_Store'))).toBe(false);
  });

  it('returns [] for a folder with no public/ or src/assets', () => {
    expect(listLocalAssets(scaffold())).toEqual([]);
  });
});

describe('resolveLocalAssetFile', () => {
  it('resolves files inside public/ and src/assets only', () => {
    const dir = mediaScaffold();
    expect(resolveLocalAssetFile(dir, 'public/a.png')).toBe(join(dir, 'public', 'a.png'));
    expect(resolveLocalAssetFile(dir, 'src/assets/c.svg')).toBe(join(dir, 'src', 'assets', 'c.svg'));
  });

  it('throws on traversal and on paths outside the asset roots', () => {
    const dir = mediaScaffold();
    expect(() => resolveLocalAssetFile(dir, 'public/../../../etc/passwd')).toThrow();
    expect(() => resolveLocalAssetFile(dir, 'src/pages/index.astro')).toThrow();
  });
});

describe('writeLocalAsset', () => {
  it('writes bytes into public/uploads and returns the served src', () => {
    const dir = scaffold();
    const { src } = writeLocalAsset(dir, 'hero.png', Buffer.from('png-bytes'));
    expect(src).toBe('/uploads/hero.png');
    expect(readFileSync(join(dir, 'public', 'uploads', 'hero.png'), 'utf8')).toBe('png-bytes');
  });

  it('suffixes on filename collision instead of overwriting', () => {
    const dir = scaffold();
    writeLocalAsset(dir, 'a.png', Buffer.from('first'));
    const { src } = writeLocalAsset(dir, 'a.png', Buffer.from('second'));
    expect(src).toBe('/uploads/a-1.png');
    expect(readFileSync(join(dir, 'public', 'uploads', 'a.png'), 'utf8')).toBe('first');
    expect(readFileSync(join(dir, 'public', 'uploads', 'a-1.png'), 'utf8')).toBe('second');
  });

  it('sanitizes the filename and strips path traversal', () => {
    const dir = scaffold();
    const { src } = writeLocalAsset(dir, '../../my photo (1).png', Buffer.from('x'));
    expect(src).toBe('/uploads/my_photo_1_.png');
    expect(readFileSync(join(dir, 'public', 'uploads', 'my_photo_1_.png'), 'utf8')).toBe('x');
  });

  it('falls back to a stem when the name is empty', () => {
    const dir = scaffold();
    const { src } = writeLocalAsset(dir, '', Buffer.from('x'));
    expect(src).toBe('/uploads/asset');
  });
});
