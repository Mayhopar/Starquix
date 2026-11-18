import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { plainSlotToYMap } from '@/core/collections/yjsAccessors';
import type { ClassData } from '@/store/types';
import type { ScannedElement } from '@/context/SelectionContext';

vi.mock('../collectAssets', async (orig) => {
  const actual = await orig() as typeof import('../collectAssets');
  return {
    ...actual,
    collectAssets: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ assetId: id, mime: 'image/png', name: 'x.png', base64: 'AA' }))),
  };
});

import { captureSelection } from '../capture';
import { collectAssets } from '../collectAssets';

const makeClasses = (overrides: Partial<ClassData> = {}): ClassData => ({
  base: [], sm: [], md: [], lg: [], xl: [], '2xl': [], ...overrides,
});

function setupDoc(projectId = 'browser_test'): Y.Doc {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { id: 'page-1', name: 'P', rootElementIds: [], children: [] },
  });
  return doc;
}

const scanned = (key: string, tagName = 'div'): ScannedElement =>
  ({ key, tagName, classes: '' } as ScannedElement);

const fetchHtml = vi.fn(async (key: string) => `<div class="from-bridge">${key}</div>`);
beforeEach(() => { fetchHtml.mockClear(); (collectAssets as ReturnType<typeof vi.fn>).mockClear(); });

const baseDeps = (doc: Y.Doc, extra: Partial<Parameters<typeof captureSelection>[1]> = {}) => ({
  doc,
  scannedByKey: new Map<string, ScannedElement>(),
  fetchHtml,
  ...extra,
});

describe('captureSelection', () => {
  it('captures a drawn root as a parents-first subtree with html', async () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'drawn-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses() },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'drawn-2', pageId: 'page-1', parentId: 'drawn-1', index: 0, type: 'text', textContent: 'hi', classes: makeClasses() },
    });
    (doc.getMap('elements').get('drawn-1') as Y.Map<unknown>).set('isDrawn', true);
    (doc.getMap('elements').get('drawn-1') as Y.Map<unknown>).set('tag', 'div');
    (doc.getMap('elements').get('drawn-2') as Y.Map<unknown>).set('isDrawn', true);

    const env = await captureSelection(
      [{ key: 'drawn-1', elementId: 'drawn-1' }],
      baseDeps(doc),
    );
    expect(env).not.toBeNull();
    expect(env!.roots).toHaveLength(1);
    const root = env!.roots[0];
    expect(root.html).toContain('from-bridge');
    expect(root.doc?.kind).toBe('subtree');
    if (root.doc?.kind !== 'subtree') throw new Error('unreachable');
    expect(root.doc.elements.map(e => e.id)).toEqual(['drawn-1', 'drawn-2']);
    expect(root.doc.elements[0].extraFields?.isDrawn).toBe(true);
    expect(root.doc.elements[0].extraFields?.tag).toBe('div');
    expect(root.doc.elements[1].parentId).toBe('drawn-1');
  });

  it('captures an instance root with master + blogSlot', async () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-i1', pageId: 'page-1', parentId: null, index: 0, type: 'component',
        componentType: 'Hero', astroSource: 'library/Hero.astro',
        staticMarkup: '<section>hero</section>', classes: makeClasses(),
      },
    });
    doc.getMap('blogSlotBindings').set('el-i1', plainSlotToYMap({
      collectionId: 'col-1', settings: { limit: 3 }, bindings: { 'el-i1:h2-0': 'title' },
    }));

    const env = await captureSelection(
      [{ key: 'el-i1', elementId: 'el-i1' }],
      baseDeps(doc),
    );
    expect(env!.roots[0].doc?.kind).toBe('instance');
    const rootDoc = env!.roots[0].doc;
    if (rootDoc?.kind !== 'instance') throw new Error('unreachable');
    expect(rootDoc.element.id).toBe('el-i1');
    expect(rootDoc.blogSlot).toMatchObject({ collectionId: 'col-1' });
    expect(env!.masters).toHaveLength(1);
    expect(env!.masters[0]).toMatchObject({ astroSource: 'library/Hero.astro', componentType: 'Hero' });
    expect(env!.masters[0].markup).toContain('hero'); // staticMarkup fallback (no masters overlay entry)
    expect(env!.roots[0].html).toContain('from-bridge');
  });

  it('captures a source key as an html-only root', async () => {
    const doc = setupDoc();
    const key = 'src/pages/index.astro:5:1';
    const env = await captureSelection(
      [{ key, elementId: null }],
      baseDeps(doc, { scannedByKey: new Map([[key, scanned(key, 'section')]]) }),
    );
    expect(env!.roots).toHaveLength(1);
    expect(env!.roots[0].doc).toBeUndefined();
    expect(env!.roots[0].html).toContain('from-bridge');
    expect(env!.roots[0].label).toBe('section');
  });

  it('skips guarded entries but captures the rest (skip-not-abort)', async () => {
    const doc = setupDoc();
    // content-slot element
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'el-content', pageId: 'page-1', parentId: null, index: 0, type: 'component', classes: makeClasses() },
    });
    (doc.getMap('elements').get('el-content') as Y.Map<unknown>).set('bindingType', 'collection-content');
    const toast = vi.fn();
    const env = await captureSelection(
      [
        { key: 'src/pages/preview/[projectId]/[pageId].astro:10:1', elementId: null }, // wrapper
        { key: 'layoutchrome-page-1', elementId: null },                               // layout chrome
        { key: 'el-content:div-0', elementId: null },                                  // content slot
        { key: 'src/pages/index.astro:5:1', elementId: null },                         // real one
      ],
      baseDeps(doc, { toast }),
    );
    expect(env!.roots).toHaveLength(1);
    expect(env!.roots[0].html).toContain('index.astro');
  });

  it('resolves null when every entry is guarded', async () => {
    const doc = setupDoc();
    const env = await captureSelection(
      [{ key: 'layoutchrome-page-1', elementId: null }],
      baseDeps(doc),
    );
    expect(env).toBeNull();
  });

  it('collects sq-asset refs from classes and staticMarkup into envelope.assets', async () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'drawn-a', pageId: 'page-1', parentId: null, index: 0, type: 'frame',
        classes: makeClasses({ base: [`bg-[url('sq-asset:asset-cls')]`] }),
        staticMarkup: '<img src="sq-asset:asset-mk">',
      },
    });
    (doc.getMap('elements').get('drawn-a') as Y.Map<unknown>).set('isDrawn', true);
    const env = await captureSelection(
      [{ key: 'drawn-a', elementId: 'drawn-a' }],
      baseDeps(doc),
    );
    const ids = env!.assets.map(a => a.assetId).sort();
    expect(ids).toEqual(['asset-cls', 'asset-mk']);
  });

  it('embeds no assets for local_ projects', async () => {
    const doc = setupDoc('browser_lf_myfolder');
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'drawn-b', pageId: 'page-1', parentId: null, index: 0, type: 'frame',
        classes: makeClasses(), staticMarkup: '<img src="sq-asset:should-not-embed">',
      },
    });
    (doc.getMap('elements').get('drawn-b') as Y.Map<unknown>).set('isDrawn', true);
    const env = await captureSelection(
      [{ key: 'drawn-b', elementId: 'drawn-b' }],
      baseDeps(doc),
    );
    expect(env!.assets).toEqual([]);
    expect(collectAssets).not.toHaveBeenCalled();
  });
});
