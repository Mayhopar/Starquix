/**
 * task-028 — ADD_ELEMENT honours the registry-only `defaultChildren` field
 * so a single drop materialises an entire instance subtree (parent + slot-
 * routed children) in one Yjs transaction. The field is a transient hint
 * carried on the ElementData spec passed to ADD_ELEMENT; it is NOT
 * persisted onto the resulting Y.Map.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';

const PAGE_ID = 'page-1';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

function collectChildren(doc: Y.Doc, parentId: string): Array<Y.Map<unknown>> {
  const out: Array<Y.Map<unknown>> = [];
  doc.getMap<Y.Map<unknown>>('elements').forEach((el) => {
    if (el.get('parentId') === parentId) out.push(el);
  });
  return out;
}

describe('ADD_ELEMENT honours defaultChildren (task-028)', () => {
  it('creates listed children with correct parentId and slotName', () => {
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
          componentType: 'TestParent',
          classes: emptyClassData(),
          staticMarkup: '<section><slot name="slotA"></slot><slot name="slotB"></slot></section>',
          astroSource: 'preview-template/src/components/library/TestParent.astro',
          classOverrides: {},
          defaultChildren: [
            { componentType: 'TestChildA', slotName: 'slotA', astroSource: 'preview-template/src/components/library/TestChildA.astro', staticMarkup: '<article>A</article>' },
            { componentType: 'TestChildB', slotName: 'slotB', astroSource: 'preview-template/src/components/library/TestChildB.astro', staticMarkup: '<article>B</article>' },
          ],
        },
      });
    }, 'sync');

    const children = collectChildren(doc, 'el-parent');
    expect(children).toHaveLength(2);

    const byType = new Map(
      children.map((c) => [c.get('componentType') as string, c]),
    );
    expect(byType.get('TestChildA')?.get('slotName')).toBe('slotA');
    expect(byType.get('TestChildB')?.get('slotName')).toBe('slotB');

    // defaultChildren is registry-only — must NOT be persisted on the parent Y.Map.
    const parent = doc.getMap<Y.Map<unknown>>('elements').get('el-parent');
    expect(parent?.get('defaultChildren')).toBeUndefined();
  });

  it('child ids are unique and minted automatically when not provided', () => {
    const doc = setupDoc();

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: 'el-parent-2',
          pageId: PAGE_ID,
          parentId: null,
          index: 0,
          type: 'component',
          instanceType: 'local',
          componentType: 'TestParent',
          classes: emptyClassData(),
          staticMarkup: '<section><slot name="a"></slot><slot name="b"></slot></section>',
          astroSource: 'TestParent.astro',
          classOverrides: {},
          defaultChildren: [
            { componentType: 'TestChildA', slotName: 'a', astroSource: 'A.astro', staticMarkup: '<a>A</a>' },
            { componentType: 'TestChildA', slotName: 'b', astroSource: 'A.astro', staticMarkup: '<a>A</a>' },
          ],
        },
      });
    }, 'sync');

    const children = collectChildren(doc, 'el-parent-2');
    expect(children).toHaveLength(2);
    const ids = children.map((c) => c.get('id') as string);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^el-/);
    }
  });
});
