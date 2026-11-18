// Keyboard delete on the blog post page's content slot must be refused at the
// keyboard layer. commands.ts already refuses REMOVE_ELEMENT /
// DELETE_INSTANCE_CHILD for `bindingType === 'collection-content'`, but the
// hook used to post SYNC_REMOVE_ELEMENT_FROM_DOM (and take a snapshot)
// unconditionally — so a refused delete still visually removed the slot from
// the iframe until the next RENDER.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { ScannedElement } from '@/context/SelectionContext';

let mockDoc = new Y.Doc();
const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockClearSelection = vi.fn();

let mockSelectedKey: string | null = null;
let mockScanned: ScannedElement[] = [];

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn() }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => null,
  useEditorDoc: () => mockDoc,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn(), takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: mockSelectedKey,
    selectedElementId: null,
    selectedSourceLocation: null,
    clearSelection: mockClearSelection,
    contextKey: null,
    enterContext: vi.fn(),
    exitContext: vi.fn(),
    select: vi.fn(),
    additionalSelections: [],
    clearAdditionalSelections: vi.fn(),
  }),
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: mockScanned },
    scannedByKeyRef: { current: new Map() },
    treeNodesRef: { current: [] },
  }),
}));

const makeScanned = (key: string, parentKey: string | null): ScannedElement => ({
  key,
  parentKey,
  tagName: 'div',
  classes: '',
  rect: { top: 0, left: 0, width: 100, height: 100 },
  hasSourceTracking: true,
});

function addElement(id: string, fields: Record<string, unknown> = {}): void {
  const el = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) el.set(k, v);
  mockDoc.getMap('elements').set(id, el);
}

function pressDelete(key: 'Backspace' | 'Delete' = 'Backspace'): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('keyboard delete on the content slot (bindingType collection-content)', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc = new Y.Doc();
    mockSelectedKey = null;
    mockScanned = [];
    postMessageSpy = vi.spyOn(window, 'postMessage');
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  const syncRemovePosted = () =>
    postMessageSpy.mock.calls.some(
      ([msg]) => (msg as { type?: string })?.type === 'SYNC_REMOVE_ELEMENT_FROM_DOM',
    );

  it('refuses Backspace on an inner child of the content slot (no dispatch, no DOM sync, no snapshot)', () => {
    addElement('el-content', { bindingType: 'collection-content' });
    mockScanned = [
      makeScanned('el-content:article-0', 'src/pages/posts/[slug].astro:10:1'),
      makeScanned('el-content:div-0', 'el-content:article-0'),
    ];
    mockSelectedKey = 'el-content:div-0';

    renderHook(() => useKeyboardShortcuts());
    pressDelete('Backspace');

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(syncRemovePosted()).toBe(false);
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
    expect(mockClearSelection).not.toHaveBeenCalled();
  });

  it('refuses Delete on the content slot root (REMOVE_ELEMENT path)', () => {
    addElement('el-content', { bindingType: 'collection-content' });
    mockScanned = [
      makeScanned('el-content:article-0', 'src/pages/posts/[slug].astro:10:1'),
    ];
    mockSelectedKey = 'el-content:article-0';

    renderHook(() => useKeyboardShortcuts());
    pressDelete('Delete');

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(syncRemovePosted()).toBe(false);
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
  });

  it('still deletes a normal element (guard is not over-broad)', async () => {
    addElement('el-hero', {});
    mockScanned = [
      makeScanned('el-hero:section-0', 'src/pages/index.astro:5:1'),
      makeScanned('el-hero:div-0', 'el-hero:section-0'),
    ];
    mockSelectedKey = 'el-hero:div-0';

    renderHook(() => useKeyboardShortcuts());
    pressDelete('Backspace');

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'DELETE_INSTANCE_CHILD',
      instanceId: 'el-hero',
      selector: 'div-0',
    });
    // The DOM sync is published only after the (async) dispatch resolves.
    await vi.waitFor(() => expect(syncRemovePosted()).toBe(true));
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
  });
});
