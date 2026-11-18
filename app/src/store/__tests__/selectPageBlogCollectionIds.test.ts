/**
 * task-029 — `selectPageBlogCollectionIds` must return the bound collectionId
 * for BOTH BlogSlot shapes:
 *   - legacy drawn slot (`isDrawn=true, slotType='blog'`)
 *   - post-task-028 regular instance (`componentType='BlogSlot', isDrawn=false`)
 *
 * Before the fix, the `!isDrawn` early-exit dropped every regular-instance
 * BlogSlot, so `BlogPostChildren` never mounted under regular pages that held
 * a cmd-K-dropped BlogSlot. See PROJECT_NOTES.md entry "[2026-05-17] task-028
 * regression: page-tree post-rendering filter excludes regular-instance
 * BlogSlots" for the full architectural writeup.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { selectPageBlogCollectionIds } from '../selectors';
import { BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';

const PAGE_ID = 'page-1';
const OTHER_PAGE_ID = 'page-2';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    for (const id of [PAGE_ID, OTHER_PAGE_ID]) {
      const yPage = new Y.Map();
      yPage.set('id', id);
      yPage.set('name', id);
      yPage.set('rootElementIds', new Y.Array());
      yPage.set('children', new Y.Array());
      pages.set(id, yPage);
    }
  }, 'sync');
  return doc;
}

function addBinding(doc: Y.Doc, slotElementId: string, collectionId: string): void {
  const blogSlotBindings = doc.getMap('blogSlotBindings');
  const yBinding = new Y.Map();
  yBinding.set('collectionId', collectionId);
  const ySettings = new Y.Map();
  ySettings.set('layout', 'grid');
  ySettings.set('columns', 3);
  ySettings.set('gap', 'gap-4');
  ySettings.set('pagination', 'none');
  ySettings.set('postsPerPage', 3);
  ySettings.set('postLinkMode', 'auto');
  yBinding.set('settings', ySettings);
  yBinding.set('bindings', new Y.Map());
  blogSlotBindings.set(slotElementId, yBinding);
}

function addDrawnBlogSlot(doc: Y.Doc, id: string, pageId: string): void {
  const elements = doc.getMap('elements');
  const yEl = new Y.Map();
  yEl.set('id', id);
  yEl.set('pageId', pageId);
  yEl.set('isDrawn', true);
  yEl.set('slotType', 'blog');
  elements.set(id, yEl);
}

function addInstanceBlogSlot(doc: Y.Doc, id: string, pageId: string): void {
  const elements = doc.getMap('elements');
  const yEl = new Y.Map();
  yEl.set('id', id);
  yEl.set('pageId', pageId);
  yEl.set('isDrawn', false);
  yEl.set('componentType', BLOG_SLOT_COMPONENT_TYPE);
  elements.set(id, yEl);
}

describe('selectPageBlogCollectionIds (task-029)', () => {
  it('returns the collectionId for a drawn-shape BlogSlot (legacy)', () => {
    const doc = setupDoc();
    doc.transact(() => {
      addDrawnBlogSlot(doc, 'drawn-slot', PAGE_ID);
      addBinding(doc, 'drawn-slot', 'col-blog');
    }, 'sync');

    expect(selectPageBlogCollectionIds(doc, PAGE_ID)).toEqual(['col-blog']);
  });

  it('returns the collectionId for a regular-instance BlogSlot (post-task-028)', () => {
    const doc = setupDoc();
    doc.transact(() => {
      addInstanceBlogSlot(doc, 'instance-slot', PAGE_ID);
      addBinding(doc, 'instance-slot', 'col-news');
    }, 'sync');

    expect(selectPageBlogCollectionIds(doc, PAGE_ID)).toEqual(['col-news']);
  });

  it('returns both bindings when drawn and instance shapes coexist on the same page', () => {
    const doc = setupDoc();
    doc.transact(() => {
      addDrawnBlogSlot(doc, 'drawn-slot', PAGE_ID);
      addBinding(doc, 'drawn-slot', 'col-a');
      addInstanceBlogSlot(doc, 'instance-slot', PAGE_ID);
      addBinding(doc, 'instance-slot', 'col-b');
    }, 'sync');

    expect(selectPageBlogCollectionIds(doc, PAGE_ID).sort()).toEqual(['col-a', 'col-b']);
  });

  it('does not leak BlogSlots from other pages', () => {
    const doc = setupDoc();
    doc.transact(() => {
      addInstanceBlogSlot(doc, 'instance-here', PAGE_ID);
      addBinding(doc, 'instance-here', 'col-here');
      addInstanceBlogSlot(doc, 'instance-elsewhere', OTHER_PAGE_ID);
      addBinding(doc, 'instance-elsewhere', 'col-elsewhere');
    }, 'sync');

    expect(selectPageBlogCollectionIds(doc, PAGE_ID)).toEqual(['col-here']);
    expect(selectPageBlogCollectionIds(doc, OTHER_PAGE_ID)).toEqual(['col-elsewhere']);
  });

  it('skips BlogSlots that have no binding (unbound just-dropped slot)', () => {
    const doc = setupDoc();
    doc.transact(() => {
      addInstanceBlogSlot(doc, 'unbound', PAGE_ID);
      // No addBinding call.
    }, 'sync');

    expect(selectPageBlogCollectionIds(doc, PAGE_ID)).toEqual([]);
  });
});
