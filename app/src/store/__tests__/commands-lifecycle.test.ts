/**
 * Lifecycle tests for the `commands` system.
 *
 * Shape (matches the slot-fill undo shape we shipped in UndoContext tests):
 *   1. Seed realistic Yjs state
 *   2. Snapshot pre-state via Y.encodeStateAsUpdate
 *   3. Apply the command, assert post-state
 *   4. Undo by recreating the doc from the pre-state snapshot, assert pre-state
 *   5. Redo by applying the post-state delta, assert post-state again
 *
 * Targets the three commands that carry the highest-risk footguns per
 * systems.json knownIssues:
 * - ADD_ELEMENT  (drawn-element insertion edge cases, layout reparenting)
 * - REORDER_PAGE_ELEMENTS  (rootElementIds is replaced wholesale)
 * - DELETE_INSTANCE_CHILD  (MUST cascade to drawn children; this is the
 *   one regression class we know exists per MEMORY.md 2026-03-05)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { emptyClassData } from '../types';

// ADD_DRAWN_ELEMENT dispatches a CustomEvent on window; stub to keep it silent.
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

/** Capture a Yjs state vector so we can rebuild the doc at this point. */
function snapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Apply a captured snapshot onto a freshly-recreated doc (lifecycle undo). */
function restoreFrom(snapshotState: Uint8Array): Y.Doc {
  const fresh = createEditorDoc();
  Y.applyUpdate(fresh, snapshotState);
  return fresh;
}

function seedPage(doc: Y.Doc, pageId: string): Y.Map<unknown> {
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('name', 'Page');
  page.set('rootElementIds', new Y.Array<string>());
  pages.set(pageId, page);
  doc.getArray<string>('rootPages').push([pageId]);
  return page as Y.Map<unknown>;
}

function rootIdsOf(doc: Y.Doc, pageId: string): string[] {
  const page = doc.getMap('pages').get(pageId) as Y.Map<unknown>;
  return (page.get('rootElementIds') as Y.Array<string>).toArray();
}

describe('commands lifecycle: ADD_ELEMENT', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createEditorDoc();
    seedPage(doc, 'page-1');
  });

  it('adds → undo removes → redo re-adds (root element)', () => {
    const before = snapshot(doc);
    expect(rootIdsOf(doc, 'page-1')).toEqual([]);

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

    expect(rootIdsOf(doc, 'page-1')).toEqual(['el-1']);
    expect(doc.getMap('elements').has('el-1')).toBe(true);

    const after = snapshot(doc);

    // Undo: rebuild from pre-state
    const undone = restoreFrom(before);
    expect(rootIdsOf(undone, 'page-1')).toEqual([]);
    expect(undone.getMap('elements').has('el-1')).toBe(false);

    // Redo: rebuild from post-state
    const redone = restoreFrom(after);
    expect(rootIdsOf(redone, 'page-1')).toEqual(['el-1']);
    expect(redone.getMap('elements').has('el-1')).toBe(true);
  });
});

describe('commands lifecycle: REORDER_PAGE_ELEMENTS', () => {
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
        },
      });
    }
  });

  it('reorders → undo restores original order → redo re-reorders', () => {
    expect(rootIdsOf(doc, 'page-1')).toEqual(['el-a', 'el-b', 'el-c']);
    const before = snapshot(doc);

    applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'page-1',
      elementIds: ['el-c', 'el-a', 'el-b'],
    });

    expect(rootIdsOf(doc, 'page-1')).toEqual(['el-c', 'el-a', 'el-b']);
    const after = snapshot(doc);

    const undone = restoreFrom(before);
    expect(rootIdsOf(undone, 'page-1')).toEqual(['el-a', 'el-b', 'el-c']);

    const redone = restoreFrom(after);
    expect(rootIdsOf(redone, 'page-1')).toEqual(['el-c', 'el-a', 'el-b']);
  });
});

describe('commands lifecycle: DELETE_INSTANCE_CHILD (with drawn-child cascade)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createEditorDoc();
    seedPage(doc, 'page-1');

    // Seed an instance with a child selector "p-0" that will host a drawn child.
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'inst-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'section',
        classes: emptyClassData(),
        staticMarkup: '<section data-key="inst-1"><p data-key="inst-1:p-0">x</p></section>',
      },
    });

    // Add a drawn element parented to inst-1:p-0 (the instance child key).
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: 'drawn-1',
        pageId: 'page-1',
        parentKey: 'inst-1:p-0',
        insertIndex: 0,
        tag: 'span',
        classes: 'w-8 h-8',
        textContent: '',
      },
    });
  });

  it('deleting an instance child cascades to drawn children; undo restores both', () => {
    // Pre-state: drawn element exists and is parented to inst-1:p-0.
    const drawnBefore = doc.getMap('elements').get('drawn-1') as Y.Map<unknown> | undefined;
    expect(drawnBefore).toBeDefined();
    expect(drawnBefore!.get('parentId')).toBe('inst-1:p-0');

    const before = snapshot(doc);

    applyCommand(doc, {
      type: 'DELETE_INSTANCE_CHILD',
      instanceId: 'inst-1',
      selector: 'p-0',
    });

    // Post-state: deletedSelectors records "p-0"; drawn child has cascaded away.
    const instance = doc.getMap('elements').get('inst-1') as Y.Map<unknown>;
    const deletedSelectors = instance.get('deletedSelectors') as Y.Array<string>;
    expect(deletedSelectors.toArray()).toContain('p-0');
    expect(doc.getMap('elements').has('drawn-1')).toBe(false);

    const after = snapshot(doc);

    // Undo: drawn element comes back AND has its original parentId.
    const undone = restoreFrom(before);
    const drawnAfterUndo = undone.getMap('elements').get('drawn-1') as Y.Map<unknown> | undefined;
    expect(drawnAfterUndo).toBeDefined();
    expect(drawnAfterUndo!.get('parentId')).toBe('inst-1:p-0');
    const instanceAfterUndo = undone.getMap('elements').get('inst-1') as Y.Map<unknown>;
    expect(instanceAfterUndo.get('deletedSelectors')).toBeUndefined();

    // Redo: drawn gone, selector marked deleted again.
    const redone = restoreFrom(after);
    expect(redone.getMap('elements').has('drawn-1')).toBe(false);
    const instanceAfterRedo = redone.getMap('elements').get('inst-1') as Y.Map<unknown>;
    expect(
      (instanceAfterRedo.get('deletedSelectors') as Y.Array<string>).toArray(),
    ).toContain('p-0');
  });
});
