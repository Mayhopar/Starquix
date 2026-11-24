import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { SelectionProvider } from '@/context/SelectionContext';
import { useSelection } from '@/test/mergedSelectionHook';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { ReactNode } from 'react';
import type { ScannedElement } from '@/context/SelectionContext';
import { ImageFillShell } from '@/components/DesignBar/fill/ImageFillShell';
import { db } from '@/db';
import {
  PAGE_FILE, pageSource, flushAccepted, freshLocalProjectId, startLocalDeleteRuntime, stopLocalDeleteRuntime,
} from './__tests__/localDeleteRuntime';

const mockDoc = new Y.Doc();

// Stable spies (hoisted: vi.mock factories run before module body).
const { mockDispatch, mockTakeSnapshot, mockDeleteLocalElement, mockToast } = vi.hoisted(() => ({
  mockDispatch: vi.fn(() => true),
  mockTakeSnapshot: vi.fn(),
  mockDeleteLocalElement: vi.fn(async () => true),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => null,
  useEditorDoc: () => mockDoc,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn(), takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast }));

// task-133 Task 6: the local delete op is mocked; the predicate stays REAL so
// the routing (source-keyed vs doc-backed) is exercised for real.
vi.mock('@/components/Editor/localStructuralOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Editor/localStructuralOps')>()),
  deleteLocalElement: mockDeleteLocalElement,
}));

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn() }),
}));

const TestWrapper = ({ children }: { children: ReactNode }) => (
  <SelectionProvider>{children}</SelectionProvider>
);

function useTestHooks() {
  const selection = useSelection();
  useKeyboardShortcuts();
  return selection;
}

const makeElement = (key: string, parentKey: string | null): ScannedElement => ({
  key,
  parentKey,
  tagName: 'div',
  classes: '',
  rect: { top: 0, left: 0, width: 100, height: 100 },
  hasSourceTracking: true
});

describe('useKeyboardShortcuts integration', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Tab navigates to next sibling when element is selected', async () => {
    const { result } = renderHook(() => useTestHooks(), { wrapper: TestWrapper });

    // Set up scanned elements with siblings
    act(() => {
      result.current.setScannedElements([
        makeElement('sibling1', null),
        makeElement('sibling2', null),
        makeElement('sibling3', null),
      ]);
    });

    // Select first sibling
    act(() => {
      result.current.select('sibling1', { tagName: 'div' });
    });
    expect(result.current.selectedKey).toBe('sibling1');

    // Press Tab
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    });

    // Should navigate to next sibling
    expect(result.current.selectedKey).toBe('sibling2');
  });

  it('Tab wraps from last to first sibling', async () => {
    const { result } = renderHook(() => useTestHooks(), { wrapper: TestWrapper });

    act(() => {
      result.current.setScannedElements([
        makeElement('sibling1', null),
        makeElement('sibling2', null),
      ]);
    });

    // Select last sibling
    act(() => {
      result.current.select('sibling2', { tagName: 'div' });
    });

    // Press Tab
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    });

    // Should wrap to first
    expect(result.current.selectedKey).toBe('sibling1');
  });

  it('Enter drills into first child', async () => {
    const { result } = renderHook(() => useTestHooks(), { wrapper: TestWrapper });

    act(() => {
      result.current.setScannedElements([
        makeElement('parent', null),
        makeElement('child1', 'parent'),
        makeElement('child2', 'parent'),
      ]);
    });

    // Select parent
    act(() => {
      result.current.select('parent', { tagName: 'div' });
    });

    // Press Enter
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    });

    // Should drill into first child
    expect(result.current.selectedKey).toBe('child1');
    expect(result.current.contextKey).toBe('parent');
  });

  it('Shift+Enter drills up to parent', async () => {
    const { result } = renderHook(() => useTestHooks(), { wrapper: TestWrapper });

    act(() => {
      result.current.setScannedElements([
        makeElement('parent', null),
        makeElement('child', 'parent'),
      ]);
    });

    // Select child
    act(() => {
      result.current.select('child', { tagName: 'div' });
    });

    // Press Shift+Enter
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    });

    // Should drill up to parent
    expect(result.current.selectedKey).toBe('parent');
  });
});

