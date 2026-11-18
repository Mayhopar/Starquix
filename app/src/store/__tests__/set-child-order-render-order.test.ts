/**
 * SET_CHILD_ORDER render-domain mirror tests.
 *
 * SET_CHILD_ORDER must mirror RENDER-domain selectors onto the host element's
 * `renderOrderOverrides` (Y.Map<parentSelector, Y.Array<childSelector>>) which
 * drives applyRenderOrder in markup resolution — independently of the legacy
 * SOURCE-domain `orderOverrides` mirror that feeds AST write-back.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import type { ClassData } from '../types';

function makeClasses(): ClassData {
  return { base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] };
}

function setupDoc(opts?: { astroSource?: boolean }): Y.Doc {
  const doc = createEditorDoc();
  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { id: 'p1', name: 'Test', rootElementIds: [], children: [] },
  });
  applyCommand(doc, {
    type: 'ADD_ELEMENT',
    element: {
      id: 'el-a',
      pageId: 'p1',
      parentId: null,
      index: 0,
      type: 'instance',
      classes: makeClasses(),
      staticMarkup:
        '<section><div>a</div><div>b</div><div>c</div><div>d</div></section>',
    },
  });
  if (opts?.astroSource !== false) {
    const yEl = doc.getMap('elements').get('el-a') as Y.Map<unknown>;
    yEl.set('astroSource', '<section><div>a</div></section>');
  }
  return doc;
}

describe('SET_CHILD_ORDER renderOrderOverrides mirror', () => {
  it('mirrors render-domain selectors onto renderOrderOverrides and leaves orderOverrides source-domain', () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'p1',
      parentKey: 'el-a:section-0',
      childKeys: ['el-a:div-0', 'el-a:div-3'],
      sourceSelectors: ['div-0', 'div-1'], // source-translated (AST domain)
    });
    const yEl = doc.getMap('elements').get('el-a') as Y.Map<unknown>;
    const roo = yEl.get('renderOrderOverrides') as Y.Map<Y.Array<string>>;
    expect(roo).toBeDefined();
    expect(roo.get('section-0')!.toArray()).toEqual(['div-0', 'div-3']); // RENDER domain
    const legacy = yEl.get('orderOverrides') as Y.Array<string>;
    expect(legacy.toArray()).toEqual(['div-0', 'div-1']); // SOURCE domain, unchanged behavior
  });

  it('writes renderOrderOverrides even without astroSource (markup resolution does not depend on write-back)', () => {
    const doc = setupDoc({ astroSource: false });
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'p1',
      parentKey: 'el-a:section-0',
      childKeys: ['el-a:div-3', 'el-a:div-0'],
    });
    const yEl = doc.getMap('elements').get('el-a') as Y.Map<unknown>;
    const roo = yEl.get('renderOrderOverrides') as Y.Map<Y.Array<string>>;
    expect(roo).toBeDefined();
    expect(roo.get('section-0')!.toArray()).toEqual(['div-3', 'div-0']);
    expect(yEl.get('orderOverrides')).toBeUndefined(); // legacy mirror absent without astroSource
  });

  it('UPDATE_STATIC_MARKUP clears renderOrderOverrides', () => {
    const doc = setupDoc();
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'p1',
      parentKey: 'el-a:section-0',
      childKeys: ['el-a:div-0', 'el-a:div-3'],
    });
    const yEl = doc.getMap('elements').get('el-a') as Y.Map<unknown>;
    expect(yEl.get('renderOrderOverrides')).toBeDefined();
    applyCommand(doc, {
      type: 'UPDATE_STATIC_MARKUP',
      elementId: 'el-a',
      staticMarkup: '<section><p>fresh</p></section>',
    });
    expect(yEl.get('renderOrderOverrides')).toBeUndefined();
  });
});
