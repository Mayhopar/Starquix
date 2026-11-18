/**
 * Drift guard for the iframe→parent keyboard relay.
 *
 * `bridge/globalShortcuts.ts` is the ONE list of bare-key shortcuts; the bridge
 * forwards exactly it (parts/__tests__/keyboard-forwarding.test.ts). This side
 * proves the parent really acts on every key in that list — so a shortcut can
 * never be added to the hook while the bridge keeps swallowing it (the
 * 2026-08-02 defect: `r` and `2` were dead whenever the preview had focus).
 *
 * A forwarded key arrives as a SYNTHETIC keydown re-dispatched on document
 * (handleKeyboardEvent), which is exactly what `press()` simulates here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import {
  TOOL_SHORTCUTS,
  BREAKPOINT_SHORTCUT_KEYS,
  SHIFTED_SHORTCUT_CODE,
} from '@/bridge/globalShortcuts';
import type { DrawTool } from '@/context/ToolContext';

const mockSetActiveTool = vi.fn();
const mockDispatch = vi.fn();
let mockActiveTool: DrawTool = 'select';

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: mockActiveTool, setActiveTool: mockSetActiveTool }),
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

function press(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('every forwarded bare shortcut is handled by the parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTool = 'select';
  });

  it.each(Object.entries(TOOL_SHORTCUTS))('%s arms the %s tool', (key, tool) => {
    renderHook(() => useKeyboardShortcuts());
    press({ key, code: `Key${key.toUpperCase()}` });
    expect(mockSetActiveTool).toHaveBeenCalledWith(tool);
  });

  it.each(BREAKPOINT_SHORTCUT_KEYS.map((k, i) => [k, ['base', 'sm', 'md', 'lg', 'xl', '2xl'][i]]))(
    '%s switches to the %s breakpoint',
    (key, breakpoint) => {
      renderHook(() => useKeyboardShortcuts());
      press({ key, code: `Digit${key}` });
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_BREAKPOINT', breakpoint });
    },
  );

  it('Shift+Digit1 zooms to fit', () => {
    renderHook(() => useKeyboardShortcuts());
    const zoom = vi.fn();
    window.addEventListener('sq:zoom-command', zoom);
    press({ key: '!', code: SHIFTED_SHORTCUT_CODE, shiftKey: true });
    window.removeEventListener('sq:zoom-command', zoom);
    expect(zoom).toHaveBeenCalled();
  });
});
