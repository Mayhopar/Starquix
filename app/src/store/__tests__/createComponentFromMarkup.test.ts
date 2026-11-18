// task-121: createComponentFromMarkup — library component from raw HTML (AI path).
// Save-first / doc-second: a failed save must leave the doc untouched.
// Durable contract (fdd2d12f): the library file is written through
// acceptFileChanges (src/components/library/<category>/<Name>.astro) in the
// same acceptance as the doc insert — no POST /__sq/save-component.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { applyCommand } from '@/store/commands';
import { createEditorDoc } from '@/store/createEditorDoc';
import { createComponentFromMarkup } from '@/store/instanceLifecycle';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';

const emptyClasses = () => ({ base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] });

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

function seedDoc(): Y.Doc {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
  return doc;
}

describe('createComponentFromMarkup (task-121)', () => {
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`unexpected fetch ${url}`); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.delete(); await db.open();
    projectId = `browser_markup_${crypto.randomUUID()}`;
    runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main />' });
  });
  afterEach(() => { runtime.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('saves stripped markup and appends an instance at page root', async () => {
    const doc = seedDoc();
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'feature tile',
      staticMarkup: '<section data-key="x" data-sq-id="y" class="p-4">hi</section>',
      existingNames: [], takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(true);
    expect(r.componentName).toBe('FeatureTile');
    await flushDurableSourceWritesThrough(projectId, 1);
    const source = runtime.read('src/components/library/FeatureTile.astro');
    expect(source).toContain('class="p-4"');
    expect(source).not.toMatch(/data-key|data-sq-id/);
    const inst = doc.getMap('elements').get(r.instanceId!) as Y.Map<unknown>;
    expect(inst.get('instanceType')).toBe('theme');
    expect(inst.get('componentPath')).toBe('FeatureTile.astro');
    expect(inst.get('parentId')).toBe(null);
  });

  it('passes category through to the library folder (task-122)', async () => {
    const doc = seedDoc();
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: '<div>x</div>',
      existingNames: [], category: 'Marketing', takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(true);
    const inst = doc.getMap('elements').get(r.instanceId!) as Y.Map<unknown>;
    expect(inst.get('componentPath')).toBe('marketing/Tile.astro');
    await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read('src/components/library/marketing/Tile.astro')).toBe('<div>x</div>');
  });

  it('rejects a non-word category before any write (task-122)', async () => {
    const doc = seedDoc();
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: '<div>x</div>',
      existingNames: [], category: 'My Folder!', takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/single word/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('dedupes the name against existingNames', async () => {
    const doc = seedDoc();
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'FeatureTile', staticMarkup: '<div>x</div>',
      existingNames: ['FeatureTile'], takeSnapshot: vi.fn(),
    });
    expect(r.componentName).toBe('FeatureTile2');
  });

  it('replaceElementId: swaps the element for the instance at same parent/index', async () => {
    const doc = seedDoc();
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-old', pageId: 'page-1', parentId: null, index: 0, type: 'frame', staticMarkup: '<section>old</section>', classes: emptyClasses() } });
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: '<section>new</section>',
      existingNames: [], replaceElementId: 'el-old', takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(true);
    expect(doc.getMap('elements').has('el-old')).toBe(false);
    const inst = doc.getMap('elements').get(r.instanceId!) as Y.Map<unknown>;
    expect(inst.get('index')).toBe(0);
  });

  it('replaceElementId not found → ok:false, doc untouched', async () => {
    const doc = seedDoc();
    const before = doc.getMap('elements').size;
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: '<div>x</div>',
      existingNames: [], replaceElementId: 'nope', takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found/i);
    expect(doc.getMap('elements').size).toBe(before);
  });

  it('replaceElementId is an instance → refused', async () => {
    const doc = seedDoc();
    applyCommand(doc, { type: 'ADD_THEME_INSTANCE', element: { id: 'inst-1', pageId: 'page-1', parentId: null, index: 0, type: 'instance', instanceType: 'theme', themeId: 'Hero', componentPath: 'Hero.astro', staticMarkup: '<div/>', classes: emptyClasses() } } as never);
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: '<div>x</div>',
      existingNames: [], replaceElementId: 'inst-1', takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/instance|layout/i);
  });

  it('file save refused (conflicting file on disk) → ok:false, NO doc mutation', async () => {
    mkdirSync(join(runtime.root, 'src/components/library'), { recursive: true });
    writeFileSync(join(runtime.root, 'src/components/library/Tile.astro'), '<main>Existing</main>');
    const doc = seedDoc();
    const before = doc.getMap('elements').size;
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: '<div>x</div>',
      existingNames: [], takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).not.toMatch(/different project|not ready/);
    expect(doc.getMap('elements').size).toBe(before);
    expect(runtime.read('src/components/library/Tile.astro')).toBe('<main>Existing</main>');
  });

  it('markup without an element root → refused before any write', async () => {
    const doc = seedDoc();
    const r = await createComponentFromMarkup({
      doc, currentPageId: 'page-1', name: 'Tile', staticMarkup: 'just text',
      existingNames: [], takeSnapshot: vi.fn(),
    });
    expect(r.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(join(runtime.root, 'src/components/library'))).toBe(false);
  });
});
