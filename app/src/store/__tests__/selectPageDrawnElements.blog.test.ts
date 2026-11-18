/**
 * task-028 — In the new model BlogSlot is a regular component instance
 * (isDrawn === false), so selectPageDrawnElements naturally excludes it
 * and its children. The previous `:blogcard` filter is gone.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { selectPageDrawnElements } from '../selectors';
import { emptyClassData } from '../types';
import { BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';

const PAGE_ID = 'page-1';

function setupDocWithBlogSlot(): Y.Doc {
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
        defaultChildren: [
          { componentType: 'BlogCard', slotName: 'posts', staticMarkup: '<article></article>', astroSource: 'BlogCard.astro' },
        ],
      },
    });
  }, 'sync');
  return doc;
}

describe('selectPageDrawnElements excludes BlogSlot in the new model (task-028)', () => {
  it('no blog-slot drawn elements emitted; BlogSlot is a regular instance', () => {
    const doc = setupDocWithBlogSlot();
    const drawn = selectPageDrawnElements(doc, PAGE_ID);
    expect(drawn).toEqual([]);
  });
});
