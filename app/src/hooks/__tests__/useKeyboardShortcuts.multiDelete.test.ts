// Phase-1 multi-select group Delete: one takeSnapshot (one undo step), the
// existing per-kind single-key delete logic applied per entry, guarded entries
// (content slot) skipped without aborting the group. Escape collapses the
// extension set FIRST (context and primary untouched).
// Design: docs/archive/plans/2026-06-11-multi-select-design.md §4.3/§4.5.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { MultiSelectionEntry, ScannedElement } from '@/context/SelectionContext';

let mockDoc = new Y.Doc();
const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockClearSelection = vi.fn();
const mockClearAdditionalSelections = vi.fn();
const mockExitContext = vi.fn();

let mockSelectedKey: string | null = null;
let mockSelectedElementId: string | null = null;
let mockContextKey: string | null = null;
let mockAdditionalSelections: MultiSelectionEntry[] = [];
let mockScanned: ScannedElement[] = [];

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn() }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => mockSelectedElementId,
  useEditorDoc: () => mockDoc,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn(), takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: mockSelectedKey,
    selectedElementId: mockSelectedElementId,
    selectedSourceLocation: null,
    clearSelection: mockClearSelection,
    contextKey: mockContextKey,
    enterContext: vi.fn(),
    exitContext: mockExitContext,
    select: vi.fn(),
    additionalSelections: mockAdditionalSelections,
    clearAdditionalSelections: mockClearAdditionalSelections,
  }),
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: mockScanned },
    scannedByKeyRef: { current: new Map(mockScanned.map((el) => [el.key, el])) },
    treeNodesRef: { current: [] },
  }),
}));

function addElement(id: string, fields: Record<string, unknown> = {}): void {
  const el = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) el.set(k, v);
  mockDoc.getMap('elements').set(id, el);
}

async function press(key: string): Promise<void> {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
  if (key === 'Delete') await waitFor(() => expect(mockClearSelection).toHaveBeenCalled());
}

