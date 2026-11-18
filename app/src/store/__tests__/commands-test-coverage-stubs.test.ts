import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

function makeDrawnEl(
  doc: Y.Doc,
  id: string,
  pageId: string,
  parentId: string | null,
): void {
  const el = new Y.Map();
  el.set('id', id);
  el.set('pageId', pageId);
  el.set('parentId', parentId);
  el.set('isDrawn', true);
  el.set('staticMarkup', `<div id="${id}"></div>`);
  doc.getMap('elements').set(id, el);
}

function makeInstance(doc: Y.Doc, id: string, pageId: string): void {
  const el = new Y.Map();
  el.set('id', id);
  el.set('pageId', pageId);
  el.set('parentId', null);
  el.set('isDrawn', false);
  doc.getMap('elements').set(id, el);
}

describe('CLEAR_INSTANCE_DRAWN_ELEMENTS', () => {
  it('removes drawn descendants of the target instance, leaves everything else', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'page-1', name: 'P1', rootElementIds: [], children: [],
    }});
    applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'page-2', name: 'P2', rootElementIds: [], children: [],
    }});

    makeInstance(doc, 'inst-A', 'page-1');
    makeInstance(doc, 'inst-B', 'page-1');

    makeDrawnEl(doc, 'd-direct',     'page-1', 'inst-A');
    makeDrawnEl(doc, 'd-subkey',     'page-1', 'inst-A:section-0');
    makeDrawnEl(doc, 'd-other-inst', 'page-1', 'inst-B');
    makeDrawnEl(doc, 'd-other-page', 'page-2', 'inst-A');
    makeDrawnEl(doc, 'd-no-parent',  'page-1', null);

    applyCommand(doc, {
      type: 'CLEAR_INSTANCE_DRAWN_ELEMENTS',
      pageId: 'page-1',
      instanceId: 'inst-A',
    });

    const elements = doc.getMap('elements');
    expect(elements.has('d-direct')).toBe(false);
    expect(elements.has('d-subkey')).toBe(false);
    expect(elements.has('d-other-inst')).toBe(true);
    expect(elements.has('d-other-page')).toBe(true);
    expect(elements.has('d-no-parent')).toBe(true);
    expect(elements.has('inst-A')).toBe(true);
    expect(elements.has('inst-B')).toBe(true);
  });


});
