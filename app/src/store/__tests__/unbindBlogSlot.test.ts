/**
 * task-037/038 — UNBIND_BLOG_SLOT resets a slot's binding to the unbound
 * scaffold (collectionId = UNBOUND_COLLECTION_ID) instead of deleting the
 * entry: a deleted entry drops out of selectRenderState.blogSlots, bridge
 * Phase 5 skips the slot and the raw BlogCard template renders — NOT the
 * "No posts yet" empty state task-038 AC3 requires. Settings and field
 * bindings survive (inert while unbound; re-resolve by name on re-bind).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';
import { BLOG_SLOT_COMPONENT_TYPE, UNBOUND_COLLECTION_ID } from '@/core/collections/types';

function setupTwoBoundSlots(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', 'page-1');
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set('page-1', yPage);

    applyCommand(doc, {
      type: 'ADD_CONTENT_COLLECTION',
      collection: { id: 'col-blog', name: 'blog', fields: [], createdAt: '2026-06-11' },
    });
    applyCommand(doc, {
      type: 'ADD_CONTENT_COLLECTION',
      collection: { id: 'col-news', name: 'news', fields: [], createdAt: '2026-06-11' },
    });

    for (const slotId of ['slot-a', 'slot-b'] as const) {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: slotId, pageId: 'page-1', parentId: null, index: 0,
          type: 'component', instanceType: 'local',
          componentType: BLOG_SLOT_COMPONENT_TYPE, classes: emptyClassData(),
          staticMarkup: '<section></section>',
          astroSource: 'preview-template/src/components/library/BlogSlot.astro',
          classOverrides: {},
        },
      });
      applyCommand(doc, { type: 'SET_BLOG_SLOT_COLLECTION', slotKey: slotId, collectionId: 'col-blog' });
    }
    // Per-instance customization that must survive an unbind.
    applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: 'slot-a', settings: { postsPerPage: 7 } });
    applyCommand(doc, { type: 'SET_CONTENT_BINDING', slotKey: 'slot-a', elementKey: 'slot-a:h3-0', fieldName: 'title' });
  }, 'sync');
  return doc;
}

describe('UNBIND_BLOG_SLOT (task-038)', () => {
  it('resets collectionId to the unbound sentinel, keeping the entry', () => {
    const doc = setupTwoBoundSlots();
    applyCommand(doc, { type: 'UNBIND_BLOG_SLOT', slotKey: 'slot-a' });
    const blogBindings = doc.getMap('blogSlotBindings');
    expect(blogBindings.has('slot-a')).toBe(true);
    expect((blogBindings.get('slot-a') as Y.Map<unknown>).get('collectionId')).toBe(UNBOUND_COLLECTION_ID);
  });

  it('preserves settings and per-element field bindings', () => {
    const doc = setupTwoBoundSlots();
    applyCommand(doc, { type: 'UNBIND_BLOG_SLOT', slotKey: 'slot-a' });
    const ySlot = doc.getMap('blogSlotBindings').get('slot-a') as Y.Map<unknown>;
    expect((ySlot.get('settings') as Y.Map<unknown>).get('postsPerPage')).toBe(7);
    expect((ySlot.get('bindings') as Y.Map<unknown>).get('slot-a:h3-0')).toBe('title');
  });

  it('does not create an entry for an unknown slotKey', () => {
    const doc = setupTwoBoundSlots();
    applyCommand(doc, { type: 'UNBIND_BLOG_SLOT', slotKey: 'slot-nope' });
    expect(doc.getMap('blogSlotBindings').has('slot-nope')).toBe(false);
  });

  it('unbinding instance A does not affect instance B bound to the same collection (AC5)', () => {
    const doc = setupTwoBoundSlots();
    applyCommand(doc, { type: 'UNBIND_BLOG_SLOT', slotKey: 'slot-a' });
    expect((doc.getMap('blogSlotBindings').get('slot-b') as Y.Map<unknown>).get('collectionId')).toBe('col-blog');
  });
});

describe('SET_BLOG_SLOT_COLLECTION re-bind isolation (task-037 AC6, regression guard)', () => {
  it('rebinding instance A does not affect instance B bound to the original collection', () => {
    const doc = setupTwoBoundSlots();
    applyCommand(doc, { type: 'SET_BLOG_SLOT_COLLECTION', slotKey: 'slot-a', collectionId: 'col-news' });
    const blogBindings = doc.getMap('blogSlotBindings');
    expect((blogBindings.get('slot-a') as Y.Map<unknown>).get('collectionId')).toBe('col-news');
    expect((blogBindings.get('slot-b') as Y.Map<unknown>).get('collectionId')).toBe('col-blog');
  });
});
