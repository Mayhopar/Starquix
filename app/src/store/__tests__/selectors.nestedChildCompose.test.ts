import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPageComponents } from '../selectors';
import { emptyClassData } from '../types';

function makePage(doc: Y.Doc, id: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id, name: 'Home', rootElementIds: [], children: [] } });
}

describe('selectPageComponents nested-child composition', () => {
  function buildDepth2Doc() {
    const doc = createEditorDoc();
    makePage(doc, 'p1');
    // Root: wrap (in rootElementIds)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'wrap', pageId: 'p1', parentId: null, index: 0, type: 'component',
        classes: emptyClassData(),
        staticMarkup: '<section data-key="wrap:section-0"><slot></slot></section>',
      } as never,
    });
    // Child of root: mid (default slot)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'mid', pageId: 'p1', parentId: 'wrap', index: 0, type: 'component',
        slotName: '',
        classes: emptyClassData(),
        staticMarkup: '<article data-key="mid:article-0"><slot name="content"></slot></article>',
      } as never,
    });
    // Grandchild (child of a NON-root parent): leaf, targets mid's "content" slot
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'leaf', pageId: 'p1', parentId: 'mid', index: 0, type: 'component',
        slotName: 'content',
        classes: emptyClassData(),
        staticMarkup: '<div data-key="leaf:div-0" class="prose">x</div>',
      } as never,
    });
    return doc;
  }

  it('composes grandchildren into their parent before the parent is spliced into the root', () => {
    const doc = buildDepth2Doc();
    const out = selectPageComponents(doc, 'p1');
    expect(out).toHaveLength(1);
    const html = out[0].staticMarkup;
    expect(html).toContain('data-key="leaf:div-0"');            // grandchild survived
    expect(html).not.toContain('<slot name="content">');        // mid's slot was filled
    const leafIdx = html.indexOf('leaf:div-0');
    const midIdx = html.indexOf('mid:article-0');
    expect(midIdx).toBeGreaterThan(-1);
    expect(leafIdx).toBeGreaterThan(midIdx);                     // nested inside mid
  });

  it('does not recurse forever on a parentId cycle', () => {
    const doc = createEditorDoc();
    makePage(doc, 'p2');
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'a', pageId: 'p2', parentId: null, index: 0, type: 'component',
        classes: emptyClassData(),
        staticMarkup: '<section data-key="a:section-0">A<slot></slot></section>',
      } as never,
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'b', pageId: 'p2', parentId: 'a', index: 0, type: 'component',
        slotName: '',
        classes: emptyClassData(),
        staticMarkup: '<div data-key="b:div-0">B<slot></slot></div>',
      } as never,
    });
    // Corrupt the data: point a's parentId at b, creating a cycle a -> b -> a.
    const yA = doc.getMap('elements').get('a') as Y.Map<unknown>;
    yA.set('parentId', 'b');
    // 'a' is still in rootElementIds; composition must terminate.
    const out = selectPageComponents(doc, 'p2');
    expect(out).toHaveLength(1);
    expect(out[0].staticMarkup).toContain('B');
  });
});
