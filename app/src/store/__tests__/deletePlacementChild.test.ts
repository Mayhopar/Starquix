import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyAllOverrides } from '@/store/selectors';
import { applyCommand, createElementYMap } from '@/store/commands';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { emptyClassData } from '@/store/types';

// Regression (task-098 placements): deleting a placement child must strip its
// <sq-child> placeholder from the markup — otherwise the bake keeps it and
// expandLeftoverPlaceholders resurrects the component on every page.
describe('applyAllOverrides — deleted placement child', () => {
  it('removes the matching <sq-child> placeholder', () => {
    const doc = new Y.Doc();
    const el = new Y.Map<unknown>();
    doc.getMap('elements').set('el-1', el);
    const deleted = new Y.Array<string>();
    el.set('deletedSelectors', deleted);
    deleted.push(['footer-0']);

    const markup = '<layout class="bg-white"><slot ></slot><sq-child data-sq-astro-source="library/Footer.astro" data-sq-placement="footer-0"></sq-child><sq-child data-sq-astro-source="library/navigation/GlobalNav.astro" data-sq-placement="globalnav-0"></sq-child></layout>';
    const out = applyAllOverrides(markup, el);

    expect(out).not.toContain('footer-0');
    expect(out).toContain('globalnav-0'); // untouched sibling placement stays
    expect(out).toContain('<slot');
  });
});

// Regression (live-caught: undeletable Footer): the Layers/canvas delete of a
// materialized placement child dispatches REMOVE_ELEMENT — which only removed
// the element. Nothing durable recorded the deletion, so the leftover
// <sq-child> re-expanded from the child master (ghost section) and every
// source re-resolve resurrected the component. REMOVE_ELEMENT on an
// editor-page placement child must record the placementKey on the editor
// root's deletedSelectors (the bake + source write-back consume it).
describe('REMOVE_ELEMENT — master-editor placement child', () => {
  function seed(doc: Y.Doc, pageId: string) {
    const pages = doc.getMap('pages');
    const page = new Y.Map();
    page.set('id', pageId);
    const rootIds = new Y.Array<string>();
    rootIds.push(['editor-root']);
    page.set('rootElementIds', rootIds);
    pages.set(pageId, page);

    const elements = doc.getMap('elements');
    elements.set('editor-root', createElementYMap({
      id: 'editor-root', pageId, parentId: null, index: 0,
      type: 'component', componentType: 'BlogPost',
      astroSource: 'library/BlogPost.astro', classes: emptyClassData(),
    }));
    elements.set('child-footer', createElementYMap({
      id: 'child-footer', pageId, parentId: 'editor-root', index: 0,
      type: 'component', componentType: 'Footer',
      astroSource: 'library/Footer.astro', placementKey: 'footer-0',
      classes: emptyClassData(),
    }));
  }

  it('records the placementKey on the editor root deletedSelectors', () => {
    const doc = new Y.Doc();
    seed(doc, COMPONENT_EDITOR_PAGE_ID);

    applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: 'child-footer' });

    expect(doc.getMap('elements').has('child-footer')).toBe(false);
    const root = doc.getMap('elements').get('editor-root') as Y.Map<unknown>;
    const ds = root.get('deletedSelectors') as Y.Array<string>;
    expect(ds?.toArray()).toEqual(['footer-0']);
  });

  it('does NOT touch deletedSelectors for deletes outside the editor page', () => {
    const doc = new Y.Doc();
    seed(doc, 'page-1');

    applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: 'child-footer' });

    const root = doc.getMap('elements').get('editor-root') as Y.Map<unknown>;
    expect(root.get('deletedSelectors')).toBeUndefined();
  });
});
