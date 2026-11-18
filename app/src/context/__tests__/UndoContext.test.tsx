import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
/**
 * UndoContext Tests
 *
 * Phase 6 tests covering:
 * - Initial state
 * - Stack management (canUndo, canRedo)
 * - Snapshot creation
 *
 * Note: Full undo/redo integration tests should be in E2E tests
 * since they require full app context with proper document binding.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { UndoProvider, useUndoContext, type UndoSnapshot } from '../UndoContext';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';

// Mock localStorage
const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]); },
});

/**
 * takeSnapshot only requests a checkpoint; the next user-origin transaction
 * commits it onto the stack (c8535b79). A "gesture" = checkpoint + user edit.
 */
let gestureCount = 0;
function userEdit(doc: Y.Doc, mutate?: () => void) {
  act(() => {
    doc.transact(() => {
      if (mutate) mutate();
      else doc.getMap('testGestures').set(`g-${gestureCount++}`, gestureCount);
    }, 'user');
  });
}
function gesture(ctx: { takeSnapshot: () => void }, doc: Y.Doc, mutate?: () => void) {
  act(() => { ctx.takeSnapshot(); });
  userEdit(doc, mutate);
}
async function undoAsync(ctx: { current: { undo: () => unknown } }) {
  await act(async () => { await ctx.current.undo(); });
}
async function redoAsync(ctx: { current: { redo: () => unknown } }) {
  await act(async () => { await ctx.current.redo(); });
}

