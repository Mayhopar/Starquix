import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';

function makePageWithEl(doc: Y.Doc) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'p1', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-a', pageId: 'p1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>A</section>' } as never });
  return doc.getMap('elements').get('el-a') as Y.Map<unknown>;
}

describe('SET_ELEMENT_SLOT_NAME', () => {
  it('sets the element slotName', () => {
    const doc = createEditorDoc();
    const el = makePageWithEl(doc);
    applyCommand(doc, { type: 'SET_ELEMENT_SLOT_NAME', elementId: 'el-a', slotName: 'sidebar' });
    expect(el.get('slotName')).toBe('sidebar');
  });

  it('clears the slotName (back to default slot) when set to null or empty', () => {
    const doc = createEditorDoc();
    const el = makePageWithEl(doc);
    applyCommand(doc, { type: 'SET_ELEMENT_SLOT_NAME', elementId: 'el-a', slotName: 'sidebar' });
    applyCommand(doc, { type: 'SET_ELEMENT_SLOT_NAME', elementId: 'el-a', slotName: null });
    expect(el.get('slotName') ?? null).toBeNull();
  });

  it('is a no-op for an unknown element', () => {
    const doc = createEditorDoc();
    makePageWithEl(doc);
    const ok = applyCommand(doc, { type: 'SET_ELEMENT_SLOT_NAME', elementId: 'nope', slotName: 'x' });
    expect(ok).toBe(false);
  });
});
