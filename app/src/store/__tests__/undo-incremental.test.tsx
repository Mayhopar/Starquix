import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
/**
 * task-120 (7.1) — incremental undo snapshots. Known command types capture
 * only the sections they can write ('classes' → sourceClasses + elements +
 * unifiedOverrides); unknown types fall back to a FULL snapshot; partial
 * snapshots restore exactly, including across a mixed sequence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { applyCommand } from '@/store/commands';
import { emptyClassData } from '@/store/types';

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key]); },
});

function seedPage(doc: Y.Doc, pageId: string): void {
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('name', 'Page');
  page.set('rootElementIds', new Y.Array<string>());
  pages.set(pageId, page);
  doc.getArray<string>('rootPages').push([pageId]);
}

function setSourceClasses(doc: Y.Doc, key: string, classes: string): void {
  act(() => doc.transact(() => {
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes });
  }, 'user'));
}

// EditorProvider creates its OWN doc — reach it via useEditorDoc.
function useHarness() {
  return { undoCtx: useUndoContext(), doc: useEditorDoc() };
}

describe('incremental undo snapshots (task-120)', () => {
  let doc: Y.Doc;
  let undoApi: () => ReturnType<typeof useUndoContext>;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider>
        <UndoProvider>{children}</UndoProvider>
      </EditorProvider>
    );
  });

  async function mount() {
    const { result } = await renderReadyEditorHook(() => useHarness(), { wrapper });
    doc = result.current.doc;
    doc.getMap('meta').set('projectId', `undo-test:${crypto.randomUUID()}`);
    seedPage(doc, 'page-1');
    undoApi = () => result.current.undoCtx;
    return result;
  }

  it("'classes' scope captures sourceClasses+elements only, not pages/variables/db", async () => {
    await mount();
    const result = { get current() { return undoApi(); } };
    setSourceClasses(doc, 'k1', 'p-4');

    const snap = result.current.createSnapshot(['sourceClasses', 'elements', 'unifiedOverrides']);
    expect(Object.keys(snap.sourceClasses)).toEqual(['k1']);
    expect(snap.scope).toEqual(['sourceClasses', 'elements', 'unifiedOverrides']);
    // Uncaptured sections stay empty even though the doc has a page
    expect(snap.pages).toEqual({});
    expect(snap.rootPages).toEqual([]);
  });

  it('unknown command type → full snapshot (fallback)', async () => {
    await mount();
    const result = { get current() { return undoApi(); } };
    act(() => result.current.takeSnapshot(undefined, 'SOME_NEW_COMMAND'));
    // Full snapshot: pages captured despite the type being unknown
    // (verified via undo restoring a page deletion)
    act(() => {
      doc.transact(() => { doc.getMap('pages').delete('page-1'); }, 'user');
    });
    expect(doc.getMap('pages').get('page-1')).toBeUndefined();
    await act(async () => { await result.current.undo(); });
    expect(doc.getMap('pages').get('page-1')).toBeTruthy();
  });

  it('undo after a scoped class edit restores exactly', async () => {
    await mount();
    const result = { get current() { return undoApi(); } };
    setSourceClasses(doc, 'k1', 'p-4');

    act(() => result.current.takeSnapshot(undefined, 'UPDATE_SOURCE_CLASSES'));
    setSourceClasses(doc, 'k1', 'p-8 text-red-500');

    await act(async () => { await result.current.undo(); });
    const entry = doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('p-4');

    await act(async () => { await result.current.redo(); });
    const entry2 = doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>;
    expect(entry2.get('classes')).toBe('p-8 text-red-500');
  });

  it('a partial snapshot must not clobber state it did not capture', async () => {
    await mount();
    const result = { get current() { return undoApi(); } };
    setSourceClasses(doc, 'k1', 'p-4');
    act(() => result.current.takeSnapshot(undefined, 'UPDATE_SOURCE_CLASSES'));
    setSourceClasses(doc, 'k1', 'p-8');

    // AFTER the scoped snapshot, an unrelated page appears (out of scope)
    act(() => {
      doc.transact(() => { seedPage(doc, 'page-2'); }, 'user');
    });

    await act(async () => { await result.current.undo(); });
    // Class change undone…
    const entry = doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('p-4');
    // …but the page (never captured) survives
    expect(doc.getMap('pages').get('page-2')).toBeTruthy();
  });

  it('mixed sequence: class edit → page add → class edit undoes correctly at each step', async () => {
    await mount();
    const result = { get current() { return undoApi(); } };
    setSourceClasses(doc, 'k1', 'a');

    act(() => result.current.takeSnapshot(undefined, 'UPDATE_SOURCE_CLASSES'));
    setSourceClasses(doc, 'k1', 'b');

    act(() => result.current.takeSnapshot()); // page add → full snapshot
    act(() => {
      doc.transact(() => {
        applyCommand(doc, {
          type: 'ADD_ELEMENT',
          element: {
            id: 'el-1', pageId: 'page-1', parentId: null, index: 0,
            type: 'section', classes: emptyClassData(),
            staticMarkup: '<section data-key="el-1">Hi</section>',
          },
        });
      }, 'user');
    });

    act(() => result.current.takeSnapshot(undefined, 'UPDATE_SOURCE_CLASSES'));
    setSourceClasses(doc, 'k1', 'c');

    // Undo 3: class c → b
    await act(async () => { await result.current.undo(); });
    expect((doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>).get('classes')).toBe('b');
    expect(doc.getMap('elements').get('el-1')).toBeTruthy();

    // Undo 2: element removed
    await act(async () => { await result.current.undo(); });
    expect(doc.getMap('elements').get('el-1')).toBeUndefined();
    expect((doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>).get('classes')).toBe('b');

    // Undo 1: class b → a
    await act(async () => { await result.current.undo(); });
    expect((doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>).get('classes')).toBe('a');

    // Redo the whole chain
    await act(async () => { await result.current.redo(); });
    expect((doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>).get('classes')).toBe('b');
    await act(async () => { await result.current.redo(); });
    expect(doc.getMap('elements').get('el-1')).toBeTruthy();
    await act(async () => { await result.current.redo(); });
    expect((doc.getMap('sourceClasses').get('k1') as Y.Map<unknown>).get('classes')).toBe('c');
  });
});
