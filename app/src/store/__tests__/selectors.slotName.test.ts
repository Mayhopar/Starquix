/**
 * task-028 — pin the named-slot routing invariant that the BlogSlot refactor
 * depends on. A child element with slotName: "posts" must be projected into
 * the parent's <slot name="posts"> placeholder by selectPageComponents.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { selectPageComponents } from '../selectors';
import { emptyClassData } from '../types';

const PAGE_ID = 'page-slot-test';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Test');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

describe('selectPageComponents projects children into named slots (task-028)', () => {
  it('routes a child with slotName "posts" into the parent <slot name="posts">', () => {
    const doc = setupDoc();

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-parent',
          pageId: PAGE_ID,
          parentId: null,
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: 'BlogSlot',
          classes: emptyClassData(),
          staticMarkup: '<section><slot name="posts"></slot></section>',
          astroSource: 'preview-template/src/components/library/BlogSlot.astro',
          classOverrides: {},
        },
      });
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-card',
          pageId: PAGE_ID,
          parentId: 'el-parent',
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: 'BlogCard',
          slotName: 'posts',
          classes: emptyClassData(),
          staticMarkup: '<article data-test="card">card</article>',
          astroSource: 'preview-template/src/components/library/BlogCard.astro',
          classOverrides: {},
        },
      });
    }, 'sync');

    const components = selectPageComponents(doc, PAGE_ID);
    const parent = components.find((c) => c.id === 'el-parent');
    expect(parent).toBeTruthy();
    // Unwrap model: the card REPLACES the <slot name="posts"> placeholder — a
    // literal runtime <slot> must NOT survive (Astro's <slot> is compile-time
    // only; a real <slot> in the iframe light DOM won't render its contents).
    expect(parent!.staticMarkup).not.toMatch(/<slot\b/i);
    expect(parent!.staticMarkup).toContain('data-test="card"');
    // Card data-key stays in the card's id namespace, not the parent's.
    expect(parent!.staticMarkup).toContain('data-key="el-card:');
    // The card landed where the named slot was — inside the parent <section>.
    expect(parent!.staticMarkup).toMatch(/<section[^>]*>\s*<article[^>]*data-test="card"/);
  });
});
