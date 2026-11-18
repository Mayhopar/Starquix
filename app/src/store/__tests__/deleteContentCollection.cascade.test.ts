/**
 * task-030 — DELETE_CONTENT_COLLECTION must clear orphaned blogSlotBindings.
 *
 * Before fix: deleting a collection cascaded to its post pages but left every
 * BlogSlot's `blogSlotBindings[slotKey].collectionId` pointing at the now-gone
 * collection. The instance rendered the empty state (lookup failed) but the
 * stale binding stayed in Yjs and resurfaced if the same id was reused.
 *
 * task-037/038 update: the cascade now RESETS bindings to the unbound sentinel
 * via the shared `unbindBlogSlot` helper instead of deleting the entries —
 * a deleted entry drops out of selectRenderState.blogSlots and the raw BlogCard
 * template renders instead of "No posts yet". The task-030 goal still holds:
 * no dangling collectionId remains after the delete.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';
import { BLOG_SLOT_COMPONENT_TYPE, DEFAULT_BLOG_SETTINGS, UNBOUND_COLLECTION_ID } from '@/core/collections/types';

function setupDocWithTwoSlotsBoundToOneCollection(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    for (const id of ['page-a', 'page-b']) {
      const yPage = new Y.Map();
      yPage.set('id', id);
      yPage.set('name', id);
      yPage.set('rootElementIds', new Y.Array());
      yPage.set('children', new Y.Array());
      pages.set(id, yPage);
    }

    applyCommand(doc, {
      type: 'ADD_CONTENT_COLLECTION',
      collection: {
        id: 'col-blog',
        name: 'blog',
        fields: [{ id: 'f-title', name: 'title', type: 'text', required: true }],
        createdAt: '2026-05-21',
      },
    });

    // Second collection — must survive the delete.
    applyCommand(doc, {
      type: 'ADD_CONTENT_COLLECTION',
      collection: {
        id: 'col-news',
        name: 'news',
        fields: [{ id: 'f-title', name: 'title', type: 'text', required: true }],
        createdAt: '2026-05-21',
      },
    });

    for (const [slotId, pageId] of [['slot-1', 'page-a'], ['slot-2', 'page-b']] as const) {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: slotId,
          pageId,
          parentId: null,
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: BLOG_SLOT_COMPONENT_TYPE,
          classes: emptyClassData(),
          staticMarkup: '<section></section>',
          astroSource: 'preview-template/src/components/library/BlogSlot.astro',
          classOverrides: {},
        },
      });
      applyCommand(doc, {
        type: 'SET_BLOG_SLOT_COLLECTION',
        slotKey: slotId,
        collectionId: 'col-blog',
        settings: DEFAULT_BLOG_SETTINGS,
      });
    }

    // A third slot bound to the OTHER collection — must NOT be cleared.
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'slot-news',
        pageId: 'page-a',
        parentId: null,
        index: 1,
        type: 'component',
        instanceType: 'local',
        componentType: BLOG_SLOT_COMPONENT_TYPE,
        classes: emptyClassData(),
        staticMarkup: '<section></section>',
        astroSource: 'preview-template/src/components/library/BlogSlot.astro',
        classOverrides: {},
      },
    });
    applyCommand(doc, {
      type: 'SET_BLOG_SLOT_COLLECTION',
      slotKey: 'slot-news',
      collectionId: 'col-news',
      settings: DEFAULT_BLOG_SETTINGS,
    });
  }, 'sync');
  return doc;
}

describe('task-030 — DELETE_CONTENT_COLLECTION clears orphan blogSlotBindings', () => {
  it('unbinds every slot bound to the deleted collection (entries kept, collectionId reset)', () => {
    const doc = setupDocWithTwoSlotsBoundToOneCollection();
    const blogBindings = doc.getMap('blogSlotBindings');
    expect(blogBindings.size).toBe(3);

    applyCommand(doc, { type: 'DELETE_CONTENT_COLLECTION', collectionId: 'col-blog' });

    expect(blogBindings.size).toBe(3);
    expect((blogBindings.get('slot-1') as Y.Map<unknown>).get('collectionId')).toBe(UNBOUND_COLLECTION_ID);
    expect((blogBindings.get('slot-2') as Y.Map<unknown>).get('collectionId')).toBe(UNBOUND_COLLECTION_ID);
  });

  it('leaves bindings for collections that were NOT deleted untouched', () => {
    const doc = setupDocWithTwoSlotsBoundToOneCollection();
    const blogBindings = doc.getMap('blogSlotBindings');

    applyCommand(doc, { type: 'DELETE_CONTENT_COLLECTION', collectionId: 'col-blog' });

    expect(blogBindings.has('slot-news')).toBe(true);
    const remaining = blogBindings.get('slot-news') as Y.Map<unknown>;
    expect(remaining.get('collectionId')).toBe('col-news');
  });

  it('cascade is one undo step (single transaction)', () => {
    const doc = setupDocWithTwoSlotsBoundToOneCollection();
    const blogBindings = doc.getMap('blogSlotBindings');
    const undoMgr = new Y.UndoManager(
      [
        doc.getMap('contentCollections'),
        doc.getMap('blogSlotBindings'),
        doc.getMap('pages'),
        doc.getMap('postPageBindings'),
        doc.getMap('elements'),
        doc.getArray('rootPages'),
      ],
      { trackedOrigins: new Set([null]) }
    );

    expect(blogBindings.size).toBe(3);

    applyCommand(doc, { type: 'DELETE_CONTENT_COLLECTION', collectionId: 'col-blog' });
    expect(blogBindings.size).toBe(3);
    expect((blogBindings.get('slot-1') as Y.Map<unknown>).get('collectionId')).toBe(UNBOUND_COLLECTION_ID);

    undoMgr.undo();
    expect((blogBindings.get('slot-1') as Y.Map<unknown>).get('collectionId')).toBe('col-blog');
    expect((blogBindings.get('slot-2') as Y.Map<unknown>).get('collectionId')).toBe('col-blog');
  });
});
