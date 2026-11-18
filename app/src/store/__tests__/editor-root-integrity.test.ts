import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { selectEditorRootElementId, selectRootElementIds } from '@/store/selectors';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';

/**
 * task-098 audit finding 2: canvas drags could pollute the editor page's
 * rootElementIds with a composite data-key (REPARENT to root keeps the full
 * key for instance-CHILD parses) or a bare child id (root-level REORDER
 * replaces the array wholesale). selectEditorRootElementId was blindly
 * rootIds[0], so the auto-bake / leave flush then targeted a dead key (all
 * persistence silently off) or the CARD's own master (wrong master + the
 * double-render "ghost").
 */
function seedEditorPage(doc: Y.Doc) {
  const page = new Y.Map<unknown>();
  page.set('name', 'BlogSlot');
  const rootIds = new Y.Array<string>();
  rootIds.push(['ed-1']);
  page.set('rootElementIds', rootIds);
  doc.getMap('pages').set(COMPONENT_EDITOR_PAGE_ID, page);

  const editor = new Y.Map<unknown>();
  editor.set('id', 'ed-1');
  editor.set('pageId', COMPONENT_EDITOR_PAGE_ID);
  editor.set('parentId', null);
  editor.set('astroSource', 'library/BlogSlot.astro');
  doc.getMap('elements').set('ed-1', editor);

  const card = new Y.Map<unknown>();
  card.set('id', 'card-1');
  card.set('pageId', COMPONENT_EDITOR_PAGE_ID);
  card.set('parentId', 'ed-1');
  card.set('placementKey', 'posts');
  doc.getMap('elements').set('card-1', card);
  return { page, rootIds };
}

describe('editor root integrity (drag pollution guards)', () => {
  it('selectEditorRootElementId skips dead data-keys and child ids', () => {
    const doc = new Y.Doc();
    const { rootIds } = seedEditorPage(doc);
    rootIds.unshift(['card-1']);            // bare child id (root-level reorder variant)
    rootIds.unshift(['card-1:article-0']);  // composite data-key (reparent variant)
    expect(selectEditorRootElementId(doc)).toBe('ed-1');
  });

  it('REPARENT_ELEMENT to root never inserts a non-element key into rootElementIds', () => {
    const doc = new Y.Doc();
    seedEditorPage(doc);
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: COMPONENT_EDITOR_PAGE_ID,
      elementKey: 'card-1:article-0',
      newParentKey: null,
      insertIndex: 0,
    });
    expect(selectRootElementIds(doc, COMPONENT_EDITOR_PAGE_ID)).not.toContain('card-1:article-0');
  });

  it('REORDER_PAGE_ELEMENTS drops ids of known CHILD elements', () => {
    const doc = new Y.Doc();
    seedEditorPage(doc);
    applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: COMPONENT_EDITOR_PAGE_ID,
      elementIds: ['card-1', 'ed-1'],
    });
    expect(selectRootElementIds(doc, COMPONENT_EDITOR_PAGE_ID)).toEqual(['ed-1']);
  });
});