describe('group Delete + Escape with multi-selection extras', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc = new Y.Doc();
    mockDoc.getMap('meta').set('projectId', crypto.randomUUID());
    mockSelectedKey = null;
    mockSelectedElementId = null;
    mockContextKey = null;
    mockAdditionalSelections = [];
    mockScanned = [];
    postMessageSpy = vi.spyOn(window, 'postMessage');
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  const syncRemoveKeys = () =>
    postMessageSpy.mock.calls
      .filter(([msg]) => (msg as { type?: string })?.type === 'SYNC_REMOVE_ELEMENT_FROM_DOM')
      .map(([msg]) => (msg as { payload: { key: string } }).payload.key);

  it('deletes the whole group under ONE snapshot and clears selection', async () => {
    addElement('el-a', {});
    addElement('el-b', {});
    mockSelectedKey = 'el-a';
    mockSelectedElementId = 'el-a';
    mockAdditionalSelections = [{ key: 'el-b', elementId: 'el-b' }];

    renderHook(() => useKeyboardShortcuts());
    await press('Delete');

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDoc.getMap('elements').has('el-a')).toBe(false);
    expect(mockDoc.getMap('elements').has('el-b')).toBe(false);
    // task-075: clearSelection() is the single deselect — no SELECT_ELEMENT dispatch
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SELECT_ELEMENT' }),
    );
    expect(mockClearSelection).toHaveBeenCalledTimes(1);
  });

  it('mixed kinds: per-entry delete semantics (root → REMOVE_ELEMENT, child → DELETE_INSTANCE_CHILD)', async () => {
    addElement('el-a', {});
    addElement('el-c', {});
    mockScanned = [
      // el-c root + two children so el-c:div-1 is NOT the instance root.
      {
        key: 'el-c:section-0', parentKey: null, tagName: 'section', classes: '',
        rect: { top: 0, left: 0, width: 10, height: 10 }, hasSourceTracking: true,
      },
      {
        key: 'el-c:div-1', parentKey: 'el-c:section-0', tagName: 'div', classes: '',
        rect: { top: 0, left: 0, width: 10, height: 10 }, hasSourceTracking: true,
      },
    ];
    mockSelectedKey = 'el-a';
    mockSelectedElementId = 'el-a';
    mockAdditionalSelections = [{ key: 'el-c:div-1', elementId: 'el-c' }];

    renderHook(() => useKeyboardShortcuts());
    await press('Delete');

    expect(mockDoc.getMap('elements').has('el-a')).toBe(false);
    expect((mockDoc.getMap<Y.Map<unknown>>('elements').get('el-c')?.get('deletedSelectors') as Y.Array<string>).toArray()).toContain('div-1');
    expect(syncRemoveKeys()).toContain('el-a');
    expect(syncRemoveKeys()).toContain('el-c:div-1');
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('guarded entry (content slot) is skipped, the rest of the group is deleted', async () => {
    addElement('el-a', {});
    addElement('el-content', { bindingType: 'collection-content' });
    mockSelectedKey = 'el-a';
    mockSelectedElementId = 'el-a';
    mockAdditionalSelections = [{ key: 'el-content:article-0', elementId: 'el-content' }];

    renderHook(() => useKeyboardShortcuts());
    await press('Delete');

    expect(mockDoc.getMap('elements').has('el-a')).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'el-content' }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'el-content' }),
    );
    expect(syncRemoveKeys()).not.toContain('el-content:article-0');
  });

  it('drawn extras route to REMOVE_DRAWN_ELEMENT', async () => {
    addElement('el-a', {});
    addElement('drawn-x', { isDrawn: true });
    mockSelectedKey = 'el-a';
    mockSelectedElementId = 'el-a';
    mockAdditionalSelections = [{ key: 'drawn-x', elementId: null }];

    renderHook(() => useKeyboardShortcuts());
    await press('Delete');

    expect(mockDoc.getMap('elements').has('drawn-x')).toBe(false);
    expect(mockDoc.getMap('elements').has('el-a')).toBe(false);
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('parent+child group: child is pruned — one REMOVE_ELEMENT, no child dispatch', async () => {
    addElement('el-a', {});
    mockScanned = [
      { key: 'el-a:section-0', parentKey: null, tagName: 'section', classes: '',
        rect: { top: 0, left: 0, width: 10, height: 10 }, hasSourceTracking: true },
      { key: 'el-a:div-1', parentKey: 'el-a:section-0', tagName: 'div', classes: '',
        rect: { top: 0, left: 0, width: 10, height: 10 }, hasSourceTracking: true },
    ];
    mockSelectedKey = 'el-a:section-0';
    mockSelectedElementId = 'el-a';
    mockAdditionalSelections = [{ key: 'el-a:div-1', elementId: 'el-a' }];

    renderHook(() => useKeyboardShortcuts());
    await press('Delete');

    expect(mockDoc.getMap('elements').has('el-a')).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELETE_INSTANCE_CHILD' }));
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('Escape clears extras first; context and primary stay; second Escape exits context', async () => {
    mockSelectedKey = 'el-a';
    mockContextKey = 'el-ctx';
    mockAdditionalSelections = [{ key: 'el-b', elementId: 'el-b' }];

    const { rerender } = renderHook(() => useKeyboardShortcuts());
    await press('Escape');

    expect(mockClearAdditionalSelections).toHaveBeenCalledTimes(1);
    expect(mockExitContext).not.toHaveBeenCalled();
    expect(mockClearSelection).not.toHaveBeenCalled();

    // Extras now cleared — the next Escape behaves as today (exit context).
    mockAdditionalSelections = [];
    rerender();
    await press('Escape');

    expect(mockExitContext).toHaveBeenCalledTimes(1);
    expect(mockClearSelection).not.toHaveBeenCalled();
  });
});
