// src/context/UndoContext.test.tsx
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { UndoProvider, useUndoContext } from './UndoContext';

// Mock EditorContext
const mockDoc = new Y.Doc();
// Undo/redo are durable acceptances (7932857b): they need a project id and
// IndexedDB. takeSnapshot is a pending checkpoint committed by the next
// user-origin transaction (c8535b79), so mutations run under origin 'user'.
mockDoc.getMap('meta').set('projectId', 'proj-undo-legacy');
const user = (fn: () => void) => mockDoc.transact(fn, 'user');
vi.mock('@/store/EditorContext', () => ({
  useEditorDoc: () => mockDoc,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <UndoProvider>{children}</UndoProvider>
);

describe('UndoContext', () => {
  it('provides undo context with initial state', () => {
    const { result } = renderHook(() => useUndoContext(), { wrapper });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(typeof result.current.undo).toBe('function');
    expect(typeof result.current.redo).toBe('function');
    expect(typeof result.current.takeSnapshot).toBe('function');
  });
});

describe('UndoContext snapshot operations', () => {
  beforeEach(() => {
    // Reset Y.Doc
    mockDoc.getMap('sourceClasses').clear();
    mockDoc.getMap('pages').clear();
  });

  it('createSnapshot captures current Yjs state', () => {
    // Set up some data in Yjs
    const sourceClasses = mockDoc.getMap('sourceClasses');
    const entry = new Y.Map();
    entry.set('classes', 'flex p-4');
    sourceClasses.set('Hero.astro:5:1', entry);

    const pages = mockDoc.getMap('pages');
    const page = new Y.Map();
    const rootIds = new Y.Array<string>();
    rootIds.push(['el-1', 'el-2']);
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);

    const { result } = renderHook(() => useUndoContext(), { wrapper });

    // createSnapshot should read from Yjs
    const snapshot = result.current.createSnapshot();

    expect(snapshot.sourceClasses['Hero.astro:5:1'].classes).toBe('flex p-4');
    expect(snapshot.pageOrder['page-1']).toEqual(['el-1', 'el-2']);
  });
});

describe('UndoContext multi-step operations', () => {
  beforeEach(() => {
    mockDoc.getMap('sourceClasses').clear();
    mockDoc.getMap('pages').clear();
  });

  it('maintains max 20 undo steps', async () => {
    const { result } = renderHook(() => useUndoContext(), { wrapper });

    // Take 25 snapshots
    for (let i = 0; i < 25; i++) {
      act(() => {
        result.current.takeSnapshot();
      });
      // Modify Yjs state
      const sourceClasses = mockDoc.getMap('sourceClasses');
      const entry = new Y.Map();
      entry.set('classes', `class-${i}`);
      act(() => { user(() => sourceClasses.set(`element-${i}`, entry)); });
    }

    // Undo all - should only undo 20
    let undoCount = 0;
    while (result.current.canUndo && undoCount < 30) {
      await act(async () => {
        await result.current.undo();
      });
      undoCount++;
    }

    expect(undoCount).toBe(20);
  });

  it('clears redo stack on new action', async () => {
    const { result } = renderHook(() => useUndoContext(), { wrapper });

    // Action 1
    act(() => {
      result.current.takeSnapshot();
    });
    act(() => { user(() => mockDoc.getMap('sourceClasses').set('el-1', new Y.Map())); });

    // Action 2
    act(() => {
      result.current.takeSnapshot();
    });
    act(() => { user(() => mockDoc.getMap('sourceClasses').set('el-2', new Y.Map())); });

    // Undo once
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    // New action (should clear redo)
    act(() => {
      result.current.takeSnapshot();
    });
    act(() => { user(() => mockDoc.getMap('sourceClasses').set('el-3', new Y.Map())); });

    expect(result.current.canRedo).toBe(false);
  });

  it('undo/redo preserves element order', async () => {
    const { result } = renderHook(() => useUndoContext(), { wrapper });

    // Set up initial state
    const pages = mockDoc.getMap('pages');
    const page = new Y.Map();
    const rootIds = new Y.Array<string>();
    rootIds.push(['el-1', 'el-2', 'el-3']);
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);

    // Take snapshot before reorder
    act(() => {
      result.current.takeSnapshot();
    });

    // Reorder elements
    act(() => { user(() => {
      rootIds.delete(0, 3);
      rootIds.push(['el-3', 'el-1', 'el-2']);
    }); });

    // Undo should restore original order
    await act(async () => {
      await result.current.undo();
    });

    const snapshot = result.current.createSnapshot();
    expect(snapshot.pageOrder['page-1']).toEqual(['el-1', 'el-2', 'el-3']);
  });
});

describe('UndoContext applySnapshot', () => {
  beforeEach(() => {
    mockDoc.getMap('sourceClasses').clear();
    mockDoc.getMap('pages').clear();
  });

  it('restores sourceClasses from snapshot', async () => {
    const { result } = renderHook(() => useUndoContext(), { wrapper });

    // Initial state
    const sourceClasses = mockDoc.getMap('sourceClasses');
    const entry = new Y.Map();
    entry.set('classes', 'original-class');
    sourceClasses.set('element-1', entry);

    // Take snapshot
    act(() => {
      result.current.takeSnapshot();
    });

    // Modify
    act(() => { user(() => entry.set('classes', 'modified-class')); });

    // Undo
    await act(async () => {
      await result.current.undo();
    });

    // Verify restored
    const restoredEntry = sourceClasses.get('element-1') as Y.Map<unknown>;
    expect(restoredEntry.get('classes')).toBe('original-class');
  });
});