describe('UndoContext', () => {
  let doc: Y.Doc;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    doc = createEditorDoc();
    vi.clearAllMocks();
    Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]);

    // EditorProvider owns its doc (a `doc` prop is ignored), so capture the
    // context doc. Undo/redo are durable acceptances (7932857b): seed a project id.
    const ProjectSeed = ({ children }: { children: React.ReactNode }) => {
      const contextDoc = useEditorDoc();
      doc = contextDoc;
      React.useLayoutEffect(() => { contextDoc.getMap('meta').set('projectId', crypto.randomUUID()); }, [contextDoc]);
      return <>{children}</>;
    };
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider>
        <ProjectSeed><UndoProvider>{children}</UndoProvider></ProjectSeed>
      </EditorProvider>
    );
  });

  // =====================================================
  // Initial State Tests
  // =====================================================
  describe('Initial State', () => {
    it('should start with empty undo/redo stacks', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });

    it('should provide undo function', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });
      expect(typeof result.current.undo).toBe('function');
    });

    it('should provide redo function', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });
      expect(typeof result.current.redo).toBe('function');
    });

    it('should provide takeSnapshot function', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });
      expect(typeof result.current.takeSnapshot).toBe('function');
    });

    it('should provide createSnapshot function', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });
      expect(typeof result.current.createSnapshot).toBe('function');
    });

    it('should have isUndoingRef as false initially', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });
      expect(result.current.isUndoingRef.current).toBe(false);
    });
  });

  // =====================================================
  // Stack Management Tests
  // =====================================================
  describe('Stack Management', () => {
    it('should set canUndo to true after takeSnapshot', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      expect(result.current.canUndo).toBe(false);

      act(() => {
        result.current.takeSnapshot();
      });
      // A bare request is not a step until a user transaction commits it.
      expect(result.current.canUndo).toBe(false);
      userEdit(doc);

      expect(result.current.canUndo).toBe(true);
    });

    it('should set canRedo to true after undo', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Take snapshot first
      gesture(result.current, doc);

      expect(result.current.canRedo).toBe(false);

      // Undo
      await undoAsync(result);

      expect(result.current.canRedo).toBe(true);
    });

    it('should clear future stack on new snapshot', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Take snapshot
      gesture(result.current, doc);

      // Undo to create future
      await undoAsync(result);

      expect(result.current.canRedo).toBe(true);

      // Take new snapshot - should clear future
      gesture(result.current, doc);

      expect(result.current.canRedo).toBe(false);
    });

    it('should decrease canUndo after undo', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Take two snapshots
      gesture(result.current, doc);
      gesture(result.current, doc);

      expect(result.current.canUndo).toBe(true);

      // Undo once
      await undoAsync(result);

      expect(result.current.canUndo).toBe(true);

      // Undo again
      await undoAsync(result);

      expect(result.current.canUndo).toBe(false);
    });

    it('should not fail when undo is called with empty stack', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Should not throw
      await undoAsync(result);

      expect(result.current.canUndo).toBe(false);
    });

    it('should not fail when redo is called with empty future', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Should not throw
      await redoAsync(result);

      expect(result.current.canRedo).toBe(false);
    });
  });

  // =====================================================
  // Snapshot Creation Tests
  // =====================================================
  describe('Snapshot Creation', () => {
    it('should create snapshot with sourceClasses property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('sourceClasses');
      expect(typeof snapshot!.sourceClasses).toBe('object');
    });

    it('should create snapshot with sourceText property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('sourceText');
      expect(typeof snapshot!.sourceText).toBe('object');
    });

    it('should create snapshot with pages property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('pages');
      expect(typeof snapshot!.pages).toBe('object');
    });

    it('should create snapshot with elements property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('elements');
      expect(typeof snapshot!.elements).toBe('object');
    });

    it('should create snapshot with rootPages property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('rootPages');
      expect(Array.isArray(snapshot!.rootPages)).toBe(true);
    });

    it('should create snapshot with pageOrder property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('pageOrder');
      expect(typeof snapshot!.pageOrder).toBe('object');
    });

    it('should create snapshot with unifiedOverrides property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('unifiedOverrides');
      expect(typeof snapshot!.unifiedOverrides).toBe('object');
    });

    it('should create snapshot with sourceLinkAttributes property', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!).toHaveProperty('sourceLinkAttributes');
      expect(typeof snapshot!.sourceLinkAttributes).toBe('object');
    });

    it('should capture and restore sourceLinkAttributes on undo', async () => {
      // Use a combined hook to access both undo context and the actual doc
      const { result } = await renderReadyEditorHook(() => {
        const undo = useUndoContext();
        const contextDoc = useEditorDoc();
        return { ...undo, doc: contextDoc };
      }, { wrapper });

      // Set up sourceLinkAttributes in Yjs using the actual doc from context
      const actualDoc = result.current.doc;
      const ySourceLinkAttrs = actualDoc.getMap('sourceLinkAttributes');
      const yAttrs = new Y.Map();
      ySourceLinkAttrs.set('src/Nav.astro:10:5', yAttrs);
      yAttrs.set('href', 'https://example.com');
      yAttrs.set('target', '_blank');

      // Verify snapshot captures the data
      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });
      expect(snapshot!.sourceLinkAttributes).toEqual({
        'src/Nav.astro:10:5': { href: 'https://example.com', target: '_blank' }
      });

      // Take snapshot (captures current state WITH link attrs)
      act(() => {
        result.current.takeSnapshot();
      });

      // Mutate: remove the link attributes (simulating a user action)
      userEdit(actualDoc, () => ySourceLinkAttrs.delete('src/Nav.astro:10:5'));
      expect(ySourceLinkAttrs.size).toBe(0);

      // Undo should restore the link attributes
      await undoAsync(result);

      expect(ySourceLinkAttrs.has('src/Nav.astro:10:5')).toBe(true);
      const restored = ySourceLinkAttrs.get('src/Nav.astro:10:5') as Y.Map<unknown>;
      expect(restored.get('href')).toBe('https://example.com');
      expect(restored.get('target')).toBe('_blank');
    });

    it('should capture astroSource in element snapshots', async () => {
      const { result } = await renderReadyEditorHook(() => {
        const undo = useUndoContext();
        const contextDoc = useEditorDoc();
        return { ...undo, doc: contextDoc };
      }, { wrapper });

      // Create an element with astroSource in Yjs
      const actualDoc = result.current.doc;
      const yElements = actualDoc.getMap('elements');
      const yPages = actualDoc.getMap('pages');

      // Create a page first
      const yPage = new Y.Map();
      yPage.set('id', 'page-1');
      yPage.set('name', 'Home');
      yPage.set('rootElementIds', Y.Array.from(['el-1']));
      yPage.set('children', Y.Array.from([]));
      yPages.set('page-1', yPage);

      // Create element with astroSource
      const yEl = new Y.Map();
      yEl.set('id', 'el-1');
      yEl.set('pageId', 'page-1');
      yEl.set('parentId', null);
      yEl.set('index', 0);
      yEl.set('type', 'instance');
      yEl.set('tag', 'section');
      yEl.set('astroSource', 'src/components/library/Hero.astro');
      yElements.set('el-1', yEl);

      let snapshot: UndoSnapshot;
      act(() => {
        snapshot = result.current.createSnapshot();
      });

      expect(snapshot!.elements['el-1']).toBeDefined();
      expect(snapshot!.elements['el-1'].astroSource).toBe('src/components/library/Hero.astro');
    });

    // =====================================================
    // Drawn slot fill/clear lifecycle — normal user flow
    // =====================================================
    const FILL = {
      slotComponentId: 'comp-1',
      slotComponentName: 'Hero',
      slotComponentMarkup: '<h1>Hero</h1>',
      slotComponentPath: 'library/Hero.astro',
    } as const;

    const setupDrawnSlot = (doc: Y.Doc, opts?: { filled?: boolean }) => {
      const yPage = new Y.Map();
      yPage.set('id', 'page-1');
      yPage.set('name', 'Home');
      yPage.set('rootElementIds', Y.Array.from(['drawn-slot-1']));
      yPage.set('children', Y.Array.from([]));
      doc.getMap('pages').set('page-1', yPage);

      const yEl = new Y.Map();
      yEl.set('id', 'drawn-slot-1');
      yEl.set('pageId', 'page-1');
      yEl.set('parentId', null);
      yEl.set('index', 0);
      yEl.set('type', 'frame');
      yEl.set('tag', 'div');
      yEl.set('isDrawn', true);
      yEl.set('slotType', 'slot');
      if (opts?.filled) for (const [k, v] of Object.entries(FILL)) yEl.set(k, v);
      doc.getMap('elements').set('drawn-slot-1', yEl);
      return yEl;
    };

    const isFilled = (yEl: Y.Map<unknown>) =>
      Object.keys(FILL).every(k => yEl.has(k));
    const isEmpty = (yEl: Y.Map<unknown>) =>
      Object.keys(FILL).every(k => !yEl.has(k));

    it('round-trips fill → undo → redo', async () => {
      const { result } = await renderReadyEditorHook(() => {
        const undo = useUndoContext();
        const contextDoc = useEditorDoc();
        return { ...undo, doc: contextDoc };
      }, { wrapper });

      const yEl = setupDrawnSlot(result.current.doc);
      expect(isEmpty(yEl)).toBe(true);

      // Fill (mirrors fillDrawnSlot in Editor.tsx)
      act(() => { result.current.takeSnapshot(); });
      userEdit(result.current.doc, () => { for (const [k, v] of Object.entries(FILL)) yEl.set(k, v); });
      expect(isFilled(yEl)).toBe(true);

      // Undo → empty again, with all four fields gone
      await undoAsync(result);
      expect(isEmpty(yEl)).toBe(true);

      // Redo → fully restored, including markup content
      await redoAsync(result);
      expect(yEl.get('slotComponentMarkup')).toBe(FILL.slotComponentMarkup);
      expect(yEl.get('slotComponentName')).toBe(FILL.slotComponentName);
      expect(yEl.get('slotComponentId')).toBe(FILL.slotComponentId);
      expect(yEl.get('slotComponentPath')).toBe(FILL.slotComponentPath);
    });

    it('round-trips clear → undo → redo via CLEAR_DRAWN_SLOT_FILL', async () => {
      const { result } = await renderReadyEditorHook(() => {
        const undo = useUndoContext();
        const contextDoc = useEditorDoc();
        return { ...undo, doc: contextDoc };
      }, { wrapper });

      const yEl = setupDrawnSlot(result.current.doc, { filled: true });

      // Clear via the actual command path
      act(() => { result.current.takeSnapshot(); });
      userEdit(result.current.doc, () => { applyCommand(result.current.doc, { type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: 'drawn-slot-1' }); });
      expect(isEmpty(yEl)).toBe(true);

      // Undo → fill restored to the exact prior state
      await undoAsync(result);
      expect(yEl.get('slotComponentMarkup')).toBe(FILL.slotComponentMarkup);
      expect(yEl.get('slotComponentName')).toBe(FILL.slotComponentName);

      // Redo → cleared again
      await redoAsync(result);
      expect(isEmpty(yEl)).toBe(true);
    });

    it('should capture and restore astroSource on undo of element deletion', async () => {
      const { result } = await renderReadyEditorHook(() => {
        const undo = useUndoContext();
        const contextDoc = useEditorDoc();
        return { ...undo, doc: contextDoc };
      }, { wrapper });

      const actualDoc = result.current.doc;
      const yElements = actualDoc.getMap('elements');
      const yPages = actualDoc.getMap('pages');
      const yRootPages = actualDoc.getArray('rootPages');

      // Create page and element with astroSource
      const yPage = new Y.Map();
      yPage.set('id', 'page-1');
      yPage.set('name', 'Home');
      yPage.set('rootElementIds', Y.Array.from(['el-1']));
      yPage.set('children', Y.Array.from([]));
      yPages.set('page-1', yPage);
      yRootPages.push(['page-1']);

      const yEl = new Y.Map();
      yEl.set('id', 'el-1');
      yEl.set('pageId', 'page-1');
      yEl.set('parentId', null);
      yEl.set('index', 0);
      yEl.set('type', 'instance');
      yEl.set('tag', 'section');
      yEl.set('astroSource', 'src/components/library/Hero.astro');
      yElements.set('el-1', yEl);

      // Take snapshot (captures state WITH astroSource)
      act(() => {
        result.current.takeSnapshot();
      });

      // Delete the element (simulating REMOVE_ELEMENT)
      userEdit(actualDoc, () => yElements.delete('el-1'));
      expect(yElements.has('el-1')).toBe(false);

      // Undo should restore the element with astroSource
      await undoAsync(result);

      expect(yElements.has('el-1')).toBe(true);
      const restored = yElements.get('el-1') as Y.Map<unknown>;
      expect(restored.get('astroSource')).toBe('src/components/library/Hero.astro');
    });
  });

  // =====================================================
  // Undo/Redo Cycle Tests
  // =====================================================
  describe('Undo/Redo Cycles', () => {
    it('should allow undo then redo to return to canRedo false', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Setup: take snapshot, undo to get canRedo
      gesture(result.current, doc);

      await undoAsync(result);

      expect(result.current.canRedo).toBe(true);

      // Redo
      await redoAsync(result);

      expect(result.current.canRedo).toBe(false);
      expect(result.current.canUndo).toBe(true);
    });

    it('should handle multiple snapshot/undo cycles', async () => {
      const { result } = await renderReadyEditorHook(() => useUndoContext(), { wrapper });

      // Multiple snapshots
      for (let i = 0; i < 5; i++) {
        gesture(result.current, doc);
      }

      expect(result.current.canUndo).toBe(true);

      // Multiple undos
      for (let i = 0; i < 5; i++) {
        await undoAsync(result);
      }

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    });
  });

  // =====================================================
  // Context Provider Error Tests
  // =====================================================
  describe('Context Provider Error', () => {
    it('should throw error when used outside provider', () => {
      // Temporarily suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useUndoContext());
      }).toThrow('useUndoContext must be used within UndoProvider');

      consoleSpy.mockRestore();
    });
  });
});
