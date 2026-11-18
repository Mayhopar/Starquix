// ⌘C/⌘X/⌘V/⌘D element-clipboard wiring: gates (selection, preview, input
// target) and routing into the clipboardActions service.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { copySelection, cutSelection, pasteClipboard, duplicateSelection } from '@/clipboard/clipboardActions';
import type { MultiSelectionEntry, ScannedElement } from '@/context/SelectionContext';

vi.mock('@/clipboard/clipboardActions', () => ({
  copySelection: vi.fn(async () => true),
  cutSelection: vi.fn(async () => {}),
  pasteClipboard: vi.fn(async () => {}),
  duplicateSelection: vi.fn(async () => {}),
}));

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() });
  return { default: t, toast: t, Toaster: () => null };
});

let mockDoc = new Y.Doc();
const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockPushStructuralUndo = vi.fn();
const mockClearSelection = vi.fn();

let mockSelectedKey: string | null = null;
let mockSelectedElementId: string | null = null;
let mockAdditionalSelections: MultiSelectionEntry[] = [];
let mockScanned: ScannedElement[] = [];
let mockIsPreview = false;

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({
    activeTool: 'select',
    setActiveTool: vi.fn(),
    isPreview: mockIsPreview,
    setPreview: vi.fn(),
  }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => mockSelectedElementId,
  useEditorDoc: () => mockDoc,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    undo: vi.fn(),
    redo: vi.fn(),
    takeSnapshot: mockTakeSnapshot,
    pushStructuralUndo: mockPushStructuralUndo,
  }),
}));

vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: mockSelectedKey,
    selectedElementId: mockSelectedElementId,
    selectedSourceLocation: null,
    clearSelection: mockClearSelection,
    contextKey: null,
    enterContext: vi.fn(),
    exitContext: vi.fn(),
    select: vi.fn(),
    additionalSelections: mockAdditionalSelections,
    clearAdditionalSelections: vi.fn(),
  }),
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: mockScanned },
    scannedByKeyRef: { current: new Map(mockScanned.map((el) => [el.key, el])) },
    treeNodesRef: { current: [] },
  }),
}));

const copyFn = copySelection as ReturnType<typeof vi.fn>;
const cutFn = cutSelection as ReturnType<typeof vi.fn>;
const pasteFn = pasteClipboard as ReturnType<typeof vi.fn>;
const dupFn = duplicateSelection as ReturnType<typeof vi.fn>;

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  // Both modifiers: getModifierKey picks metaKey on Mac, ctrlKey elsewhere (jsdom).
  const evt = new KeyboardEvent('keydown', { key, metaKey: true, ctrlKey: true, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(evt);
  return evt;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc = new Y.Doc();
  mockDoc.getMap('meta').set('projectId', 'browser_test');
  mockSelectedKey = null;
  mockSelectedElementId = null;
  mockAdditionalSelections = [];
  mockScanned = [];
  mockIsPreview = false;
});

describe('⌘C/⌘X/⌘V/⌘D clipboard shortcuts', () => {
  it('⌘C with a selection calls copySelection and preventDefaults', () => {
    mockSelectedKey = 'drawn-1';
    mockSelectedElementId = 'drawn-1';
    renderHook(() => useKeyboardShortcuts());
    const evt = press('c');
    expect(copyFn).toHaveBeenCalledTimes(1);
    expect(copyFn.mock.calls[0][0].entries).toEqual([{ key: 'drawn-1', elementId: 'drawn-1' }]);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('⌘C without a selection neither copies nor preventDefaults (native copy)', () => {
    renderHook(() => useKeyboardShortcuts());
    const evt = press('c');
    expect(copyFn).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });

  it('⌘V calls pasteClipboard even with no selection', () => {
    renderHook(() => useKeyboardShortcuts());
    const evt = press('v');
    expect(pasteFn).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('⌘X cuts and ⌘D duplicates the selection', () => {
    mockSelectedKey = 'drawn-1';
    mockSelectedElementId = 'drawn-1';
    renderHook(() => useKeyboardShortcuts());
    press('x');
    expect(cutFn).toHaveBeenCalledTimes(1);
    press('d');
    expect(dupFn).toHaveBeenCalledTimes(1);
  });

  it('group entries include additional selections', () => {
    mockSelectedKey = 'drawn-1';
    mockSelectedElementId = 'drawn-1';
    mockAdditionalSelections = [{ key: 'drawn-2', elementId: 'drawn-2' }];
    renderHook(() => useKeyboardShortcuts());
    press('c');
    expect(copyFn.mock.calls[0][0].entries).toHaveLength(2);
  });

  it('preview mode kills all four', () => {
    mockIsPreview = true;
    mockSelectedKey = 'drawn-1';
    renderHook(() => useKeyboardShortcuts());
    press('c'); press('x'); press('v'); press('d');
    expect(copyFn).not.toHaveBeenCalled();
    expect(cutFn).not.toHaveBeenCalled();
    expect(pasteFn).not.toHaveBeenCalled();
    expect(dupFn).not.toHaveBeenCalled();
  });

  it('events on an input target are ignored', () => {
    mockSelectedKey = 'drawn-1';
    renderHook(() => useKeyboardShortcuts());
    const input = document.createElement('input');
    document.body.appendChild(input);
    const evt = new KeyboardEvent('keydown', { key: 'v', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(evt);
    expect(pasteFn).not.toHaveBeenCalled();
    input.remove();
  });
});
