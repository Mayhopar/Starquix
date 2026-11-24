/**
 * Canvas keys act on the canvas only while the keyboard is on it (findings #4, #19, #12).
 *
 * Delete, Enter, Tab, Escape, digits, tool letters and the element clipboard act only while focus is on the canvas —
 * nothing focused, the canvas or its iframe, or the Layers tree — on the Design view, with no window open. A focused
 * control keeps its own keys, an open window owns the keyboard, and the pen owns its keys while a path is in progress.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import type { ReactNode } from 'react';
import { SelectionProvider, type ScannedElement } from '@/context/SelectionContext';
import { useSelection } from '@/test/mergedSelectionHook';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { Modal } from '@/components/ui/Modal';
import { PenOverlay } from '@/components/Canvas/PenOverlay';

const mockDoc = new Y.Doc();
const m = vi.hoisted(() => {
  const tool = { current: 'select' };
  const setActiveTool = vi.fn();
  return {
    tool, setActiveTool, dispatch: vi.fn(() => true), undo: vi.fn(), takeSnapshot: vi.fn(),
    useTool: () => ({ activeTool: tool.current, setActiveTool, isPreview: false, setPreview: vi.fn() }),
  };
});
vi.mock('@/store/hooks', () => ({ useDispatch: () => m.dispatch, useYjsValue: () => null, useEditorDoc: () => mockDoc }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ undo: m.undo, redo: vi.fn(), takeSnapshot: m.takeSnapshot }) }));
vi.mock('@/context', () => ({ useClassStore: () => ({}), useTool: m.useTool }));
vi.mock('@/context/ToolContext', () => ({ useTool: m.useTool }));
vi.mock('@/utils/smartInsertion', () => ({ findInsertionTarget: () => ({ parentKey: null, insertIndex: 0 }) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const el = (key: string): ScannedElement => ({
  key, parentKey: null, tagName: 'div', classes: '', rect: { top: 0, left: 0, width: 100, height: 100 }, hasSourceTracking: true,
});
const Wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>;

/** The editor with element 'a' (of siblings a, b) selected. */
function mountEditor(designSurface?: boolean) {
  const hook = renderHook(() => { const selection = useSelection(); useKeyboardShortcuts(designSurface); return selection; }, { wrapper: Wrapper });
  act(() => hook.result.current.setScannedElements([el('a'), el('b')]));
  act(() => hook.result.current.select('a', { tagName: 'div' }));
  return { selected: () => hook.result.current.selectedKey };
}

/** A keydown the way the browser sends it: at the focused element (body when nothing is). */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

function focusNew<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement = document.body): HTMLElementTagNameMap[K] {
  const node = parent.appendChild(document.createElement(tag));
  node.tabIndex = 0;
  node.focus();
  return node;
}

const breakpointSwitched = () => m.dispatch.mock.calls.some((c) => (c as unknown[])[0] && ((c as unknown[])[0] as { type: string }).type === 'SET_BREAKPOINT');

beforeEach(() => { document.body.innerHTML = ''; m.tool.current = 'select'; });
afterEach(() => vi.clearAllMocks());

