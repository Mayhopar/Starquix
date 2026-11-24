/**
 * A shortcut is the key the user means on every layout and platform (findings #23, #24): Shift and Caps Lock don't
 * change it, a combo keeps the layout's own Latin letter (AZERTY ⌘Z), and a key that types no Latin letter or digit
 * is its physical key (Cyrillic/Greek letters, AZERTY's digit row).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { useComponentsModal } from './useComponentsModal';
import { ZOOM_COMMAND_EVENT } from '@/components/Canvas/zoomCommands';

const m = vi.hoisted(() => ({ undo: vi.fn(), redo: vi.fn(), setActiveTool: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/context', () => ({
  useClassStore: () => ({}),
  useTool: () => ({ activeTool: 'select', setActiveTool: m.setActiveTool, isPreview: false, setPreview: vi.fn() }),
}));
vi.mock('@/store/hooks', () => ({ useDispatch: () => m.dispatch, useYjsValue: () => null, useEditorDoc: () => new Y.Doc() }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ undo: m.undo, redo: m.redo, takeSnapshot: vi.fn() }) }));
vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: null, selectedElementId: null, selectedSourceLocation: null, clearSelection: vi.fn(), contextKey: null,
    enterContext: vi.fn(), exitContext: vi.fn(), select: vi.fn(), additionalSelections: [], clearAdditionalSelections: vi.fn(),
  }),
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] }, scannedByKeyRef: { current: new Map() }, treeNodesRef: { current: [] } }),
}));

const platform = (value: string) => Object.defineProperty(navigator, 'platform', { value, configurable: true });
const press = (init: KeyboardEventInit) => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
});
const breakpoint = () => (m.dispatch.mock.calls as unknown as [{ type: string; breakpoint?: string }][])
  .map(([action]) => action).find((action) => action.type === 'SET_BREAKPOINT')?.breakpoint;

beforeEach(() => { vi.clearAllMocks(); platform('MacIntel'); });
afterEach(() => { delete (navigator as { platform?: string }).platform; });

describe('#23 letter combos ignore Shift and Caps Lock', () => {
  it('Windows/Linux: Ctrl+Shift+Z (key "Z") redoes, as the Redo tooltip says', () => {
    platform('Win32');
    renderHook(() => useKeyboardShortcuts());
    press({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    expect(m.redo).toHaveBeenCalledTimes(1);
    expect(m.undo).not.toHaveBeenCalled();
  });

  it('Caps Lock: Ctrl+Z (key "Z") undoes; on a Mac ⌘⇧Z with an uppercase key redoes', () => {
    platform('Win32');
    const windows = renderHook(() => useKeyboardShortcuts());
    press({ key: 'Z', code: 'KeyZ', ctrlKey: true });
    expect(m.undo).toHaveBeenCalledTimes(1);
    windows.unmount();
    platform('MacIntel');
    renderHook(() => useKeyboardShortcuts());
    press({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true });
    expect(m.redo).toHaveBeenCalledTimes(1);
  });
});

describe('#24 shortcuts on other keyboard layouts', () => {
  it('Cyrillic/Greek: the V, R, T and P keys arm their tools', () => {
    renderHook(() => useKeyboardShortcuts());
    for (const [key, code, tool] of [['м', 'KeyV', 'select'], ['к', 'KeyR', 'rect'], ['е', 'KeyT', 'text'], ['τ', 'KeyT', 'text'], ['з', 'KeyP', 'pen']]) {
      press({ key, code });
      expect(m.setActiveTool).toHaveBeenLastCalledWith(tool);
    }
  });

  it('Windows Cyrillic: Ctrl+я (the Z key) undoes', () => {
    platform('Win32');
    renderHook(() => useKeyboardShortcuts());
    press({ key: 'я', code: 'KeyZ', ctrlKey: true });
    expect(m.undo).toHaveBeenCalledTimes(1);
  });

  it('AZERTY: the digit row (&, é) switches breakpoints and ⌘0 (à) resets the zoom', () => {
    renderHook(() => useKeyboardShortcuts());
    press({ key: '&', code: 'Digit1' });
    expect(breakpoint()).toBe('base');
    m.dispatch.mockClear();
    press({ key: 'é', code: 'Digit2' });
    expect(breakpoint()).toBe('sm');
    const zoom = vi.fn();
    window.addEventListener(ZOOM_COMMAND_EVENT, zoom);
    press({ key: 'à', code: 'Digit0', metaKey: true }); // ⌘0
    window.removeEventListener(ZOOM_COMMAND_EVENT, zoom);
    expect((zoom.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toEqual({ action: 'reset' });
  });

  it('AZERTY keeps its own letters: ⌘Z is the key labelled Z (code KeyW), A is frame, Q is nothing', () => {
    renderHook(() => useKeyboardShortcuts());
    press({ key: 'z', code: 'KeyW', metaKey: true });
    expect(m.undo).toHaveBeenCalledTimes(1);
    press({ key: 'a', code: 'KeyQ' });
    expect(m.setActiveTool).toHaveBeenCalledWith('frame');
    m.setActiveTool.mockClear();
    press({ key: 'q', code: 'KeyA' });
    expect(m.setActiveTool).not.toHaveBeenCalled();
  });

  it('punctuation on a letter key is not that letter (Dvorak ⌘; is not ⌘Z)', () => {
    renderHook(() => useKeyboardShortcuts());
    press({ key: ';', code: 'KeyZ', metaKey: true });
    expect(m.undo).not.toHaveBeenCalled();
  });

  it('QWERTY: Shift+1 still zooms to fit and switches no breakpoint', () => {
    const zoom = vi.fn();
    window.addEventListener(ZOOM_COMMAND_EVENT, zoom);
    renderHook(() => useKeyboardShortcuts());
    press({ key: '!', code: 'Digit1', shiftKey: true });
    window.removeEventListener(ZOOM_COMMAND_EVENT, zoom);
    expect(zoom).toHaveBeenCalledTimes(1);
    expect(breakpoint()).toBeUndefined();
  });

  it('the ⌘K picker opens with Caps Lock and on a Cyrillic layout', () => {
    const picker = renderHook(() => useComponentsModal());
    press({ key: 'K', code: 'KeyK', metaKey: true });
    expect(picker.result.current.isModalOpen).toBe(true);
    act(() => picker.result.current.onCloseModal());
    press({ key: 'л', code: 'KeyK', metaKey: true });
    expect(picker.result.current.isModalOpen).toBe(true);
  });
});
