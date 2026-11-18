import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';

function makePage(doc: Y.Doc, id: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id, name: 'Home', rootElementIds: [], children: [] } });
  return doc.getMap('pages').get(id) as Y.Map<unknown>;
}

describe('SET_PAGE_LAYOUT', () => {
  it('sets layoutName and layoutProps on the page', () => {
    const doc = createEditorDoc();
    const page = makePage(doc, 'page-1');
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'Marketing', layoutProps: { title: 'Hi' } });
    expect(page.get('layoutName')).toBe('Marketing');
    expect(page.get('layoutProps')).toEqual({ title: 'Hi' });
  });

  it('replacing a layout keeps content roots untouched (swap-keep-content)', () => {
    const doc = createEditorDoc();
    const page = makePage(doc, 'page-1');
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'el-a', pageId: 'page-1', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section>A</section>' } as never });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'X' });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'Y' });
    expect(page.get('layoutName')).toBe('Y');
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['el-a']);
  });

  it('detaches with layoutName=null (clears props too)', () => {
    const doc = createEditorDoc();
    const page = makePage(doc, 'page-1');
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'X', layoutProps: { title: 'T' } });
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: null });
    expect(page.get('layoutName') ?? null).toBeNull();
    expect(page.get('layoutProps') ?? null).toBeNull();
  });

  it('is a no-op for an unknown page', () => {
    const doc = createEditorDoc();
    const ok = applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'nope', layoutName: 'X' });
    expect(ok).toBe(false);
  });
});
