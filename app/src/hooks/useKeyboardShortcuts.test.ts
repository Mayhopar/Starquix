import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const mockDoc = new Y.Doc();
mockDoc.getMap('meta').set('projectId', 'browser_lf_keyboard');

// Mock dependencies
const mockSaveAll = vi.fn(async () => {});
const mockSaveProject = vi.fn(async (_projectId: string) => {});
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ flushDurableSourceWrites: (projectId: string) => mockSaveProject(projectId) }));
const mockUndoElements = vi.fn();
const mockRedoElements = vi.fn();
const mockDispatch = vi.fn();

vi.mock('@/context', () => ({
  useClassStore: vi.fn(() => ({
    saveAll: mockSaveAll,
    hasUnsavedChanges: true,
  })),
  useTool: vi.fn(() => ({
    activeTool: 'select',
    setActiveTool: vi.fn(),
  })),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: vi.fn(() => mockDispatch),
  useYjsValue: vi.fn(() => null),
  useEditorDoc: vi.fn(() => mockDoc),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: vi.fn(() => ({
    undo: mockUndoElements,
    redo: mockRedoElements,
    takeSnapshot: vi.fn(),
  })),
}));

vi.mock('@/context/SelectionContext', () => ({
  // perf item 3: the hook reads selection via useSelectionContext and scans
  // via the never-changing ref context (useScannedElementsRef)
  useSelectionContext: vi.fn(() => ({
    selectedKey: null,
    selectedSourceLocation: null,
    clearSelection: vi.fn(),
    contextKey: null,
    enterContext: vi.fn(),
    exitContext: vi.fn(),
    select: vi.fn(),
    additionalSelections: [],
    clearAdditionalSelections: vi.fn(),
  })),
  useScannedElementsRef: vi.fn(() => ({
    scannedElementsRef: { current: [] },
    scannedByKeyRef: { current: new Map() },
    treeNodesRef: { current: [] },
  })),
}));

// Import the mock to control it
import { useClassStore, useTool } from '@/context';

