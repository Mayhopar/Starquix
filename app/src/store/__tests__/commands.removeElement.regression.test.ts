import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';

function makePage(doc: Y.Doc, id: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id, name: 'Home', rootElementIds: [], children: [] } });
  return doc.getMap('pages').get(id) as Y.Map<unknown>;
}

describe('REMOVE_ELEMENT still removes a root after helper extraction', () => {
  it('deletes the element and pops it from rootElementIds', () => {
    const doc = createEditorDoc();
    const page = makePage(doc, 'page-1');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-a', pageId: 'page-1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>A</section>' } as never });
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['el-a']);
    applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: 'el-a' });
    expect(doc.getMap('elements').get('el-a')).toBeUndefined();
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual([]);
  });
});
