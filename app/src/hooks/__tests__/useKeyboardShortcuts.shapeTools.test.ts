// task-106 vector shapes: R/O/L arm shape tools; Escape disarms any non-select
// tool BEFORE touching multi-select/context/selection.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { DrawTool } from '@/context/ToolContext';

const mockSetActiveTool = vi.fn();
let mockActiveTool: DrawTool = 'select';
const mockClearSelection = vi.fn();
const mockClearAdditionalSelections = vi.fn();

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: mockActiveTool, setActiveTool: mockSetActiveTool }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(),
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
    clearSelection: mockClearSelection,
    contextKey: null,
    enterContext: vi.fn(),
    exitContext: vi.fn(),
    select: vi.fn(),
    additionalSelections: [],
    clearAdditionalSelections: mockClearAdditionalSelections,
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

describe('shape tool shortcuts (task-106)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTool = 'select';
  });

  it.each([
    ['r', 'rect'],
    ['o', 'ellipse'],
    ['l', 'line'],
    ['p', 'pen'],
  ])('%s arms the %s tool', (key, tool) => {
    renderHook(() => useKeyboardShortcuts());
    press(key);
    expect(mockSetActiveTool).toHaveBeenCalledWith(tool);
  });

  it('Escape disarms a non-select tool and touches nothing else', () => {
    mockActiveTool = 'line';
    renderHook(() => useKeyboardShortcuts());
    press('Escape');
    expect(mockSetActiveTool).toHaveBeenCalledWith('select');
    expect(mockClearSelection).not.toHaveBeenCalled();
    expect(mockClearAdditionalSelections).not.toHaveBeenCalled();
  });

  it('Escape with select tool active does not re-set the tool', () => {
    mockActiveTool = 'select';
    renderHook(() => useKeyboardShortcuts());
    press('Escape');
    expect(mockSetActiveTool).not.toHaveBeenCalled();
  });
});
