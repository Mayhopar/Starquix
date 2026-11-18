// Dropping a layout must NOT reparent or mutate content roots. The association
// lives on the page (SET_PAGE_LAYOUT); content stays flat and scannable.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';

describe('layout drop (page-level model)', () => {
  it('ADD_ELEMENT no longer reparents existing roots when a layout-pathed element is added', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-content', pageId: 'page-1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>A</section>' } as never });

    // Applying the layout is now a page-level command, not an element insert.
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'Layout' });

    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    const roots = (page.get('rootElementIds') as Y.Array<string>).toArray();
    const elContent = doc.getMap('elements').get('el-content') as Y.Map<unknown>;
    expect(roots).toEqual(['el-content']);       // content stays a flat root
    expect(elContent.get('parentId') ?? null).toBeNull(); // never reparented
    expect(page.get('layoutName')).toBe('Layout');
  });
});
