/**
 * task-120 (4.1) — per-element memoization of applyAllOverrides. The
 * DOMParser passes are selectRenderState's hot cost; untouched elements
 * must not re-parse on subsequent selector runs, and an override edit on
 * element X must invalidate X only.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectRenderState } from '../selectors';
import { emptyClassData } from '../types';

function seedPage(doc: Y.Doc, pageId: string): void {
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('name', 'Page');
  page.set('rootElementIds', new Y.Array<string>());
  pages.set(pageId, page);
  doc.getArray<string>('rootPages').push([pageId]);
}

function addSection(doc: Y.Doc, id: string): void {
  applyCommand(doc, {
    type: 'ADD_ELEMENT',
    element: {
      id,
      pageId: 'page-1',
      parentId: null,
      index: 0,
      type: 'section',
      classes: emptyClassData(),
      staticMarkup: `<section data-key="${id}"><h1 data-key="${id}:h1-0" class="text-xl">Hello ${id}</h1></section>`,
    },
  });
}

describe('selectRenderState per-element memo (task-120)', () => {
  let doc: Y.Doc;
  let parseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    doc = createEditorDoc();
    seedPage(doc, 'page-1');
    addSection(doc, 'el-1');
    addSection(doc, 'el-2');
    parseSpy = vi.spyOn(DOMParser.prototype, 'parseFromString');
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('untouched elements do not re-parse on a second selector run', () => {
    const first = selectRenderState(doc, 'page-1');
    expect(first.components.length).toBe(2);
    const callsAfterFirst = parseSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = selectRenderState(doc, 'page-1');
    expect(second.components.length).toBe(2);
    expect(parseSpy.mock.calls.length).toBe(callsAfterFirst); // zero new parses
  });

  it('an override write on element X invalidates X only', () => {
    selectRenderState(doc, 'page-1');
    const fullRunCalls = parseSpy.mock.calls.length;

    // Write a class override on el-1 directly (the memo must key off map content).
    // Shape: classOverrides[selector] = Y.Map of breakpoint → Y.Array<string>.
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    doc.transact(() => {
      const classData = new Y.Map();
      const base = new Y.Array<string>();
      base.push(['text-red-500']);
      classData.set('base', base);
      const co = new Y.Map();
      co.set('h1-0', classData);
      yEl.set('classOverrides', co);
    });

    parseSpy.mockClear();
    const state = selectRenderState(doc, 'page-1');
    const callsAfterEdit = parseSpy.mock.calls.length;

    expect(callsAfterEdit).toBeGreaterThan(0); // el-1 recomputed
    expect(callsAfterEdit).toBeLessThan(fullRunCalls); // el-2 served from memo
    expect(state.components.find((c) => c.id === 'el-1')?.staticMarkup).toContain('text-red-500');
  });

  it('memoized output equals the uncached output (correctness over speed)', () => {
    const a = selectRenderState(doc, 'page-1');
    const b = selectRenderState(doc, 'page-1');
    expect(b.components).toEqual(a.components);
  });

  it('a staticMarkup change recomputes (rawMarkup is part of the signature)', () => {
    selectRenderState(doc, 'page-1');
    const yEl = doc.getMap('elements').get('el-2') as Y.Map<unknown>;
    doc.transact(() => {
      yEl.set('staticMarkup', '<section data-key="el-2"><h1>Changed</h1></section>');
    });
    const state = selectRenderState(doc, 'page-1');
    expect(state.components.find((c) => c.id === 'el-2')?.staticMarkup).toContain('Changed');
  });
});
