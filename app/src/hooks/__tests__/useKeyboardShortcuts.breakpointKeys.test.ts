// Plain 1–6 switch breakpoints (xs…2xl); guarded off inside inputs and by modifiers.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

const mockDispatch = vi.fn();
const mockSetActiveTool = vi.fn();

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: 'select', setActiveTool: mockSetActiveTool }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => null,
  useEditorDoc: () => new Y.Doc(),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn(), takeSnapshot: vi.fn() }),
}));

vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: null,
    selectedElementId: null,
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

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

describe('breakpoint number shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1–6 dispatch SET_BREAKPOINT xs…2xl', () => {
    renderHook(() => useKeyboardShortcuts());
    const expected = ['base', 'sm', 'md', 'lg', 'xl', '2xl'];
    for (let i = 0; i < 6; i++) {
      press(String(i + 1));
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_BREAKPOINT', breakpoint: expected[i] });
    }
    expect(mockDispatch).toHaveBeenCalledTimes(6);
  });

  it('ignores digits with modifiers (Shift+1 = zoom-to-fit, not a breakpoint)', () => {
    renderHook(() => useKeyboardShortcuts());
    press('1', { shiftKey: true, code: 'Digit1' });
    press('2', { ctrlKey: true });
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_BREAKPOINT' }),
    );
  });

  it('ignores digits typed into an input', () => {
    renderHook(() => useKeyboardShortcuts());
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }),
    );
    expect(mockDispatch).not.toHaveBeenCalled();
    input.remove();
  });
});
