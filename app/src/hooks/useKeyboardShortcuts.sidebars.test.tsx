import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';
import { SelectionProvider } from '@/context/SelectionContext';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

// ⌘\ (Ctrl+\ off a Mac) hides both sidebars and brings them back, as in Figma (issue #8).

const mockDoc = new Y.Doc();
const { tool } = vi.hoisted(() => ({ tool: { isPreview: false, toggleSidebars: vi.fn() } }));

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
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn(), isPreview: tool.isPreview, setPreview: vi.fn(), toggleSidebars: tool.toggleSidebars }),
}));

const Wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>;

function press(init: KeyboardEventInit, target: EventTarget = document): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
}

const setPlatform = (value: string) => Object.defineProperty(navigator, 'platform', { value, configurable: true });
const BACKSLASH = { key: '\\', code: 'Backslash' };

describe('⌘\\ shows / hides the sidebars', () => {
  let hook: ReturnType<typeof renderHook>;
  beforeEach(() => {
    setPlatform('Win32');
    tool.isPreview = false;
    tool.toggleSidebars.mockClear();
    hook = renderHook(() => useKeyboardShortcuts(), { wrapper: Wrapper });
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('toggles on Ctrl+\\ and keeps the browser from acting on the key', () => {
    const e = press({ ...BACKSLASH, ctrlKey: true });
    expect(tool.toggleSidebars).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    press({ ...BACKSLASH, ctrlKey: true });
    expect(tool.toggleSidebars).toHaveBeenCalledTimes(2);
  });

  it('on a Mac it is ⌘\\, and Ctrl+\\ stays the terminal\'s key', () => {
    setPlatform('MacIntel');
    press({ ...BACKSLASH, ctrlKey: true });
    expect(tool.toggleSidebars).not.toHaveBeenCalled();
    press({ ...BACKSLASH, metaKey: true });
    expect(tool.toggleSidebars).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the key in the backslash position (ISO layouts print # there)', { key: '#', code: 'Backslash' }],
    ['the backslash character from any other key', { key: '\\', code: 'IntlBackslash' }],
  ])('matches %s', (_, init) => {
    press({ ...init, ctrlKey: true });
    expect(tool.toggleSidebars).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an input', () => document.createElement('input')],
    ['a textarea', () => document.createElement('textarea')],
    ['rich text', () => Object.defineProperty(document.createElement('div'), 'isContentEditable', { value: true })],
  ])('works while %s has focus', (_, make) => {
    const field = document.body.appendChild(make());
    press({ ...BACKSLASH, ctrlKey: true }, field);
    expect(tool.toggleSidebars).toHaveBeenCalledTimes(1);
  });

  // xterm sends Ctrl+\ to the shell as SIGQUIT: the running agent would die on a sidebar toggle.
  it('never also reaches the focused field (the terminal)', () => {
    const terminal = document.body.appendChild(document.createElement('textarea'));
    const typed = vi.fn();
    terminal.addEventListener('keydown', typed);
    press({ ...BACKSLASH, ctrlKey: true }, terminal);
    expect(tool.toggleSidebars).toHaveBeenCalledTimes(1);
    expect(typed).not.toHaveBeenCalled();
  });

  // A held Ctrl+\ auto-repeats: no flicker, and no repeat may leak to the shell either.
  it('swallows a held key without toggling again', () => {
    const terminal = document.body.appendChild(document.createElement('textarea'));
    const typed = vi.fn();
    terminal.addEventListener('keydown', typed);
    const e = press({ ...BACKSLASH, ctrlKey: true, repeat: true }, terminal);
    expect(tool.toggleSidebars).not.toHaveBeenCalled();
    expect(typed).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it.each([
    ['a bare \\', BACKSLASH],
    ['Shift+Ctrl+\\', { ...BACKSLASH, ctrlKey: true, shiftKey: true }],
    ['AltGr+\\ (typing a backslash: Ctrl+Alt on Windows)', { ...BACKSLASH, ctrlKey: true, altKey: true }],
    ['⌘\\ off a Mac', { ...BACKSLASH, metaKey: true }],
    ['Ctrl+/', { key: '/', code: 'Slash', ctrlKey: true }],
    ['a key the IME is composing with', { ...BACKSLASH, ctrlKey: true, isComposing: true }],
    ['an IME keydown (keyCode 229)', { ...BACKSLASH, ctrlKey: true, keyCode: 229 }],
  ])('does nothing on %s', (_, init) => {
    const e = press(init);
    expect(tool.toggleSidebars).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves a key something else already handled', () => {
    const e = new KeyboardEvent('keydown', { ...BACKSLASH, ctrlKey: true, bubbles: true, cancelable: true });
    e.preventDefault();
    act(() => { document.dispatchEvent(e); });
    expect(tool.toggleSidebars).not.toHaveBeenCalled();
  });

  it('is ignored in preview (it already hides the chrome)', () => {
    tool.isPreview = true;
    hook.rerender(); // the handler reads the preview flag from a ref refreshed on render
    press({ ...BACKSLASH, ctrlKey: true });
    expect(tool.toggleSidebars).not.toHaveBeenCalled();
  });
});
