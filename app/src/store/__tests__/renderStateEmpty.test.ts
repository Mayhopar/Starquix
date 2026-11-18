/**
 * task-115: empty-page gates (Canvas hasElements, ViewportFrame isEmpty)
 * must count drawn elements. Runtime-confirmed bug: server mode, empty page,
 * user draws a section → renderState.components stays 0 (selectRenderState
 * skips isDrawn roots) → the iframe wrapper stayed display:none → the
 * section showed in Layers but never on canvas.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { isRenderStateEmpty, selectPageDrawnCount, selectRenderState } from '../selectors';

const PAGE_ID = 'page-1';

function seedEmptyPage(): Y.Doc {
  const doc = new Y.Doc();
  const yPage = new Y.Map();
  yPage.set('id', PAGE_ID);
  yPage.set('rootElementIds', new Y.Array<string>());
  doc.getMap('pages').set(PAGE_ID, yPage);
  return doc;
}

function drawSection(doc: Y.Doc, key: string) {
  applyCommand(doc, {
    type: 'ADD_DRAWN_ELEMENT',
    element: {
      key,
      tag: 'div',
      classes: 'w-[1030px] h-[671px] border border-dashed border-gray-300 bg-white',
      textContent: '',
      parentKey: null,
      insertIndex: 0,
      pageId: PAGE_ID,
    },
  });
}

describe('isRenderStateEmpty / selectPageDrawnCount (task-115)', () => {
  it('drawn-only page is NOT empty (the bug)', () => {
    const doc = seedEmptyPage();
    drawSection(doc, 'drawn-1');
    expect(isRenderStateEmpty(selectRenderState(doc, PAGE_ID))).toBe(false);
    expect(selectPageDrawnCount(doc, PAGE_ID)).toBe(1);
  });

  it('truly empty page is empty', () => {
    const doc = seedEmptyPage();
    expect(isRenderStateEmpty(selectRenderState(doc, PAGE_ID))).toBe(true);
    expect(isRenderStateEmpty(null)).toBe(true);
    expect(selectPageDrawnCount(doc, PAGE_ID)).toBe(0);
  });

  it('drawn count is page-scoped and tracks removal', () => {
    const doc = seedEmptyPage();
    drawSection(doc, 'drawn-1');
    drawSection(doc, 'drawn-2');
    expect(selectPageDrawnCount(doc, PAGE_ID)).toBe(2);
    expect(selectPageDrawnCount(doc, 'other-page')).toBe(0);
    applyCommand(doc, { type: 'REMOVE_DRAWN_ELEMENT', elementKey: 'drawn-1' });
    expect(selectPageDrawnCount(doc, PAGE_ID)).toBe(1);
  });
});
