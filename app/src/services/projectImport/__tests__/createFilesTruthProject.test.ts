import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/db';
import { readProjectFiles } from '@/db/projectFiles';
import { isLocalProjectId, unmarkFilesTruth, discoverPagesFromPaths } from '@/utils/localMode';
import {
  importFilesTruthProject, createScaffoldProject, deleteFilesTruthData, stripPickedFolder, validateAstroFolder, SCAFFOLD_FILES,
} from '../createFilesTruthProject';

const enc = (s: string) => new TextEncoder().encode(s);
const PKG = '{"dependencies":{"astro":"^4"}}';

beforeEach(async () => { await db.delete(); await db.open(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

async function addExistingProject(): Promise<void> {
  const now = new Date();
  await db.projects.add({ id: 'existing', name: 'Existing', pagesTree: [], createdAt: now, updatedAt: now });
}

function filesTruthIdentityKeys(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith('sq:files-truth:'));
}

describe('importFilesTruthProject', () => {
  it('copies the folder in as-is (picked-folder prefix stripped, skip-dirs dropped), row flagged, id marked', async () => {
    const r = await importFilesTruthProject([
      { path: 'site/package.json', content: enc(PKG) },
      { path: 'site/astro.config.mjs', content: enc('export default {}') },
      { path: 'site/src/pages/index.astro', content: enc('<h1/>') },
      { path: 'site/public/a.png', content: new Uint8Array([1, 2]) },
      { path: 'site/node_modules/x/index.js', content: enc('no') },
      { path: 'site/.git/HEAD', content: enc('no') },
      { path: 'site/dist/out.html', content: enc('no') },
    ], 'My Site');
    expect(r.fileCount).toBe(4);
    expect(r.skipped).toBe(3);
    const files = await readProjectFiles(r.projectId);
    expect(Object.keys(files).sort()).toEqual(['astro.config.mjs', 'package.json', 'public/a.png', 'src/pages/index.astro']);
    expect(files['src/pages/index.astro']).toBe('<h1/>');
    const row = await db.projects.get(r.projectId);
    expect(row).toMatchObject({ name: 'My Site', filesTruth: true, pagesTree: [] });
    expect(isLocalProjectId(r.projectId)).toBe(true);
    unmarkFilesTruth(r.projectId);
  });

  it("refuses a non-Astro folder with the host validator's reasons; nothing written", async () => {
    await expect(importFilesTruthProject([{ path: 'x/README.md', content: enc('#') }], 'n')).rejects.toThrow(/No package.json/);
    await expect(importFilesTruthProject([{ path: 'x/package.json', content: enc('{"dependencies":{"react":"1"}}') }], 'n')).rejects.toThrow(/astro is not a dependency/);
    await expect(importFilesTruthProject([{ path: 'x/../etc', content: enc('') }], 'n')).rejects.toThrow(/traversal/);
    expect(await db.projects.count()).toBe(0);
    expect(await db.projectFiles.count()).toBe(0);
  });

  it('rolls back the project row and identity when file persistence fails', async () => {
    await addExistingProject();
    vi.spyOn(db.projectFiles, 'bulkPut').mockRejectedValueOnce(new Error('quota'));

    await expect(importFilesTruthProject([
      { path: 'site/package.json', content: enc(PKG) },
      { path: 'site/src/pages/index.astro', content: enc('<h1/>') },
    ], 'Failed import')).rejects.toThrow('quota');

    expect((await db.projects.toArray()).map((project) => project.id)).toEqual(['existing']);
    expect(await db.projectFiles.count()).toBe(0);
    expect(filesTruthIdentityKeys()).toEqual([]);
  });

  it.each([
    ['absolute', '/site/package.json'],
    ['drive', 'C:/site/package.json'],
    ['traversal', 'site/../package.json'],
    ['empty component', 'site//package.json'],
    ['NUL', 'site/package\0.json'],
  ])('rejects %s destinations before persistence', async (_kind, path) => {
    await expect(importFilesTruthProject([
      { path, content: enc(PKG) },
    ], 'Unsafe')).rejects.toThrow();
    expect(await db.projects.count()).toBe(0);
    expect(await db.projectFiles.count()).toBe(0);
  });

  it('rejects duplicate normalized destinations before persistence', async () => {
    await expect(importFilesTruthProject([
      { path: 'site/package.json', content: enc(PKG) },
      { path: 'site\\package.json', content: enc(PKG) },
    ], 'Duplicate')).rejects.toThrow(/duplicate/i);
    expect(await db.projects.count()).toBe(0);
    expect(await db.projectFiles.count()).toBe(0);
  });

  it('rejects drive-relative Windows destinations', async () => {
    await expect(importFilesTruthProject([
      { path: 'C:package.json', content: enc(PKG) },
    ], 'Drive path')).rejects.toThrow(/absolute/i);
    expect(await db.projects.count()).toBe(0);
  });

  it('stripPickedFolder only strips when every entry shares ONE root segment', () => {
    expect(stripPickedFolder([{ path: 'a/x', content: enc('') }, { path: 'a/y/z', content: enc('') }]).map((e) => e.path)).toEqual(['x', 'y/z']);
    expect(stripPickedFolder([{ path: 'a/x', content: enc('') }, { path: 'b/y', content: enc('') }]).map((e) => e.path)).toEqual(['a/x', 'b/y']);
    expect(validateAstroFolder([{ path: 'package.json', content: enc('{') }])).toEqual({ ok: false, reason: 'Unreadable package.json', code: 'unreadable-package' });
  });
});

describe('createScaffoldProject', () => {
  it('writes a clean minimal Astro project (nothing of ours) that the page walk sees as one home page', async () => {
    const id = await createScaffoldProject('Fresh');
    const files = await readProjectFiles(id);
    expect(Object.keys(files).sort()).toEqual(Object.keys(SCAFFOLD_FILES).sort());
    expect(files['astro.config.mjs']).not.toMatch(/sq-source-plugin|__sq|adapter/);
    expect(JSON.parse(files['package.json'] as string).dependencies.astro).toBeDefined();
    expect(discoverPagesFromPaths(Object.keys(files))).toEqual([{ route: '/', file: 'src/pages/index.astro', editable: true }]);
    // Owner ruling 2026-09-16: a new project is EMPTY — no layout, no copy.
    expect(Object.keys(files).some((f) => f.startsWith('src/layouts/'))).toBe(false);
    expect(files['src/pages/index.astro']).toMatch(/<body><\/body>/);
    expect(files['src/pages/index.astro']).not.toMatch(/Hello|<main|import /);
    expect((await db.projects.get(id))?.filesTruth).toBe(true);
    await deleteFilesTruthData(id);
    expect(await db.projectFiles.where('projectId').equals(id).count()).toBe(0);
    expect(isLocalProjectId(id)).toBe(false);
  });

  it('rolls back the project row and identity when scaffold persistence fails', async () => {
    await addExistingProject();
    vi.spyOn(db.projectFiles, 'bulkPut').mockRejectedValueOnce(new Error('quota'));

    await expect(createScaffoldProject('Fresh')).rejects.toThrow('quota');

    expect((await db.projects.toArray()).map((project) => project.id)).toEqual(['existing']);
    expect(await db.projectFiles.count()).toBe(0);
    expect(filesTruthIdentityKeys()).toEqual([]);
  });
});
