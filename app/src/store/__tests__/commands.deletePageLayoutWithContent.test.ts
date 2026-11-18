import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';

function makePage(doc: Y.Doc, id: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id, name: 'Home', rootElementIds: [], children: [] } });
  return doc.getMap('pages').get(id) as Y.Map<unknown>;
}

describe('DELETE_PAGE_LAYOUT_WITH_CONTENT', () => {
  it('removes the layout association AND every root content element', () => {
    const doc = createEditorDoc();
    const page = makePage(doc, 'page-1');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-a', pageId: 'page-1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>A</section>' } as never });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-b', pageId: 'page-1', parentId: null, index: 1, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>B</section>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'Marketing', layoutProps: { title: 'T' } });

    applyCommand(doc, { type: 'DELETE_PAGE_LAYOUT_WITH_CONTENT', pageId: 'page-1' });

    expect(page.get('layoutName') ?? null).toBeNull();
    expect(page.get('layoutProps') ?? null).toBeNull();
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual([]);
    expect(doc.getMap('elements').get('el-a')).toBeUndefined();
    expect(doc.getMap('elements').get('el-b')).toBeUndefined();
  });

  it('is a no-op for an unknown page', () => {
    const doc = createEditorDoc();
    expect(applyCommand(doc, { type: 'DELETE_PAGE_LAYOUT_WITH_CONTENT', pageId: 'nope' })).toBe(false);
  });
});
