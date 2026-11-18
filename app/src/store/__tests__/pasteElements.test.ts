import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import type { ClassData } from '../types';

const emptyClasses = (): ClassData => ({ base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] });

function setupDoc(): Y.Doc {
  const doc = createEditorDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'P', rootElementIds: [], children: [] } });
  return doc;
}
const roots = (doc: Y.Doc) =>
  ((doc.getMap('pages').get('page-1') as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>).toArray();

describe('PASTE_ELEMENTS', () => {
  it('refuses a missing page', () => {
    const doc = setupDoc();
    expect(applyCommand(doc, { type: 'PASTE_ELEMENTS', pageId: 'nope', index: 0, masters: [], elements: [] })).toBe(false);
  });

  it('inserts roots at index in order and re-stamps staticMarkup under the new id', () => {
    const doc = setupDoc();
    // seed an existing root so index placement is observable
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'existing', pageId: 'page-1', parentId: null, index: 0, type: 'component', componentType: 'X', staticMarkup: '<div>x</div>', classes: emptyClasses() } });
    const ok = applyCommand(doc, {
      type: 'PASTE_ELEMENTS', pageId: 'page-1', index: 1, masters: [],
      elements: [
        { element: { id: 'p1', pageId: 'page-1', parentId: null, index: 1, type: 'component', componentType: 'Hero', staticMarkup: '<section><h1>t</h1></section>', classes: emptyClasses() } },
        { element: { id: 'p2', pageId: 'page-1', parentId: null, index: 2, type: 'component', componentType: 'Hero', staticMarkup: '<div>y</div>', classes: emptyClasses() } },
      ],
    });
    expect(ok).toBe(true);
    expect(roots(doc)).toEqual(['existing', 'p1', 'p2']);
    const markup = (doc.getMap('elements').get('p1') as Y.Map<unknown>).get('staticMarkup') as string;
    expect(markup).toContain('data-key="p1:');       // re-stamped under NEW id
  });

  it('writes children with parentId set, not into rootElementIds', () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'PASTE_ELEMENTS', pageId: 'page-1', index: 0, masters: [],
      elements: [
        { element: { id: 'root1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: emptyClasses() }, extraFields: { isDrawn: true, tag: 'div' } },
        { element: { id: 'kid1', pageId: 'page-1', parentId: 'root1', index: 0, type: 'text', textContent: 'hi', classes: emptyClasses() }, extraFields: { isDrawn: true, tag: 'p' } },
      ],
    });
    expect(roots(doc)).toEqual(['root1']);
    expect((doc.getMap('elements').get('kid1') as Y.Map<unknown>).get('parentId')).toBe('root1');
    expect((doc.getMap('elements').get('kid1') as Y.Map<unknown>).get('isDrawn')).toBe(true);
  });

  it('creates ONLY absent masters and never touches existing entries', () => {
    const doc = setupDoc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'library/Hero.astro', markup: '<div>orig</div>' });
    applyCommand(doc, {
      type: 'PASTE_ELEMENTS', pageId: 'page-1', index: 0,
      masters: [
        { astroSource: 'library/Hero.astro', markup: '<div>SHOULD BE IGNORED</div>' },
        { astroSource: 'library/New.astro', markup: '<div>new</div>' },
      ],
      elements: [],
    });
    const masters = doc.getMap('masters');
    expect((masters.get('library/Hero.astro') as Y.Map<unknown>).get('markup')).toContain('orig');
    expect(masters.has('library/New.astro')).toBe(true);
  });

  it('recreates a blogSlot scaffold under the new element id', () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'PASTE_ELEMENTS', pageId: 'page-1', index: 0, masters: [],
      elements: [{
        element: { id: 'slot1', pageId: 'page-1', parentId: null, index: 0, type: 'component', componentType: 'BlogSlot', staticMarkup: '<div/>', classes: emptyClasses() },
        blogSlot: { collectionId: 'col-1', settings: { limit: 3 }, bindings: { 'slot1:h2-0': 'title' } },
      }],
    });
    const slot = doc.getMap('blogSlotBindings').get('slot1') as Y.Map<unknown>;
    expect(slot).toBeDefined();
    expect(slot.get('collectionId')).toBe('col-1');
  });

  it('applies carried classOverrides and unifiedOverrides', () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'PASTE_ELEMENTS', pageId: 'page-1', index: 0, masters: [],
      elements: [{
        element: { id: 'i1', pageId: 'page-1', parentId: null, index: 0, type: 'component', componentType: 'C', staticMarkup: '<div><p>t</p></div>', classes: emptyClasses() },
        classOverrides: { 'p-0': { base: ['text-red-500'] } },
        unifiedOverrides: { 'p-0': { content: { type: 'text', value: 'hey' } } },
      }],
    });
    const yEl = doc.getMap('elements').get('i1') as Y.Map<unknown>;
    expect((yEl.get('classOverrides') as Y.Map<unknown>).toJSON()).toEqual({ 'p-0': { base: ['text-red-500'] } });
    expect((yEl.get('unifiedOverrides') as Y.Map<unknown>).toJSON()).toEqual({ 'p-0': { content: { type: 'text', value: 'hey' } } });
  });
});
