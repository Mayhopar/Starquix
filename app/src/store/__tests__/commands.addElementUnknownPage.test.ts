// Regression: ADD_ELEMENT for a root element on a nonexistent page used to
// insert the element into the elements map BEFORE the page lookup, then
// silently `break` — leaving an invisible orphan while applyCommand reported
// success. add_page_content then told the AI "Content added to page" and
// nothing appeared on canvas.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import type { ClassData } from '../types';

const emptyClasses = (): ClassData => ({ base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] });

describe('ADD_ELEMENT unknown page', () => {
  it('returns false and inserts nothing for a root element on a missing page', () => {
    const doc = new Y.Doc();
    const applied = applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-1', pageId: 'no-such-page', parentId: null, index: 0,
        type: 'frame', classes: emptyClasses(),
      },
    });
    expect(applied).toBe(false);
    expect(doc.getMap('elements').has('el-1')).toBe(false);
  });

  it('inserts a root element at element.index in rootElementIds (render order)', () => {
    const doc = new Y.Doc();
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('rootElementIds', new Y.Array());
    doc.getMap('pages').set('page-1', page);
    for (const [id, index] of [['a', 0], ['b', 1]] as const) {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: { id, pageId: 'page-1', parentId: null, index, type: 'frame', classes: emptyClasses() },
      });
    }
    // Insert between a and b — the old code always PUSHED (…a, b, mid)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'mid', pageId: 'page-1', parentId: null, index: 1, type: 'frame', classes: emptyClasses() },
    });
    const rootIds = ((doc.getMap('pages').get('page-1') as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>).toArray();
    expect(rootIds).toEqual(['a', 'mid', 'b']);
  });

  it('clamps an out-of-range root index to append', () => {
    const doc = new Y.Doc();
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('rootElementIds', new Y.Array());
    doc.getMap('pages').set('page-1', page);
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'a', pageId: 'page-1', parentId: null, index: 99, type: 'frame', classes: emptyClasses() },
    });
    const rootIds = ((doc.getMap('pages').get('page-1') as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>).toArray();
    expect(rootIds).toEqual(['a']);
  });

  it('still succeeds for a root element on an existing page', () => {
    const doc = new Y.Doc();
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('rootElementIds', new Y.Array());
    doc.getMap('pages').set('page-1', page);
    const applied = applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-1', pageId: 'page-1', parentId: null, index: 0,
        type: 'frame', classes: emptyClasses(),
      },
    });
    expect(applied).toBe(true);
    expect(doc.getMap('elements').has('el-1')).toBe(true);
    expect((doc.getMap('pages').get('page-1') as Y.Map<unknown>).get('rootElementIds')).toBeDefined();
  });
});