describe('canvas keys need the keyboard on the canvas (#4, #19)', () => {
  it('#19 a focused toolbar button keeps Enter and Tab; Escape, letters and Delete leave the canvas alone', () => {
    const editor = mountEditor();
    focusNew('button');
    const onEdit = vi.fn();
    window.addEventListener('sq:request-edit-mode', onEdit);
    expect(press('Enter').defaultPrevented).toBe(false); // the button is clicked, not the canvas text
    window.removeEventListener('sq:request-edit-mode', onEdit);
    expect(onEdit).not.toHaveBeenCalled();
    expect(press('Tab').defaultPrevented).toBe(false); // focus moves on
    press('Escape');
    press('t');
    press('Backspace');
    expect(editor.selected()).toBe('a');
    expect(m.setActiveTool).not.toHaveBeenCalled();
    expect(m.takeSnapshot).not.toHaveBeenCalled();
  });

  it('#19 a focused dropdown keeps digits and letters for its type-ahead; the breakpoint and tool stay', () => {
    mountEditor();
    focusNew('select');
    press('3');
    press('b');
    expect(breakpointSwitched()).toBe(false);
    expect(m.setActiveTool).not.toHaveBeenCalled();
  });

  it('#4 an open window owns the keyboard: digits, letters and Backspace never reach the canvas behind it', () => {
    const editor = mountEditor();
    const { getByText } = render(<Modal isOpen onClose={vi.fn()} aria-label="Publish"><button>Cancel</button></Modal>);
    const cancel = getByText('Cancel');
    cancel.focus();
    press('2');
    press('p');
    expect(press('Backspace').defaultPrevented).toBe(false);
    // The focused control went away (a button disabled while publishing): still the window's keyboard.
    cancel.blur();
    press('Backspace');
    expect(editor.selected()).toBe('a');
    expect(m.takeSnapshot).not.toHaveBeenCalled();
    expect(breakpointSwitched()).toBe(false);
    expect(m.setActiveTool).not.toHaveBeenCalled();
  });

  it('#4 Escape closes the window and leaves the canvas selection alone', () => {
    const editor = mountEditor();
    const onClose = vi.fn();
    const { getByText } = render(<Modal isOpen onClose={onClose} aria-label="Publish"><button>Cancel</button></Modal>);
    getByText('Cancel').focus();
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.selected()).toBe('a');
  });

  it('#4 with the Content/Assets view showing, Backspace and digits leave the hidden canvas alone', () => {
    const editor = mountEditor(false);
    press('Backspace');
    press('2');
    expect(editor.selected()).toBe('a');
    expect(m.takeSnapshot).not.toHaveBeenCalled();
    expect(breakpointSwitched()).toBe(false);
  });

  it('the canvas keeps its keys: nothing focused, the Layers tree, the canvas iframe (keys relayed by the bridge)', () => {
    const editor = mountEditor();
    expect(press('Tab').defaultPrevented).toBe(true); // nothing focused
    expect(editor.selected()).toBe('b');
    const layers = document.body.appendChild(Object.assign(document.createElement('div'), { tabIndex: 0 }));
    layers.setAttribute('data-canvas-keys', '');
    focusNew('div', layers); // a layer row
    press('2');
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'SET_BREAKPOINT', breakpoint: 'sm' });
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.setAttribute('data-canvas-keys', '');
    canvas.appendChild(document.createElement('iframe')).focus();
    press('Backspace', {}, document); // the parent re-dispatches the iframe's key on its document
    expect(m.takeSnapshot).toHaveBeenCalled();
  });

  it('app commands stay global: ⌘Z still undoes while a toolbar button has focus', () => {
    mountEditor();
    focusNew('button');
    press('z', { metaKey: true, ctrlKey: true });
    expect(m.undo).toHaveBeenCalledTimes(1);
  });
});

describe('#12 the pen owns its keys while a path is in progress', () => {
  it('Backspace removes the last anchor only — the element selected before P stays', () => {
    m.tool.current = 'pen';
    const onCommit = vi.fn();
    let selection!: ReturnType<typeof useSelection>;
    function Host() {
      selection = useSelection();
      useKeyboardShortcuts();
      return <PenOverlay scale={1} position={{ x: 0, y: 0 }} canvasWidth={375} viewportWidth={375} onPathCommitted={onCommit} />;
    }
    const { container } = render(<Host />, { wrapper: Wrapper });
    act(() => selection.setScannedElements([el('heading')]));
    act(() => selection.select('heading', { tagName: 'h1' }));
    const overlay = container.querySelector('[data-testid="pen-overlay"]') as HTMLElement;
    for (const [x, y] of [[10, 10], [60, 10], [60, 60]]) {
      fireEvent.mouseDown(overlay, { clientX: x, clientY: y });
      fireEvent.mouseUp(overlay, { clientX: x, clientY: y });
    }
    press('Backspace');
    expect(m.takeSnapshot).not.toHaveBeenCalled(); // the element delete never ran
    expect(selection.selectedKey).toBe('heading');
    press('Enter');
    expect(JSON.parse(onCommit.mock.calls[0][0].penPath).anchors).toHaveLength(2);
  });
});
