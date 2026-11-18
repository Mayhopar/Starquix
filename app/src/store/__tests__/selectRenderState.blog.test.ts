/**
 * task-028 — selectRenderState's blogSlots[] entries follow the new shape:
 * keyed off the real BlogSlot element id (not a drawn slotKey), no
 * cardTemplateMarkup, no cardElementId, no paginationElement. The bridge
 * Phase 5 expansion only needs slotElementId + settings + bindings.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { selectRenderState } from '../selectors';
import { emptyClassData } from '../types';
import { BLOG_SLOT_COMPONENT_TYPE, BLOG_SLOT_DEFAULTS_KEY } from '@/core/collections/types';

const PAGE_ID = 'page-1';

function setupDoc(pageId: string = PAGE_ID): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', pageId);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(pageId, yPage);
  }, 'sync');
  return doc;
}

function setBlogSlotBinding(doc: Y.Doc, slotElementId: string, collectionId: string): void {
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

describe('selectRenderState.blogSlots — new shape (task-028)', () => {
  it('entry has slotElementId and drops cardTemplateMarkup / cardElementId / paginationElement', () => {
    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-slot',
          pageId: PAGE_ID,
          parentId: null,
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: BLOG_SLOT_COMPONENT_TYPE,
          classes: emptyClassData(),
          staticMarkup: '<section><slot name="posts"></slot></section>',
          astroSource: 'preview-template/src/components/library/BlogSlot.astro',
          classOverrides: {},
        },
      });
      setBlogSlotBinding(doc, 'el-slot', 'col-blog');
    }, 'sync');

    const state = selectRenderState(doc, PAGE_ID);
    expect(state.blogSlots).toBeDefined();
    expect(state.blogSlots!.length).toBe(1);

    const entry = state.blogSlots![0];
    expect(entry.slotElementId).toBe('el-slot');
    expect(entry.collectionId).toBe('col-blog');
    expect(entry.settings.postsPerPage).toBe(3);
    expect(entry.postLinkMode).toBe('auto');

    expect((entry as Record<string, unknown>).cardTemplateMarkup).toBeUndefined();
    expect((entry as Record<string, unknown>).cardElementId).toBeUndefined();
    expect((entry as Record<string, unknown>).paginationElement).toBeUndefined();
    expect((entry as Record<string, unknown>).slotKey).toBeUndefined();
  });

  it('returns no blogSlots entries when no instance has a binding', () => {
    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-slot',
          pageId: PAGE_ID,
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
      // no binding
    }, 'sync');

    const state = selectRenderState(doc, PAGE_ID);
    expect(state.blogSlots).toBeUndefined();
  });
});

describe('selectRenderState.blogSlots — component editor is Phase-5-free', () => {
  it('a bound BlogSlot on __component-editor emits NO blogSlots entry', () => {
    // Regression (2026-08-13): a stray binding keyed to the master root (the
    // defaults entry mis-ported by portDanglingBinding) armed Phase 5 in the
    // component editor — UC2b with zero posts blanked the template card. The
    // master surface must stay Phase-5-free even when a binding exists.
    const doc = setupDoc('__component-editor');
    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-master',
          pageId: '__component-editor',
          parentId: null,
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: BLOG_SLOT_COMPONENT_TYPE,
          classes: emptyClassData(),
          staticMarkup: '<section><slot name="posts"></slot></section>',
          astroSource: 'preview-template/src/components/library/BlogSlot.astro',
          classOverrides: {},
        },
      });
      setBlogSlotBinding(doc, 'el-master', '__defaults');
    }, 'sync');

    const state = selectRenderState(doc, '__component-editor');
    // The master root itself must still render…
    expect(state.components.length).toBe(1);
    // …but Phase 5 must never arm on the component-editor surface.
    expect(state.blogSlots).toBeUndefined();
  });
});

describe('selectRenderState.blogSlots — live settings inheritance (task-102)', () => {
  it('untouched bound instance renders the MASTER defaults, not app defaults', () => {
    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-slot',
          pageId: PAGE_ID,
          parentId: null,
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: BLOG_SLOT_COMPONENT_TYPE,
          classes: emptyClassData(),
          staticMarkup: '<section><slot name="posts"></slot></section>',
          astroSource: 'preview-template/src/components/library/BlogSlot.astro',
          classOverrides: {},
        },
      });
      // Sparse bind: empty settings map (task-102 model).
      applyCommand(doc, { type: 'SET_BLOG_SLOT_COLLECTION', slotKey: 'el-slot', collectionId: 'col-blog' });
      // Master defaults define postsPerPage.
      applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: BLOG_SLOT_DEFAULTS_KEY, settings: { postsPerPage: 6, pagination: 'numbered' } });
    }, 'sync');

    const entry = selectRenderState(doc, PAGE_ID).blogSlots![0];
    expect(entry.settings.postsPerPage).toBe(6);
    expect(entry.settings.pagination).toBe('numbered');

    // Instance override wins per field; the rest still inherits.
    applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: 'el-slot', settings: { pagination: 'none' } });
    const entry2 = selectRenderState(doc, PAGE_ID).blogSlots![0];
    expect(entry2.settings.pagination).toBe('none');
    expect(entry2.settings.postsPerPage).toBe(6);
  });
});
