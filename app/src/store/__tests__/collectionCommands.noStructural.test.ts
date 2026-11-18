/**
 * task-028 — collectionCommands no longer perform structural Yjs mutations.
 * SET_BLOG_SLOT_COLLECTION and UPDATE_BLOG_SLOT_SETTINGS only write into
 * blogSlotBindings. REGISTER_BLOG_PAGINATION / REMOVE_BLOG_PAGINATION are
 * deleted (pagination is now a normal Yjs instance child of BlogSlot).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';
import { BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';

const PAGE_ID = 'page-1';

function setupSlot(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
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
  }, 'sync');
  return doc;
}

function countElements(doc: Y.Doc): number {
  return doc.getMap('elements').size;
}

describe('collectionCommands stop touching structural state (task-028)', () => {
  it('SET_BLOG_SLOT_COLLECTION writes only the binding — no auto :blogcard element', () => {
    const doc = setupSlot();
    const before = countElements(doc);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'SET_BLOG_SLOT_COLLECTION',
        slotKey: 'el-slot',
        collectionId: 'col-blog',
      });
    }, 'sync');

    // Binding is written.
    const binding = doc.getMap('blogSlotBindings').get('el-slot') as Y.Map<unknown> | undefined;
    expect(binding?.get('collectionId')).toBe('col-blog');

    // No new structural element materialised.
    expect(countElements(doc)).toBe(before);
    expect(doc.getMap('elements').has('el-slot:blogcard')).toBe(false);
  });

  it('UPDATE_BLOG_SLOT_SETTINGS does NOT write to sourceClasses[<slot>:posts]', () => {
    const doc = setupSlot();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'SET_BLOG_SLOT_COLLECTION',
        slotKey: 'el-slot',
        collectionId: 'col-blog',
      });
    }, 'sync');

    doc.transact(() => {
      applyCommand(doc, {
        type: 'UPDATE_BLOG_SLOT_SETTINGS',
        slotKey: 'el-slot',
        settings: { columns: 4, layout: 'grid' },
      });
    }, 'sync');

    const sourceClasses = doc.getMap('sourceClasses');
    expect(sourceClasses.has('el-slot:posts')).toBe(false);

    // Setting itself is updated.
    const binding = doc.getMap('blogSlotBindings').get('el-slot') as Y.Map<unknown>;
    const settings = binding.get('settings') as Y.Map<unknown>;
    expect(settings.get('columns')).toBe(4);
  });

  it('REGISTER_BLOG_PAGINATION / REMOVE_BLOG_PAGINATION are removed (no :pagination element materialised)', () => {
    const doc = setupSlot();
    const before = doc.getMap('elements').size;

    // Dispatching them now is a no-op (the case branches are deleted, and
    // they are no longer in the collection-command allowlist). Sending the
    // command must not magically materialise el-slot:pagination.
    applyCommand(doc, {
      type: 'REGISTER_BLOG_PAGINATION',
      slotKey: 'el-slot',
      componentType: 'BlogPaginationNumbered',
      staticMarkup: '<nav></nav>',
      astroSource: 'X.astro',
    // @ts-expect-error - command type intentionally removed
    } as unknown);
    applyCommand(doc, {
      type: 'REMOVE_BLOG_PAGINATION',
      slotKey: 'el-slot',
    // @ts-expect-error - command type intentionally removed
    } as unknown);

    expect(doc.getMap('elements').size).toBe(before);
    expect(doc.getMap('elements').has('el-slot:pagination')).toBe(false);
  });
});
