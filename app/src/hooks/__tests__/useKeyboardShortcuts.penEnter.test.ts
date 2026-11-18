/**
 * Enter on a selected pen shape opens node editing (2026-07-24) — dispatches
 * 'sq:request-pen-edit' instead of drilling / entering text edit mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

const doc = new Y.Doc();
let mockSelectedKey: string | null = null;

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn() }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(),
  useYjsValue: () => null,
  useEditorDoc: () => doc,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn(), takeSnapshot: vi.fn() }),
}));

vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: mockSelectedKey,
    selectedElementId: mockSelectedKey,
    selectedSourceLocation: null,
    clearSelection: vi.fn(),
    contextKey: null,
    enterContext: vi.fn(),
    exitContext: vi.fn(),
    select: vi.fn(),
    additionalSelections: [],
    clearAdditionalSelections: vi.fn(),
  }),
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: [] },
    scannedByKeyRef: { current: new Map() },
    treeNodesRef: { current: [] },
  }),
}));

function press(key: string): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('Enter on a pen shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.transact(() => {
      const el = new Y.Map<unknown>();
      el.set('id', 'drawn-pen-1');
      el.set('penPath', '{"anchors":[{"x":0,"y":0,"corner":true},{"x":10,"y":10,"corner":true}],"closed":false}');
      doc.getMap('elements').set('drawn-pen-1', el);
      const plain = new Y.Map<unknown>();
      plain.set('id', 'drawn-plain-1');
      doc.getMap('elements').set('drawn-plain-1', plain);
    });
  });

  it('dispatches sq:request-pen-edit for penPath elements', () => {
    mockSelectedKey = 'drawn-pen-1';
    const events: string[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail?.key);
    window.addEventListener('sq:request-pen-edit', listener);
    renderHook(() => useKeyboardShortcuts());
    press('Enter');
    window.removeEventListener('sq:request-pen-edit', listener);
    expect(events).toEqual(['drawn-pen-1']);
  });

  it('does NOT fire pen edit for elements without penPath', () => {
    mockSelectedKey = 'drawn-plain-1';
    const listener = vi.fn();
    window.addEventListener('sq:request-pen-edit', listener);
    renderHook(() => useKeyboardShortcuts());
    press('Enter');
    window.removeEventListener('sq:request-pen-edit', listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
