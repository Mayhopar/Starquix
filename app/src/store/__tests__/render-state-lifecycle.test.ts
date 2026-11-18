/**
 * Lifecycle tests for the `rendering` system — specifically
 * `selectRenderState`, which is the pure projection the iframe consumes.
 *
 * Same lifecycle shape as commands-lifecycle.test.ts: seed → snapshot →
 * mutate → assert post → undo (rebuild from snapshot) → assert pre →
 * redo (rebuild from post-snapshot) → assert post again.
 *
 * Goal: catch the case where a command mutation appears to land in Yjs
 * but the selector returns stale data — the failure mode we've actually
 * shipped before for drawn-element parents and image-attribute overrides.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectRenderState } from '../selectors';
import { emptyClassData } from '../types';

vi.stubGlobal('window', {
  ...(globalThis.window || {}),
  dispatchEvent: vi.fn(),
  CustomEvent: class {
    type: string;
    detail: unknown;
    constructor(type: string, opts?: { detail?: unknown }) {
      this.type = type;
      this.detail = opts?.detail;
    }
  },
});

function snapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

function restoreFrom(snap: Uint8Array): Y.Doc {
  const fresh = createEditorDoc();
  Y.applyUpdate(fresh, snap);
  return fresh;
}

function seedPage(doc: Y.Doc, pageId: string): void {
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('name', 'Page');
  page.set('rootElementIds', new Y.Array<string>());
  pages.set(pageId, page);
  doc.getArray<string>('rootPages').push([pageId]);
}

describe('rendering lifecycle: selectRenderState reflects ADD_ELEMENT', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createEditorDoc();
    seedPage(doc, 'page-1');
  });

  it('advances → reverts under undo → re-advances under redo', () => {
    const beforeState = selectRenderState(doc, 'page-1');
    expect(beforeState.components.length).toBe(0);
    expect(beforeState.drawnElements.length).toBe(0);

    const before = snapshot(doc);

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'section',
        classes: emptyClassData(),
        staticMarkup: '<section data-key="el-1">Hi</section>',
      },
    });

    const afterState = selectRenderState(doc, 'page-1');
    expect(afterState.components.length).toBe(1);
    expect(afterState.components[0].id).toBe('el-1');

    const after = snapshot(doc);

    const undoneDoc = restoreFrom(before);
    const undoneState = selectRenderState(undoneDoc, 'page-1');
    expect(undoneState.components.length).toBe(0);

    const redoneDoc = restoreFrom(after);
    const redoneState = selectRenderState(redoneDoc, 'page-1');
    expect(redoneState.components.length).toBe(1);
    expect(redoneState.components[0].id).toBe('el-1');
  });
});

describe('rendering lifecycle: drawn element insertion', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createEditorDoc();
    seedPage(doc, 'page-1');
  });

  it('drawn element appears in renderState; undo removes it; redo restores it', () => {
    const before = snapshot(doc);

    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: 'drawn-1',
        pageId: 'page-1',
        parentKey: null,
        insertIndex: 0,
        tag: 'span',
        classes: 'inline-block',
        textContent: '',
      },
    });

    const afterState = selectRenderState(doc, 'page-1');
    expect(afterState.drawnElements.map((d) => d.key)).toContain('drawn-1');

    const after = snapshot(doc);

    const undone = selectRenderState(restoreFrom(before), 'page-1');
    expect(undone.drawnElements.map((d) => d.key)).not.toContain('drawn-1');

    const redone = selectRenderState(restoreFrom(after), 'page-1');
    expect(redone.drawnElements.map((d) => d.key)).toContain('drawn-1');
  });
});

describe('rendering lifecycle: reorder reflected in renderState', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createEditorDoc();
    seedPage(doc, 'page-1');
    for (const [i, id] of ['el-a', 'el-b', 'el-c'].entries()) {
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id,
          pageId: 'page-1',
          parentId: null,
          index: i,
          type: 'section',
          classes: emptyClassData(),
          staticMarkup: `<section data-key="${id}">${id}</section>`,
        },
      });
    }
  });

  it('REORDER_PAGE_ELEMENTS surfaces a new component order through the selector', () => {
    const beforeOrder = selectRenderState(doc, 'page-1').components.map((c) => c.id);
    expect(beforeOrder).toEqual(['el-a', 'el-b', 'el-c']);

    const before = snapshot(doc);

    applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'page-1',
      elementIds: ['el-c', 'el-a', 'el-b'],
    });

    const afterOrder = selectRenderState(doc, 'page-1').components.map((c) => c.id);
    expect(afterOrder).toEqual(['el-c', 'el-a', 'el-b']);

    const after = snapshot(doc);

    expect(
      selectRenderState(restoreFrom(before), 'page-1').components.map((c) => c.id),
    ).toEqual(['el-a', 'el-b', 'el-c']);

    expect(
      selectRenderState(restoreFrom(after), 'page-1').components.map((c) => c.id),
    ).toEqual(['el-c', 'el-a', 'el-b']);
  });
});
