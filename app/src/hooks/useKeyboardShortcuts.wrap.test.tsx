import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';
import { SelectionProvider } from '@/context/SelectionContext';
import { getGrid, _resetGridCacheForTests } from '@/components/Canvas/gridPreferences';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

// "Create container" (issue #5): ⌘G on a Mac, Ctrl+Alt+G on Windows / Linux (Ctrl+G is the grid).

const mockDoc = new Y.Doc();
const { tool, wrap } = vi.hoisted(() => ({ tool: { isPreview: false }, wrap: vi.fn() }));

vi.mock('@/hooks/useWrapSelection', () => ({ useWrapSelection: () => wrap }));
vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(() => true),
  useYjsValue: () => null,
  useEditorDoc: () => mockDoc,
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn(), takeSnapshot: vi.fn() }),
}));
vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn(), isPreview: tool.isPreview, setPreview: vi.fn() }),
}));

const Wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>;

function press(init: KeyboardEventInit, target: EventTarget = document): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
}

function setPlatform(value: string) {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
}

const PROJECT = 'browser_wrap_shortcut';

describe.each([
  ['macOS', 'MacIntel', { key: 'g', code: 'KeyG', metaKey: true }, [
    ['⌘⇧G', { key: 'G', code: 'KeyG', metaKey: true, shiftKey: true }],
    ['Ctrl+Alt+G', { key: '©', code: 'KeyG', ctrlKey: true, altKey: true }],
    ['⌘⌥G', { key: '©', code: 'KeyG', metaKey: true, altKey: true }],
    ['Ctrl+G (grid)', { key: 'g', code: 'KeyG', ctrlKey: true }],
  ]],
  ['Windows', 'Win32', { key: 'g', code: 'KeyG', ctrlKey: true, altKey: true }, [
    ['Ctrl+G (grid)', { key: 'g', code: 'KeyG', ctrlKey: true }],
    ['Ctrl+Alt+Shift+G', { key: 'G', code: 'KeyG', ctrlKey: true, altKey: true, shiftKey: true }],
    ['Win+G', { key: 'g', code: 'KeyG', metaKey: true }],
    ['Alt+G', { key: 'g', code: 'KeyG', altKey: true }],
  ]],
] as const)('Create container shortcut on %s', (_, platform, combo, others) => {
  let hook: ReturnType<typeof renderHook>;
  beforeEach(() => {
    setPlatform(platform);
    wrap.mockClear();
    localStorage.removeItem('sq:grid');
    _resetGridCacheForTests();
    tool.isPreview = false;
    mockDoc.getMap('meta').set('projectId', PROJECT);
    hook = renderHook(() => useKeyboardShortcuts(), { wrapper: Wrapper });
  });
  afterEach(() => {
    mockDoc.getMap('meta').set('projectId', '');
    document.body.innerHTML = '';
  });

  it('wraps the selection and keeps the browser from acting on the key', () => {
    const e = press(combo);
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(getGrid(PROJECT).on).toBe(false);
  });

  it('matches the physical key, whatever letter the layout gives', () => {
    press({ ...combo, key: 'п' });
    expect(wrap).toHaveBeenCalledTimes(1);
  });

  it('does not repeat while the key is held', () => {
    const e = press({ ...combo, repeat: true });
    expect(wrap).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it.each(others)('does nothing on %s', (_name, init) => {
    press(init);
    expect(wrap).not.toHaveBeenCalled();
  });

  it('is ignored while a field has focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(combo, input);
    expect(wrap).not.toHaveBeenCalled();
  });

  it('is ignored in preview', () => {
    tool.isPreview = true;
    hook.rerender();
    press(combo);
    expect(wrap).not.toHaveBeenCalled();
  });
});