describe('useKeyboardShortcuts', () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore navigator.platform
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  describe('Cmd+S / Ctrl+S save shortcut', () => {
    function focusedField(tag: 'input' | 'textarea' | 'div') {
      const field = document.createElement(tag);
      if (tag === 'div') {
        field.contentEditable = 'true';
        field.tabIndex = 0;
        // jsdom does not expose the browser's computed editing-host property.
        Object.defineProperty(field, 'isContentEditable', { value: true });
      }
      document.body.appendChild(field);
      field.focus();
      expect(document.activeElement).toBe(field);
      return field;
    }

    it.each([
      ['MacIntel', 'metaKey', 'input'], ['MacIntel', 'metaKey', 'textarea'], ['MacIntel', 'metaKey', 'div'],
      ['Win32', 'ctrlKey', 'input'], ['Win32', 'ctrlKey', 'textarea'], ['Win32', 'ctrlKey', 'div'],
    ] as const)('saves once from a focused %s %s %s and prevents browser Save', (platform, modifier, tag) => {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      vi.mocked(useClassStore).mockReturnValue({ saveAll: mockSaveAll, hasUnsavedChanges: true } as unknown as ReturnType<typeof useClassStore>);
      renderHook(() => useKeyboardShortcuts());
      const field = focusedField(tag);
      const event = new KeyboardEvent('keydown', { key: 's', [modifier]: true, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      expect(mockSaveProject).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      field.remove();
    });

    it('requests project Save from a focused field even without dirty classes', () => {
      vi.mocked(useClassStore).mockReturnValue({ saveAll: mockSaveAll, hasUnsavedChanges: false } as unknown as ReturnType<typeof useClassStore>);
      renderHook(() => useKeyboardShortcuts());
      const field = focusedField('input');
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(mockSaveProject).toHaveBeenCalledWith('browser_lf_keyboard');
      field.remove();
    });

    it.each(['composing', 'ime-keycode', 'handled', 'preview'] as const)('leaves %s Save events with their current owner', mode => {
      vi.mocked(useClassStore).mockReturnValue({ saveAll: mockSaveAll, hasUnsavedChanges: true } as unknown as ReturnType<typeof useClassStore>);
      if (mode === 'preview') vi.mocked(useTool).mockReturnValueOnce({ activeTool: 'select', setActiveTool: vi.fn(), isPreview: true, setPreview: vi.fn() } as unknown as ReturnType<typeof useTool>);
      renderHook(() => useKeyboardShortcuts());
      const field = focusedField('textarea');
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true, isComposing: mode === 'composing', keyCode: mode === 'ime-keycode' ? 229 : 0 });
      if (mode === 'handled') event.preventDefault();
      field.dispatchEvent(event);
      expect(mockSaveProject).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(mode === 'handled');
      field.remove();
    });

    it.each(['z', 'y', 'c', 'x', 'v', 'd', 'Backspace'] as const)('keeps %s editing inside a focused textarea', key => {
      renderHook(() => useKeyboardShortcuts());
      const field = focusedField('textarea');
      const event = new KeyboardEvent('keydown', { key, ctrlKey: key !== 'Backspace', bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(mockUndoElements).not.toHaveBeenCalled();
      expect(mockRedoElements).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockSaveProject).not.toHaveBeenCalled();
      field.remove();
    });

    it('calls project Save when Cmd+S is pressed and hasUnsavedChanges is true (Mac)', () => {
      // Simulate Mac environment
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      vi.mocked(useClassStore).mockReturnValue({
        saveAll: mockSaveAll,
        hasUnsavedChanges: true,
      } as unknown as ReturnType<typeof useClassStore>);

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });

      document.dispatchEvent(event);

      expect(mockSaveProject).toHaveBeenCalledTimes(1);
    });

    it('calls project Save when Ctrl+S is pressed and hasUnsavedChanges is true', () => {
      vi.mocked(useClassStore).mockReturnValue({
        saveAll: mockSaveAll,
        hasUnsavedChanges: true,
      } as unknown as ReturnType<typeof useClassStore>);

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });

      document.dispatchEvent(event);

      expect(mockSaveProject).toHaveBeenCalledTimes(1);
    });

    it('requests project Save when classes are clean (Mac)', () => {
      // Simulate Mac environment
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      vi.mocked(useClassStore).mockReturnValue({
        saveAll: mockSaveAll,
        hasUnsavedChanges: false,
      } as unknown as ReturnType<typeof useClassStore>);

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });

      document.dispatchEvent(event);

      expect(mockSaveProject).toHaveBeenCalledWith('browser_lf_keyboard');
    });

    it('requests project Save when classes are clean (Windows)', () => {
      vi.mocked(useClassStore).mockReturnValue({
        saveAll: mockSaveAll,
        hasUnsavedChanges: false,
      } as unknown as ReturnType<typeof useClassStore>);

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });

      document.dispatchEvent(event);

      expect(mockSaveProject).toHaveBeenCalledWith('browser_lf_keyboard');
    });

    it('calls e.preventDefault() when Cmd+S is pressed (Mac)', () => {
      // Simulate Mac environment
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      vi.mocked(useClassStore).mockReturnValue({
        saveAll: mockSaveAll,
        hasUnsavedChanges: true,
      } as unknown as ReturnType<typeof useClassStore>);

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
      });
      const preventDefaultSpy = vi.fn();
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });

      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('calls e.preventDefault() even when hasUnsavedChanges is false (Mac)', () => {
      // Simulate Mac environment
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      vi.mocked(useClassStore).mockReturnValue({
        saveAll: mockSaveAll,
        hasUnsavedChanges: false,
      } as unknown as ReturnType<typeof useClassStore>);

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
      });
      const preventDefaultSpy = vi.fn();
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });

      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cmd+Z / Ctrl+Z undo shortcut', () => {
    it('calls single undo on Cmd+Z (Mac)', () => {
      // Simulate Mac environment
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });

      document.dispatchEvent(event);

      // Should call undo only ONCE (single undo source)
      expect(mockUndoElements).toHaveBeenCalledTimes(1);
    });

    it('calls single redo on Cmd+Shift+Z (Mac)', () => {
      // Simulate Mac environment
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });

      renderHook(() => useKeyboardShortcuts());

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });

      document.dispatchEvent(event);

      // Should call redo only ONCE (single undo source)
      expect(mockRedoElements).toHaveBeenCalledTimes(1);
    });
  });

  describe('canvas zoom shortcuts', () => {
    function listenZoom(): { actions: string[]; stop: () => void } {
      const actions: string[] = [];
      const handler = (e: Event) => actions.push((e as CustomEvent).detail.action);
      window.addEventListener('sq:zoom-command', handler);
      return { actions, stop: () => window.removeEventListener('sq:zoom-command', handler) };
    }

    function press(init: KeyboardEventInit): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
      document.dispatchEvent(event);
      return event;
    }

    beforeEach(() => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    });

    it('Cmd+0 dispatches reset and prevents the browser default', () => {
      const zoom = listenZoom();
      renderHook(() => useKeyboardShortcuts());
      const event = press({ key: '0', metaKey: true });
      expect(zoom.actions).toEqual(['reset']);
      expect(event.preventDefault).toHaveBeenCalled();
      zoom.stop();
    });

    it('Cmd+= and Cmd+Shift+= (the "+" key) dispatch in', () => {
      const zoom = listenZoom();
      renderHook(() => useKeyboardShortcuts());
      press({ key: '=', metaKey: true });
      press({ key: '+', metaKey: true, shiftKey: true });
      expect(zoom.actions).toEqual(['in', 'in']);
      zoom.stop();
    });

    it('Cmd+- dispatches out', () => {
      const zoom = listenZoom();
      renderHook(() => useKeyboardShortcuts());
      press({ key: '-', metaKey: true });
      expect(zoom.actions).toEqual(['out']);
      zoom.stop();
    });

    it('Shift+1 dispatches fit', () => {
      const zoom = listenZoom();
      renderHook(() => useKeyboardShortcuts());
      press({ key: '!', code: 'Digit1', shiftKey: true });
      expect(zoom.actions).toEqual(['fit']);
      zoom.stop();
    });

    it('bare 0 / 1 / = / - dispatch nothing', () => {
      const zoom = listenZoom();
      renderHook(() => useKeyboardShortcuts());
      press({ key: '0' });
      press({ key: '1', code: 'Digit1' });
      press({ key: '=' });
      press({ key: '-' });
      expect(zoom.actions).toEqual([]);
      zoom.stop();
    });

    it('ignores Cmd+0 while typing in an input (existing guard)', () => {
      const zoom = listenZoom();
      renderHook(() => useKeyboardShortcuts());
      const input = document.createElement('input');
      document.body.appendChild(input);
      const event = new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true });
      input.dispatchEvent(event);
      expect(zoom.actions).toEqual([]);
      input.remove();
      zoom.stop();
    });
  });
});

it('owns a rejected shortcut save and leaves the dirty owner available for retry', async () => {
  const failed = Promise.reject(new Error('source write refused'));
  void failed.catch(() => {});
  const catchOwner = vi.spyOn(failed, 'catch');
  mockSaveProject.mockReturnValueOnce(failed);
  vi.mocked(useClassStore).mockReturnValue({ saveAll: mockSaveAll, hasUnsavedChanges: true } as unknown as ReturnType<typeof useClassStore>);
  renderHook(() => useKeyboardShortcuts());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  await Promise.resolve();
  expect(catchOwner).toHaveBeenCalledWith(expect.any(Function));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  expect(mockSaveProject.mock.calls.length).toBeGreaterThanOrEqual(2);
});
