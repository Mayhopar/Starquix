import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';
import { SelectionProvider } from '@/context/SelectionContext';
import { getGrid, _resetGridCacheForTests } from '@/components/Canvas/gridPreferences';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

// Ctrl+G toggles the alignment grid (the top-bar Grid chip's shortcut).
// Design: docs/plans/2026-11-16-layout-grid-design.md

const mockDoc = new Y.Doc();
const { tool } = vi.hoisted(() => ({ tool: { isPreview: false } }));

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

const PROJECT = 'browser_grid_shortcut';

describe('Ctrl+G toggles the alignment grid', () => {
  let hook: ReturnType<typeof renderHook>;
  beforeEach(() => {
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

  it('turns the grid on, then off, and keeps the browser from acting on the key', () => {
    const first = press({ key: 'g', ctrlKey: true });
    expect(getGrid(PROJECT).on).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    press({ key: 'G', ctrlKey: true }); // caps lock
    expect(getGrid(PROJECT).on).toBe(false);
  });

  it('acts on the open project only', () => {
    press({ key: 'g', ctrlKey: true });
    expect(getGrid('some_other_project').on).toBe(false);
  });

  it.each([
    ['a bare g', { key: 'g' }],
    ['⌘G (stays free)', { key: 'g', metaKey: true }],
    ['Shift+Ctrl+G', { key: 'G', ctrlKey: true, shiftKey: true }],
    ['Alt+Ctrl+G', { key: 'g', ctrlKey: true, altKey: true }],
    ['Ctrl+H', { key: 'h', ctrlKey: true }],
  ])('does nothing on %s', (_, init) => {
    press(init);
    expect(getGrid(PROJECT).on).toBe(false);
  });

  it('is ignored while a field has focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press({ key: 'g', ctrlKey: true }, input);
    expect(getGrid(PROJECT).on).toBe(false);
  });

  it('is ignored in preview (read-only, no chrome to show it)', () => {
    tool.isPreview = true;
    hook.rerender(); // the handler reads the preview flag from a ref refreshed on render
    press({ key: 'g', ctrlKey: true });
    expect(getGrid(PROJECT).on).toBe(false);
  });
});
