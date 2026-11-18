// @vitest-environment node
// Audit 2026-10-18 follow-up: Starquix's own writers rewrote the user's file IN
// PLACE and outside the source lock. A crash or a full disk mid-write left torn
// bytes; a write landing between a locked writer's read and its write was
// silently overwritten. Each now writes a sibling temp + rename, reading and
// writing under withSourceFileLock; component rename/move/delete take the lock.
// The residual writers followed: the folder manifest and component create go
// atomic. (The HMR socket write path is retired; the dead layout / post /
// write-files routes are deleted.)
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  mergeLocalFontCss, ensureLocalFontsLink, rebindLocalAsset, rebindToExisting, writeComponentDefaultImage,
  writeLocalFile, ensureSqComponent, renameComponentFile, moveComponentToSystemDir, deleteComponentFile,
  writeFolderManifest, createComponentFile,
} from '../../../../preview-template/src/plugins/sq-project-fs.js';
import { withSourceFileLock } from '../../../../preview-template/src/plugins/sq-file-write-lock.js';

const crash = vi.hoisted(() => ({
  file: '',
  /** Once, for the armed file or its temp: the write lands half its bytes, then the disk is full. */
  hits(target: unknown) {
    if (!this.file || ![this.file, `${this.file}.sq-stamp-tmp`].includes(String(target))) return false;
    this.file = '';
    return true;
  },
  enospc: () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }),
}));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    const [target, data] = args;
    if (!crash.hits(target)) return fs.writeFileSync(...args);
    const bytes = Buffer.from(data as string);
    fs.writeFileSync(target, bytes.subarray(0, bytes.length >> 1)); // half the bytes reached disk
    throw crash.enospc();
  } };
});
// An in-place async write (writeFile) tears the same way; the plugin imports 'fs/promises'.
const tearingPromises = vi.hoisted(() => async (importOriginal: () => Promise<unknown>) => {
  const fsp = await importOriginal() as typeof import('node:fs/promises');
  return { ...fsp, writeFile: async (...args: Parameters<typeof fsp.writeFile>) => {
    const [target, data] = args;
    if (!crash.hits(target)) return fsp.writeFile(...args);
    const bytes = Buffer.from(data as string);
    await fsp.writeFile(target, bytes.subarray(0, bytes.length >> 1));
    throw crash.enospc();
  } };
});
vi.mock('node:fs/promises', (importOriginal) => tearingPromises(importOriginal));
vi.mock('fs/promises', (importOriginal) => tearingPromises(importOriginal));

const FILES: Record<string, string> = {
  'package.json': '{"dependencies":{"@astrojs/mdx":"*"}}',
  'public/sq-fonts.css': '/* sq-font:Alpha start */\n@font-face{/*a*/}\n/* sq-font:Alpha end */\n',
  'src/layouts/Base.astro': '---\n---\n<html><head><title>Привет</title></head><body><slot /></body></html>\n',
  'src/content/works/a.md': '---\ntitle: Привет\nimage: ./images/old.png\n---\nBody\n',
  'src/content/works/images/old.png': 'OLD',
  'src/content/works/images/other.png': 'OTHER',
  'src/components/Card.astro': '---\nconst { src } = Astro.props;\n---\n<img src={src} alt="Привет" />\n',
  'src/assets/pic.png': 'PIC',
  'src/styles/sq-variables.css': ':root{--a:1}\n',
  'src/components/sq/Media.astro': '---\n---\n<figure>stale</figure>\n',
  'templates/Media.astro': '---\n// sq-media-v2\n---\n<figure>current</figure>\n',
  '.starquix/folders.json': '{"version":1,"roots":[],"folders":{}}\n',
};
let root: string;
const read = (file: string) => existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null;
const before = (file: string) => FILES[file] ?? null;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sq-writers-atomic-'));
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
});
afterEach(() => { crash.file = ''; rmSync(root, { recursive: true, force: true }); });

const writers: [string, string, () => unknown][] = [
  ['font css', 'public/sq-fonts.css', () => mergeLocalFontCss(root, 'Beta', '@font-face{/*b*/}')],
  ['font link', 'src/layouts/Base.astro', () => ensureLocalFontsLink(root)],
  ['image rebind', 'src/content/works/a.md', () => rebindLocalAsset(root, 'src/content/works/images/old.png', 'new.png', Buffer.from('NEW'))],
  ['rebind undo', 'src/content/works/a.md', () => rebindToExisting(root, 'src/content/works/images/old.png', 'src/content/works/images/other.png')],
  ['default image', 'src/components/Card.astro', () => writeComponentDefaultImage(root, 'src/components/Card.astro', 0, 'src/assets/pic.png')],
  ['text file', 'src/styles/sq-variables.css', () => writeLocalFile(root, 'src/styles/sq-variables.css', ':root{--a:2}\n')],
  ['sq component upgrade', 'src/components/sq/Media.astro', () => ensureSqComponent(root, 'Media', join(root, 'templates'))],
  ['folder manifest', '.starquix/folders.json', () => writeFolderManifest(join(root, '.starquix/folders.json'), { version: 1, roots: ['src'], folders: {} })],
  ['component create', 'src/components/Fresh.astro', () => createComponentFile(join(root, 'src/components'), 'Fresh', '<p>Привет</p>\n')],
];
const components = () => join(root, 'src/components');
const moves: [string, string, () => unknown][] = [
  ['component rename', 'src/components/Card.astro', () => renameComponentFile(components(), 'Card.astro', 'Tile')],
  ['component promote', 'src/components/Card.astro', () => moveComponentToSystemDir(components(), 'Card.astro', true)],
  ['component delete', 'src/components/Card.astro', () => deleteComponentFile(components(), 'Card.astro')],
];

it.each(writers)('%s: a write that dies halfway leaves the old bytes, then retries cleanly', async (_name, file, write) => {
  crash.file = join(root, file);
  await expect(Promise.resolve().then(write)).rejects.toThrow(/ENOSPC/);
  expect(read(file)).toBe(before(file));
  expect(readdirSync(dirname(join(root, file))).filter(name => name.endsWith('.sq-stamp-tmp'))).toEqual([]);
  await write();
  expect(read(file)).not.toBe(before(file));
});

it.each([...writers, ...moves])('%s: waits for the file\'s source lock', async (_name, file, write) => {
  let release!: () => void;
  const held = withSourceFileLock(join(root, file), () => new Promise<void>(resolve => { release = resolve; }));
  const writing = Promise.resolve().then(write);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(read(file)).toBe(before(file));
  release();
  await held;
  await writing;
  expect(read(file)).not.toBe(before(file));
});

it('reads under the lock: an edit the lock holder lands while it waits survives', async () => {
  const page = 'src/layouts/Base.astro';
  let release!: () => void;
  const held = withSourceFileLock(join(root, page), () => new Promise<void>(resolve => { release = resolve; }));
  const linking = ensureLocalFontsLink(root);
  await new Promise(resolve => setTimeout(resolve, 30));
  writeFileSync(join(root, page), FILES[page].replace('<title>', '<title>Edited '));
  release();
  await held;
  await linking;
  expect(read(page)).toContain('Edited');
  expect(read(page)).toContain('data-sq-fonts');
});

it('component create never overwrites another file of that name; the same bytes are a no-op', async () => {
  const card = 'src/components/Card.astro';
  await expect(createComponentFile(components(), 'Card', '<p>other</p>\n')).rejects.toMatchObject({ status: 409 });
  expect(read(card)).toBe(FILES[card]);
  await expect(createComponentFile(components(), 'Card', FILES[card])).resolves.toBe('Card.astro');
});