// task-133 Task 6: local runtime (files-truth) Backspace/Delete routing.
describe('local-mode delete routing', () => {
  const SRC_KEY = 'src/pages/index.astro:8:3';

  const setup = (projectId: string) => {
    mockDoc.getMap('meta').set('projectId', projectId);
    return renderHook(() => useTestHooks(), { wrapper: TestWrapper });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockDoc.getMap('meta').set('projectId', '');
  });

  it('local + source-keyed selection → deleteLocalElement, NO dispatch, NO snapshot', () => {
    const { result } = setup('browser_lf_abc123');
    act(() => {
      result.current.setScannedElements([makeElement(SRC_KEY, null)]);
      result.current.select(SRC_KEY, { tagName: 'div' });
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });

    expect(mockDeleteLocalElement).toHaveBeenCalledTimes(1);
    expect(mockDeleteLocalElement.mock.calls[0][0]).toMatchObject({ key: SRC_KEY });
    expect(typeof mockDeleteLocalElement.mock.calls[0][0].clearSelection).toBe('function');
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
  });

  it('NON-local + source-keyed selection → local path NOT taken (doc path pinned unchanged)', () => {
    const { result } = setup('browser_abc123');
    act(() => {
      result.current.setScannedElements([makeElement(SRC_KEY, null)]);
      result.current.select(SRC_KEY, { tagName: 'div' });
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });

    expect(mockDeleteLocalElement).not.toHaveBeenCalled();
    // Pre-existing WC behavior pinned unchanged: SelectionContext derives an
    // elementId from the source key and the doc path dispatches REMOVE_ELEMENT.
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'REMOVE_ELEMENT' }));
    expect(mockTakeSnapshot).toHaveBeenCalled(); // pre-existing contract: snapshot before per-kind delete
  });

  it('local + drawn (doc-backed ghost) selection → existing doc path, not the local op', () => {
    const { result } = setup('browser_lf_abc123');
    act(() => {
      result.current.setScannedElements([makeElement('drawn-77', null)]);
      result.current.select('drawn-77', { tagName: 'div' });
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });

    expect(mockDeleteLocalElement).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'REMOVE_DRAWN_ELEMENT', elementKey: 'drawn-77' });
  });

  // Fix 1a (review of 66987f8b): holding Backspace auto-repeats keydown; each
  // repeat still sees the same activeKey and would issue another writeRemove
  // at the same file:line — after the first delete shifts lines, follow-ups
  // resolve to whichever SIBLING moved into that line. Repeats are dropped.
  it('local + source-keyed: auto-repeat keydown (e.repeat) issues exactly ONE local delete', () => {
    const { result } = setup('browser_lf_abc123');
    act(() => {
      result.current.setScannedElements([makeElement(SRC_KEY, null)]);
      result.current.select(SRC_KEY, { tagName: 'div' });
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', repeat: true, bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', repeat: true, bubbles: true, cancelable: true }));
    });

    expect(mockDeleteLocalElement).toHaveBeenCalledTimes(1);
  });

  // Since fdd2d12f the group no longer routes members through
  // deleteLocalElement: all source members ride ONE durable source gesture.
  // Observe it for real on a temp disk instead of the (unused) op spy.
  it('local + multi-select group containing a source key → group delete runs (gap 9: no more blocked toast)', async () => {
    const projectId = freshLocalProjectId('kbd_group');
    const runtime = await startLocalDeleteRuntime(projectId, { [PAGE_FILE]: pageSource(10, { 8: '  <p>L8</p>' }) });
    try {
      const { result } = setup(projectId);
      mockDoc.getMap('elements').set('drawn-77', new Y.Map([['isDrawn', true]]));
      act(() => {
        result.current.setScannedElements([
          makeElement(SRC_KEY, null),
          makeElement('drawn-77', null),
        ]);
        result.current.select(SRC_KEY, { tagName: 'div' });
        result.current.addAdditionalSelection({ key: 'drawn-77', elementId: 'drawn-77' });
      });

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(mockToast).not.toHaveBeenCalledWith(expect.stringContaining('One element at a time'));
      await vi.waitFor(async () => expect(await db.durableEdits.count()).toBe(1));
      await vi.waitFor(() => expect(mockDoc.getMap('elements').has('drawn-77')).toBe(false));
      await flushAccepted(projectId);
      expect(runtime.read(PAGE_FILE)).not.toContain('<p>L8</p>');
      expect(runtime.read(PAGE_FILE)).toContain('<p>L7</p>');
    } finally {
      await stopLocalDeleteRuntime(runtime, projectId);
    }
  });
});


it.each(['button', 'input', 'body'] as const)('image popover owns Escape from %s before canvas drill-up', targetKind => {
  const parent = 'src/pages/index.astro:9:3';
  const child = 'src/pages/index.astro:10:7';
  const location = { file: 'src/pages/index.astro', line: 10, column: 7 };
  const { result } = renderHook(() => useTestHooks(), { wrapper: TestWrapper });
  act(() => {
    result.current.setScannedElements([{ ...makeElement(parent, null), tagName: 'section' }, makeElement(child, parent)]);
    result.current.enterContext(parent);
    result.current.select(child, { tagName: 'div', sourceLocation: location });
  });
  render(<ImageFillShell ownerId={child} src="/original.png" preview={null} caption="Fit"><input aria-label="Image URL" /><button>Popover control</button></ImageFillShell>);
  const trigger = screen.getByRole('button', { name: 'Edit image Fill' });
  fireEvent.click(trigger);
  const target = targetKind === 'input' ? screen.getByRole('textbox', { name: 'Image URL' }) : targetKind === 'button' ? screen.getByRole('button', { name: 'Popover control' }) : document.body;
  target.focus();
  fireEvent.keyDown(target, { key: 'Escape', bubbles: true, cancelable: true });
  expect(screen.queryByRole('button', { name: 'Popover control' })).toBeNull();
  expect(trigger).toHaveFocus();
  expect(result.current.selectedKey).toBe(child);
  expect(result.current.selectedTagName).toBe('div');
  expect(result.current.selectedSourceLocation).toEqual(location);
  expect(result.current.contextKey).toBe(parent);
  // The next Escape is the canvas's once the keyboard is back on it (focus left the design-bar trigger); a
  // document-bubbling Escape matches the iframe keyboard relay.
  trigger.blur();
  fireEvent.keyDown(document, { key: 'Escape', bubbles: true, cancelable: true });
  expect(result.current.selectedKey).toBe(parent);
  expect(result.current.contextKey).toBeNull();
});
