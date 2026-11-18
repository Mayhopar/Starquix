import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';
import { addRootAt, insertTemplateComponents, rootInsertIndex } from '../pageTemplateInsert';
import { buildAddCommand } from '../addCommandFactory';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const comp = (name: string): ScannedComponent => ({
  name,
  path: `src/components/library/${name}.astro`,
  source: 'built-in',
  html: `<section>${name}</section>`,
  category: 'Test',
  props: [],
  slots: [],
  dependencies: [],
});

function docWithPage() {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
  return doc;
}

describe('insertTemplateComponents', () => {
  it('adds all components as flat roots in preset order', async () => {
    const doc = docWithPage();
    let n = 0;
    const { addedIds, blogSlotIds } = await insertTemplateComponents({
      doc, pageId: 'page-1',
      components: [comp('Header'), comp('Hero'), comp('Footer')],
      generateId: () => `new-${n++}`,
    });
    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    const roots = (page.get('rootElementIds') as Y.Array<string>).toArray();
    expect(roots).toEqual(addedIds);
    expect(addedIds).toEqual(['new-0', 'new-1', 'new-2']);
    expect(blogSlotIds).toEqual([]);
    for (const id of addedIds) {
      const el = doc.getMap('elements').get(id) as Y.Map<unknown>;
      expect(el.get('parentId') ?? null).toBeNull(); // flat roots, never nested
    }
  });

  it('reports BlogSlot element ids so the caller can open the collection picker', async () => {
    const doc = docWithPage();
    let n = 0;
    const { blogSlotIds } = await insertTemplateComponents({
      doc, pageId: 'page-1',
      components: [comp('Header'), comp('BlogSlot')],
      generateId: () => `new-${n++}`,
    });
    expect(blogSlotIds).toEqual(['new-1']);
  });

  it('appends after existing roots (replace-deletes happen in the caller first)', async () => {
    const doc = docWithPage();
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'kept', pageId: 'page-1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<div>kept</div>' } as never });
    let n = 0;
    await insertTemplateComponents({ doc, pageId: 'page-1', components: [comp('CTA')], generateId: () => `new-${n++}` });
    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['kept', 'new-0']);
  });
});

describe('addRootAt', () => {
  // Regression (task-105 live smoke): ADD_ELEMENT pushes roots and IGNORES
  // element.index, so insert-after-selection silently appended at the end.
  // addRootAt must land the new root at the requested position.
  it('places the new root at the requested middle index, not at the end', async () => {
    const doc = docWithPage();
    for (const [i, id] of ['a', 'b'].entries()) {
      applyCommand(doc, { type: 'ADD_ELEMENT', element: { id, pageId: 'page-1', parentId: null, index: i, type: 'instance', classes: emptyClassData(), staticMarkup: `<div>${id}</div>` } as never });
    }
    await addRootAt(doc, buildAddCommand({
      elementId: 'mid', pageId: 'page-1', component: comp('CTA'),
      parentId: null, index: 1,
    }), 'page-1', 'mid', 1);
    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['a', 'mid', 'b']);
  });

  it('append index is a no-op reposition', async () => {
    const doc = docWithPage();
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'a', pageId: 'page-1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<div>a</div>' } as never });
    await addRootAt(doc, buildAddCommand({
      elementId: 'end', pageId: 'page-1', component: comp('CTA'),
      parentId: null, index: 1,
    }), 'page-1', 'end', 1);
    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['a', 'end']);
  });
});

describe('rootInsertIndex', () => {
  it('inserts after the selected root', async () => {
    expect(rootInsertIndex(['a', 'b', 'c'], 'b')).toBe(2);
  });
  it('appends at end when nothing is selected', async () => {
    expect(rootInsertIndex(['a'], null)).toBe(1);
  });
  it('appends at end when the selection is not a root (child or source-scanned key)', async () => {
    expect(rootInsertIndex(['a', 'b'], 'not-a-root')).toBe(2);
  });
});
