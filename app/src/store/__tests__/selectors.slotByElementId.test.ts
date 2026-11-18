/**
 * task-040 — selectSlotNamesByElementId returns a Map<elementId, slotName>
 * for the current page, reading slotName off each Yjs element. Feeds the
 * synthetic layout-node slot grouping in the Layers tree.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { selectSlotNamesByElementId } from '../selectors';
import { emptyClassData } from '../types';

const PAGE_ID = 'page-slot-by-id';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Test');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

describe('selectSlotNamesByElementId', () => {
  it('maps each element with a slotName, omitting those without one', () => {
    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-nav', pageId: PAGE_ID, parentId: null, index: 0,
          type: 'component', instanceType: 'local', componentType: 'Nav',
          slotName: 'sidebar', classes: emptyClassData(),
          staticMarkup: '<nav></nav>', astroSource: 'x', classOverrides: {},
        },
      });
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-hero', pageId: PAGE_ID, parentId: null, index: 1,
          type: 'component', instanceType: 'local', componentType: 'Hero',
          classes: emptyClassData(),
          staticMarkup: '<section></section>', astroSource: 'x', classOverrides: {},
        },
      });
    }, 'sync');

    const map = selectSlotNamesByElementId(doc, PAGE_ID);
    expect(map.get('el-nav')).toBe('sidebar');
    expect(map.has('el-hero')).toBe(false);
  });

  it('returns an empty map for an unknown page', () => {
    const doc = setupDoc();
    expect(selectSlotNamesByElementId(doc, 'no-such-page').size).toBe(0);
  });
});
