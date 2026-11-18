import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../index';
import {
  putProjectFiles, readProjectFiles, writeProjectFile, deleteProjectFile,
  deleteAllProjectFiles, listProjectFilePaths, isTextPath,
} from '../projectFiles';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const enc = (s: string) => new TextEncoder().encode(s);

describe('projectFiles (files-truth store)', () => {
  it('put + read round-trips text as string and binary as bytes (mountFiles shape)', async () => {
    await putProjectFiles('p1', [
      { path: 'src/pages/index.astro', content: enc('<h1>hi</h1>') },
      { path: 'public/logo.png', content: new Uint8Array([137, 80, 78, 71, 200]) },
    ]);
    const files = await readProjectFiles('p1');
    expect(files['src/pages/index.astro']).toBe('<h1>hi</h1>');
    expect(Array.from(files['public/logo.png'] as Uint8Array)).toEqual([137, 80, 78, 71, 200]);
    expect(await listProjectFilePaths('p1')).toEqual(['public/logo.png', 'src/pages/index.astro']);
  });

  // Audit 2026-10-18 (c): the first-open seed decoded every "text" row, so a
  // BOM vanished and an extensionless binary (isTextPath: "text") became U+FFFD.
  it('gives the desktop seed the exact bytes of every row', async () => {
    const rows = {
      'src/pages/index.astro': enc('\uFEFF<h1>Привет</h1>'),
      'public/fonts/brand': new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0xc3]),
      '.prettierrc': enc('{"semi":false}'),
    };
    await putProjectFiles('p1', Object.entries(rows).map(([path, content]) => ({ path, content })));
    const seed = await readProjectFiles('p1');
    for (const [path, bytes] of Object.entries(rows)) {
      const value = seed[path];
      expect(Array.from(typeof value === 'string' ? enc(value) : value), path).toEqual(Array.from(bytes));
    }
  });

  it('writeProjectFile upserts one path; deleteProjectFile removes it; other projects untouched', async () => {
    await putProjectFiles('p1', [{ path: 'a.txt', content: enc('1') }]);
    await putProjectFiles('p2', [{ path: 'a.txt', content: enc('other') }]);
    await writeProjectFile('p1', 'a.txt', enc('2'));
    await writeProjectFile('p1', 'b.txt', enc('3'));
    expect(await readProjectFiles('p1')).toEqual({ 'a.txt': '2', 'b.txt': '3' });
    await deleteProjectFile('p1', 'a.txt');
    expect(await readProjectFiles('p1')).toEqual({ 'b.txt': '3' });
    expect(await readProjectFiles('p2')).toEqual({ 'a.txt': 'other' });
  });

  it('deleteAllProjectFiles clears exactly one project', async () => {
    await putProjectFiles('p1', [{ path: 'a', content: enc('x') }, { path: 'b', content: enc('y') }]);
    await putProjectFiles('p2', [{ path: 'a', content: enc('z') }]);
    await deleteAllProjectFiles('p1');
    expect(await listProjectFilePaths('p1')).toEqual([]);
    expect(await listProjectFilePaths('p2')).toEqual(['a']);
  });

  it('normalizes paths (no leading ./ or /, posix separators)', async () => {
    await putProjectFiles('p1', [{ path: './src\\x.astro', content: enc('') }]);
    expect(await listProjectFilePaths('p1')).toEqual(['src/x.astro']);
  });

  it('isTextPath matches the snapshot loader rule', () => {
    expect(isTextPath('src/a.astro')).toBe(true);
    expect(isTextPath('public/a.png')).toBe(false);
    expect(isTextPath('.gitignore')).toBe(true);
    expect(isTextPath('fonts/x.woff2')).toBe(false);
  });
});
