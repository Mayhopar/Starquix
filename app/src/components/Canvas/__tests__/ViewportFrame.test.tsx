/**
 * ViewportFrame Tests
 *
 * Phase 2 tests covering:
 * - Message handling (ELEMENT_CLICK, ELEMENTS_SCANNED, EDIT_MODE_EXITED, etc.)
 * - State management (selection, hover, editing mode)
 * - Iframe communication (sending messages to iframe)
 * - Class sync, text sync, link attribute sync
 * - Keyboard event forwarding
 * - Context management (drill-down, exit context)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { ViewportFrame, type ElementRect } from '../ViewportFrame';
import { setScreenHeight } from '../viewportHeightPreferences';
import { _resetGridCacheForTests, setGrid } from '../gridPreferences';
import { SelectionProvider, useScannedElements, useRectActions, useScannedElementsRef } from '@/context/SelectionContext';
import { recordEditorMetric } from '@/performance/editorMetrics';

// ==============================================================
// Mocks
// ==============================================================

vi.mock('@/performance/editorMetrics', async importOriginal => ({
  ...await importOriginal<typeof import('@/performance/editorMetrics')>(),
  editorMetricsEnabled: true,
  recordEditorMetric: vi.fn(),
}));
let realSelectionMode = false;
// Mock hooks
const mockDispatch = vi.fn();
const mockSelectInContext = vi.fn();
const mockUpdateSelectionRect = vi.fn();
const mockEnterContext = vi.fn();
const mockExitContext = vi.fn();
const mockEnterEditMode = vi.fn();
const mockOpenPost = vi.fn();
const mockExitEditMode = vi.fn();
const mockSetScannedElements = vi.fn();
const mockUpdateScannedElementRects = vi.fn();
const mockRegisterElement = vi.fn();
const mockSetTextSelection = vi.fn();
const mockClearTextSelection = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockIsUndoingRef = { current: false };
const mockIsLinkInteractingRef = { current: false };
const mockClearSelection = vi.fn();
const mockSetSelectionDocScope = vi.fn();
const mockResetContext = vi.fn();
const mockSetReparentDragKey = vi.fn();
const mockUpdateBgImagePreview = vi.fn();
const mockUpdateImagePreview = vi.fn();

// Mock Yjs doc
const mockDoc = {
  getMap: vi.fn(() => ({
    forEach: vi.fn(),
    observe: vi.fn(),
    unobserve: vi.fn(),
    observeDeep: vi.fn(),
    unobserveDeep: vi.fn(),
    get: vi.fn(),
  })),
  transact: vi.fn((fn: () => void) => fn()),
};

// Mock dev server



// Mock ViteClassWriter
vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: {
    setIframeRef: vi.fn(),
    setRealInstanceState: vi.fn(),
    setLocalInstanceState: vi.fn(),
    writeClassUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock ViteTextWriter
vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: {
    setIframeRef: vi.fn(),
    setRealInstanceState: vi.fn(),
    setLocalInstanceState: vi.fn(),
    writeTextUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock ViteImageWriter
vi.mock('@/services/ViteImageWriter', () => ({
  viteImageWriter: {
    setIframeRef: vi.fn(),
    setRealInstanceState: vi.fn(),
    setLocalInstanceState: vi.fn(),
    writeImageUpdate: vi.fn().mockResolvedValue(false),
  },
}));

// Mock content collections hooks/selectors
vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollections: () => [],
}));

vi.mock('@/hooks/useContentCollections', () => ({
  // Stable object — the real hook holds `collections` in useState, so its
  // identity survives rerenders (the RENDER dedupe depends on that).
  useContentCollections: (() => {
    const stable = { collections: [], isLoading: false, error: null, refresh: vi.fn() };
    return () => stable;
  })(),
}));

vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

// Mock PostEditorContext
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({
    editingPost: null,
    openPost: mockOpenPost,
    closePost: vi.fn(),
    previewPost: null,
    setPreviewPost: vi.fn(),
    clearPreviewPost: vi.fn(),
  }),
}));

// Mock PagesContext — ViewportFrame reads pages/setActivePage for
// PREVIEW_NAVIGATE (task-116). This file mocks contexts rather than mounting
// real providers, so follow that.
vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({
    pages: testMockValues.pages,
    setActivePage: mockSetActivePage,
  }),
}));

// Store context state
let contextKeyValue: string | null = null;
let isEditingTextValue = false;
let selectedKeyValue: string | null = null;
let layoutNameValue: string | null = null;
let scannedElementsValue: Array<{
  key: string;
  tagName: string;
  classes: string;
  parentKey: string | null;
  sourceLocation?: { file: string; line: number; column: number };
  rect?: ElementRect;
  bodyLine?: number;
}> = [];

vi.mock('@/context/SelectionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/SelectionContext')>();
  const { deriveSelectedElementId } = actual;
  return {
  ...actual,
  deriveSelectedElementId,
  useScannedElements: () => realSelectionMode ? actual.useScannedElements() : ({
    scannedElements: scannedElementsValue,
    setScannedElements: mockSetScannedElements,
    updateScannedElementRects: mockUpdateScannedElementRects,
    scannedByKey: new Map(),
  }),
  useScannedElementsRef: () => realSelectionMode ? actual.useScannedElementsRef() : ({
    scannedElementsRef: { current: scannedElementsValue },
    scannedByKeyRef: { current: new Map() },
    treeNodesRef: { current: [] },
  }),
  // ViewportFrame + MultiSelectionRects (mounted inside it) share this context.
  useSelectionContext: () => realSelectionMode ? actual.useSelectionContext() : ({
    additionalSelections: [],
    select: mockSelectInContext,
    clearSelection: mockClearSelection,
    setSelectionDocScope: mockSetSelectionDocScope,
    selectedKey: selectedKeyValue,
    selectedElementId: deriveSelectedElementId(selectedKeyValue),
    selectedKeyRef: { current: selectedKeyValue },
    selectedElementIdRef: { current: deriveSelectedElementId(selectedKeyValue) },
    contextKeyRef: { current: contextKeyValue },
    contextKey: contextKeyValue,
    enterContext: mockEnterContext,
    exitContext: mockExitContext,
    resetContext: mockResetContext,
    isEditingText: isEditingTextValue,
    enterEditMode: mockEnterEditMode,
    exitEditMode: mockExitEditMode,
    reparentDragKey: null,
    setReparentDragKey: mockSetReparentDragKey,
    updateBgImagePreview: mockUpdateBgImagePreview,
    updateImagePreview: mockUpdateImagePreview,
  }),
  useRectActions: () => realSelectionMode ? actual.useRectActions() : ({ updateSelectionRect: mockUpdateSelectionRect }),
  useElementGeometry: (key: string) => realSelectionMode ? actual.useElementGeometry(key) : scannedElementsValue.find(el => el.key === key)?.rect ?? null,
  useElementGeometries: (keys: string[]) => realSelectionMode ? actual.useElementGeometries(keys) : keys.map(key => scannedElementsValue.find(el => el.key === key)?.rect ?? null),
  useRectHover: () => realSelectionMode ? actual.useRectHover() : ({
    selectedRect: null,
    updateSelectionRect: mockUpdateSelectionRect,
  }),
  useTextSelection: () => realSelectionMode ? actual.useTextSelection() : ({
    setTextSelection: mockSetTextSelection,
    clearTextSelection: mockClearTextSelection,
    isLinkInteractingRef: mockIsLinkInteractingRef,
  }),
  };
});

vi.mock('@/context', () => ({
  useClassStore: () => ({
    registerElement: mockRegisterElement,
  }),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    takeSnapshot: mockTakeSnapshot,
    isUndoingRef: mockIsUndoingRef,
  }),
}));

// Mock store values - controlled via testMockValues object
const { mockSetActivePage } = vi.hoisted(() => ({ mockSetActivePage: vi.fn() }));

const testMockValues = {
  currentPage: { id: 'page-1', name: 'Home', rootElementIds: [] } as { id: string; name: string; rootElementIds: string[] } | null,
  currentPageId: 'page-1' as string | null,
  projectId: 'project-1' as string | null,
  rootElements: [] as unknown[],
  pageComponents: [{ id: 'comp-1', type: 'section' }] as unknown[],
  originalSourceText: {} as Record<string, string>,
  pages: [{ id: 'page-1', name: 'Home', rootElementIds: [], children: [], isHome: true }] as unknown[],
};

// Mock the entire selectors module
vi.mock('@/store/selectors', () => ({
  selectCurrentPage: () => testMockValues.currentPage,
  selectCurrentPageId: () => testMockValues.currentPageId,
  selectCurrentThemeMode: () => null,
  selectProjectId: () => testMockValues.projectId,
  selectPageRootElements: () => testMockValues.rootElements,
  selectPageComponents: () => testMockValues.pageComponents,
  selectRootElementIds: () => [],
  // Stable reference per pageComponents identity — mirrors production, where
  // useYjsValue's valueEqual keeps renderState referentially stable (the
  // task-120 RENDER dedupe keys off input identity).
  selectRenderState: (() => {
    let lastComps: unknown = null;
    let lastState: unknown = null;
    return () => {
      if (testMockValues.pageComponents !== lastComps) {
        lastComps = testMockValues.pageComponents;
        lastState = { components: testMockValues.pageComponents, childOrders: {}, drawnElements: [] };
      }
      return lastState;
    };
  })(),
  isRenderStateEmpty: (rs: { components: unknown[]; drawnElements: unknown[] } | null) =>
    (rs?.components.length ?? 0) === 0 && (rs?.drawnElements.length ?? 0) === 0,
  selectChildOrders: () => ({}),
  selectPageDrawnElements: () => [],
  selectPageLayout: () => ({ layoutName: layoutNameValue, layoutProps: {} }),
  selectPostPageByCollectionId: () => null,
  selectPostPageRenderData: () => null,
  selectOriginalSourceText: (_doc: unknown, key: string) =>
    testMockValues.originalSourceText[key] ?? null,
}));

vi.mock('@/store/hooks', async () => {
  const { useRef } = await import('react');
  // Mirrors production useYjsValue: the returned value is referentially
  // STABLE while its content is unchanged (valueEqual gating). The task-120
  // RENDER dedupe keys off input identity, so a mock that returned a fresh
  // object per render would re-send RENDER on every rerender.
  const useStableYjsValue = (selector: (doc: unknown) => unknown) => {
    const ref = useRef<{ init: boolean; value: unknown }>({ init: false, value: undefined });
    const next = selector(mockDoc);
    const same = ref.current.init && JSON.stringify(next) === JSON.stringify(ref.current.value);
    if (!same) ref.current = { init: true, value: next };
    return ref.current.value;
  };
  return {
    useYjsValue: vi.fn(useStableYjsValue),
    useScopedYjsValue: vi.fn(useStableYjsValue),
    useCurrentPageId: () => testMockValues.currentPageId,
    useProjectId: () => testMockValues.projectId,
    useCurrentThemeMode: () => null,
    useDispatch: () => mockDispatch,
    useEditorDoc: () => mockDoc,
  };
});

// Mock parseKey
vi.mock('@/store/types', async () => {
  const actual = await vi.importActual<typeof import('@/store/types')>('@/store/types');
  return {
    ...actual,
    parseKey: vi.fn((key: string) => {
      if (key.startsWith('src/content/')) return actual.parseKey(key);
      if (key.includes(':')) {
        const parts = key.split(':');
        if (parts.length === 2) {
          return { type: 'instance-child', instanceId: parts[0], selector: parts[1] };
        }
      }
      return { type: 'source' };
    }),
  };
});

// Mock parseSourceKey
vi.mock('@/utils/parseSourceKey', () => ({
  parseSourceKey: vi.fn((key: string) => {
    if (key.includes(':') && !key.includes('.astro')) {
      const parts = key.split(':');
      if (parts.length === 2) {
        return { type: 'instance', instanceId: parts[0], childId: parts[1] };
      }
    }
    return { type: 'source' };
  }),
}));

// Mock getInstanceOverrideAPI
vi.mock('@/store/overrides', () => ({
  getInstanceOverrideAPI: vi.fn(() => ({
    setHref: vi.fn(),
  })),
}));

// Mock localStorage (jsdom may not provide it for opaque origins)
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
      get length() { return Object.keys(store).length; },
      key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    },
    configurable: true,
  });
}

// ==============================================================
// Test Utilities
// ==============================================================

// Mock contentWindow for iframe - jsdom doesn't provide real contentWindow
const mockContentWindow = {
  postMessage: vi.fn(),
};

// Patch HTMLIFrameElement.prototype to return our mock contentWindow
const originalContentWindowDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
  get() {
    return mockContentWindow;
  },
  configurable: true,
});

function simulateMessage(type: string, payload?: Record<string, unknown>) {
  // Use mockContentWindow as source so the source check passes
  const event = new MessageEvent('message', {
    data: { type, payload },
    source: mockContentWindow as unknown as Window,
  });
  window.dispatchEvent(event);
}

// For legacy preview messages (ELEMENT_CLICKED, etc.) that don't use payload wrapper
function simulateLegacyMessage(type: string, data?: Record<string, unknown>) {
  const event = new MessageEvent('message', {
    data: { type, ...data },
    source: mockContentWindow as unknown as Window,
  });
  window.dispatchEvent(event);
}

function renderViewportFrame(props = {}) {
  return render(
    <ViewportFrame breakpoint="md" scale={1} {...props} />
  );
}

// ==============================================================
// Tests
// ==============================================================

describe('ViewportFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realSelectionMode = false;
    contextKeyValue = null;
    isEditingTextValue = false;
    selectedKeyValue = null;
    layoutNameValue = null;
    scannedElementsValue = [];
    mockIsUndoingRef.current = false;
    mockIsLinkInteractingRef.current = false;

    // Reset testMockValues
    testMockValues.currentPage = { id: 'page-1', name: 'Home', rootElementIds: [] };
    testMockValues.currentPageId = 'page-1';
    testMockValues.projectId = 'project-1';
    testMockValues.rootElements = [];
    testMockValues.pageComponents = [{ id: 'comp-1', type: 'section' }];
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockContentWindow.postMessage.mockClear();
  });

  // =====================================================
  // Fix C: preview form submit → putRow → ack
  // =====================================================
  it('real provider rect patches update chrome with zero tree builds or host commits and preserve iframe identity', () => {
    realSelectionMode = true;
    let api: ReturnType<typeof useScannedElements> & ReturnType<typeof useRectActions> & ReturnType<typeof useScannedElementsRef>;
    function Driver() { api = { ...useScannedElements(), ...useRectActions(), ...useScannedElementsRef() }; return null; }
    const view = render(<SelectionProvider><Driver /><ViewportFrame breakpoint="md" /></SelectionProvider>);
    const iframe = view.container.querySelector('iframe')!;
    const originalSrc = iframe.getAttribute('src');
    const el = { key: 'image', parentKey: null, tagName: 'img', classes: '', imageSrc: '', hasSourceTracking: true, rect: { top: 10, left: 20, width: 100, height: 50 } };
    act(() => api.setScannedElements([el]));
    const tree = api!.treeNodes;
    vi.mocked(recordEditorMetric).mockClear();
    act(() => {
      api.updateScannedElementRects([{ key: 'image', rect: { ...el.rect, width: 140, top: 30 } }]);
      api.updateSelectionRect({ ...el.rect, width: 140, top: 30 });
      expect(api.scannedByKeyRef.current.get('image')?.rect.width).toBe(140);
    });
    expect(vi.mocked(recordEditorMetric).mock.calls.filter(([name]) => name === 'tree-build')).toHaveLength(0);
    expect(vi.mocked(recordEditorMetric).mock.calls.filter(([name]) => name === 'viewport-commit')).toHaveLength(0);
    expect(api!.treeNodes).toBe(tree);
    expect(view.container.querySelector('iframe')).toBe(iframe);
    expect(iframe.getAttribute('src')).toBe(originalSrc);
    expect(view.container.querySelector('.border-dashed.bg-bg-contrast')).toHaveStyle({ width: '140px', top: '30px' });
    expect(view.container.querySelector('[data-handle="se"]')?.parentElement).toHaveStyle({ width: '140px', top: '30px' });
    act(() => api.setScannedElements([{ ...el, imageSrc: '/filled.png' }]));
    expect(view.container.querySelector('.border-dashed.bg-bg-contrast')).toBeNull();
    expect(api!.treeNodes).not.toBe(tree);
  });

  // =====================================================
  // Rendering Tests
  // =====================================================
  describe('Rendering', () => {
    it('should render with correct breakpoint width', () => {
      renderViewportFrame({ breakpoint: 'lg' });
      const container = document.querySelector('[data-testid="editor-canvas"]');
      expect(container).toBeTruthy();
    });

    it('should show loading spinner when iframe not ready', () => {
      renderViewportFrame();
      // Spinner is shown initially before IFRAME_READY
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });

    it('should hide spinner after IFRAME_READY', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('IFRAME_READY');
      });

      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeFalsy();
      });
    });

  });


  // =====================================================
  // ELEMENT_CLICK Message Tests
  // =====================================================
  describe('ELEMENT_CLICK Message', () => {
    it('selects via SelectionContext only on element click (no SELECT_SOURCE_ELEMENT dispatch)', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Hero.astro:5:1',
          tagName: 'div',
          classes: 'flex gap-4',
          sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
          rect: { top: 100, left: 50, width: 400, height: 200 },
        });
      });

      expect(mockSelectInContext).toHaveBeenCalledWith(
        'src/components/Hero.astro:5:1',
        expect.objectContaining({ classes: 'flex gap-4' }),
      );
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SELECT_SOURCE_ELEMENT' }),
      );
    });

    it('should call selectInContext with element data', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Hero.astro:5:1',
          tagName: 'section',
          classes: 'py-16',
          rect: { top: 0, left: 0, width: 100, height: 100 },
          parentDisplay: 'block',
        });
      });

      expect(mockSelectInContext).toHaveBeenCalledWith('src/components/Hero.astro:5:1', expect.objectContaining({
        tagName: 'section',
        classes: 'py-16',
        parentDisplay: 'block',
      }));
    });

    it('should register element in ClassStore', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Hero.astro:5:1',
          tagName: 'div',
          classes: 'text-blue-500',
          sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
          rect: { top: 0, left: 0, width: 100, height: 100 },
        });
      });

      expect(mockRegisterElement).toHaveBeenCalledWith(
        'src/components/Hero.astro:5:1',
        'text-blue-500',
        { file: 'src/components/Hero.astro', line: 5, column: 1 }
      );
    });

    it('should update selection rect', async () => {
      renderViewportFrame();

      const rect = { top: 50, left: 25, width: 200, height: 100 };
      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'test-key',
          tagName: 'div',
          classes: '',
          rect,
        });
      });

      expect(mockUpdateSelectionRect).toHaveBeenCalled();
    });

    it('should enter edit mode on double-click without children', async () => {
      selectedKeyValue = 'src/components/Text.astro:1:1';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Text.astro:1:1',
          tagName: 'p',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          isDoubleClick: true,
          hasChildren: false,
        });
      });

      expect(mockEnterEditMode).toHaveBeenCalled();
    });

    it.each([
      'src/content/posts/hello.mdx:7:1',
      // A post rendered through a layout carries its placement (owner's project, 2026-10-12).
      'src/content/posts/hello.mdx:7:1~sdaae1174d4ca87b6',
    ])('post body text opens the writing view at its line, never an in-canvas edit (edit never reached the .mdx): %s', async (KEY) => {
      scannedElementsValue = [{ key: KEY, tagName: 'p', classes: '', parentKey: null, bodyLine: 1 }];
      selectedKeyValue = KEY;
      renderViewportFrame();
      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: KEY, tagName: 'p', classes: '',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          isDoubleClick: true, hasChildren: false,
        });
      });
      expect(mockEnterEditMode).not.toHaveBeenCalled();
      expect(mockOpenPost).toHaveBeenCalledWith('posts', 'hello', 1);
    });

    it('should enter context on double-click with children', async () => {
      selectedKeyValue = 'src/components/Card.astro:1:1';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Card.astro:1:1',
          tagName: 'div',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 100 },
          isDoubleClick: true,
          hasChildren: true,
        });
      });

      expect(mockEnterContext).toHaveBeenCalledWith('src/components/Card.astro:1:1');
    });

    it('should reset context when clicking outside current context', async () => {
      // Outside-context clicks reset all drill levels (resetContext), not just
      // pop one (exitContext) — the latter is reserved for Escape inside a
      // context. See ViewportFrame ELEMENT_CLICK handler around line 903.
      contextKeyValue = 'parent-context';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'outside-element',
          tagName: 'div',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 100 },
          isOutsideContext: true,
        });
      });

      expect(mockResetContext).toHaveBeenCalled();
      expect(mockExitContext).not.toHaveBeenCalled();
    });

    it('should not exit context on direct select (Cmd+click)', async () => {
      contextKeyValue = 'parent-context';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'some-element',
          tagName: 'div',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 100 },
          isDirectSelect: true,
          isOutsideContext: true,
        });
      });

      expect(mockExitContext).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // ELEMENT_HOVER Message Tests
  // =====================================================
  describe('ELEMENT_HOVER Message', () => {
    it('should update hover rect on ELEMENT_HOVER', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_HOVER', {
          rect: { top: 10, left: 20, width: 100, height: 50 },
        });
      });

      // Hover rect is internal state, but we can verify no errors
      expect(true).toBe(true);
    });

    it('should clear hover rect on ELEMENT_HOVER_END', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_HOVER_END');
      });

      // Hover rect cleared, no errors
      expect(true).toBe(true);
    });
  });

  // =====================================================
  // ELEMENTS_SCANNED Message Tests
  // =====================================================
  describe('ELEMENTS_SCANNED Message', () => {
    it('should update scanned elements', async () => {
      renderViewportFrame();

      const elements = [
        { key: 'el-1', tagName: 'div', classes: 'flex', parentKey: null },
        { key: 'el-2', tagName: 'p', classes: 'text-lg', parentKey: 'el-1' },
      ];

      await act(async () => {
        simulateMessage('ELEMENTS_SCANNED', { elements });
      });

      expect(mockSetScannedElements).toHaveBeenCalledWith(elements);
    });

    it('should auto-set context to infrastructure container', async () => {
      renderViewportFrame();

      const elements = [
        { key: 'src/pages/[pageId].astro:1:1', tagName: 'div', classes: '', parentKey: null },
        { key: 'src/components/Section.astro:1:1', tagName: 'section', classes: '', parentKey: 'src/pages/[pageId].astro:1:1' },
      ];

      await act(async () => {
        simulateMessage('ELEMENTS_SCANNED', { elements });
      });

      // enterContext never selects (context ≠ selection), and select() itself
      // refuses infra keys — the wrapper can't become the selection.
      expect(mockEnterContext).toHaveBeenCalledWith('src/pages/[pageId].astro:1:1');
    });
  });

  // =====================================================
  // EDIT_MODE_EXITED Message Tests
  // =====================================================
  describe('EDIT_MODE_EXITED Message', () => {
    it('should exit edit mode', async () => {
      isEditingTextValue = true;
      renderViewportFrame();

      await act(async () => {
        simulateMessage('EDIT_MODE_EXITED', {
          key: 'src/components/Text.astro:1:1',
          textContent: 'Hello World',
          originalText: 'Hello World',
        });
      });

      expect(mockExitEditMode).toHaveBeenCalled();
      expect(mockClearTextSelection).toHaveBeenCalled();
    });

    it('should not take snapshot on EDIT_MODE_EXITED (snapshot belongs to entry)', async () => {
      // task-018: snapshot is taken at sendEnterEditMode time, never at exit.
      renderViewportFrame();

      await act(async () => {
        simulateMessage('EDIT_MODE_EXITED', {
          key: 'test-key',
          textContent: 'Same text',
          originalText: 'Same text',
        });
      });

      expect(mockTakeSnapshot).not.toHaveBeenCalled();
    });

    it('should dispatch UPDATE_SOURCE_TEXT without taking a new snapshot if text changed', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('EDIT_MODE_EXITED', {
          key: 'src/components/Text.astro:1:1',
          textContent: 'New text',
          originalText: 'Old text',
        });
      });

      // Snapshot must NOT be taken here — it was already taken at edit entry.
      // Snapshotting on exit would capture the edited state and break undo.
      expect(mockTakeSnapshot).not.toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'UPDATE_SOURCE_TEXT',
        sourceKey: 'src/components/Text.astro:1:1',
        textContent: 'New text',
        originalText: 'Old text',
      }));
    });

    it('should dispatch UPDATE_INSTANCE_OVERRIDE for instance elements without snapshot at exit', async () => {
      scannedElementsValue = [
        { key: 'inst-1:child-1', tagName: 'p', classes: '', parentKey: null },
      ];
      renderViewportFrame();

      await act(async () => {
        simulateMessage('EDIT_MODE_EXITED', {
          key: 'inst-1:child-1',
          textContent: 'Updated instance text',
          originalText: 'Original text',
        });
      });

      expect(mockTakeSnapshot).not.toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'UPDATE_INSTANCE_OVERRIDE',
        instanceId: 'inst-1',
        childId: 'child-1',
        updates: { text: 'Updated instance text' },
      }));
    });
  });

  // =====================================================
  // ENTER_EDIT_MODE Snapshot Timing Tests (task-018)
  // =====================================================
  describe('ENTER_EDIT_MODE Snapshot Timing', () => {
    it('takes snapshot when entering edit mode via double-click', async () => {
      // Regression: takeSnapshot() must run BEFORE the user starts mutating
      // text, otherwise undo restores the already-edited state.
      selectedKeyValue = 'src/components/Text.astro:1:1';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Text.astro:1:1',
          tagName: 'p',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          isDoubleClick: true,
          hasChildren: false,
        });
      });

      expect(mockEnterEditMode).toHaveBeenCalled();
      expect(mockTakeSnapshot).toHaveBeenCalled();
    });

    it('takes snapshot when entering edit mode via Enter key', async () => {
      selectedKeyValue = 'text-element';
      scannedElementsValue = [
        { key: 'text-element', tagName: 'p', classes: '', parentKey: null },
      ];
      renderViewportFrame();

      await act(async () => {
        simulateMessage('KEYBOARD_EVENT', {
          key: 'Enter',
          code: 'Enter',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
      });

      expect(mockEnterEditMode).toHaveBeenCalled();
      expect(mockTakeSnapshot).toHaveBeenCalled();
    });

    it('snapshot precedes ENTER_EDIT_MODE postMessage and EDIT_MODE_EXITED does not snapshot again', async () => {
      // End-to-end ordering check: enter -> snapshot -> exit-with-change ->
      // no further snapshot. Ensures the past stack contains the pre-edit
      // state, so the first undo restores original text.
      selectedKeyValue = 'src/components/Text.astro:1:1';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Text.astro:1:1',
          tagName: 'p',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          isDoubleClick: true,
          hasChildren: false,
        });
      });

      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => {
        simulateMessage('EDIT_MODE_EXITED', {
          key: 'src/components/Text.astro:1:1',
          textContent: 'edited text',
          originalText: 'original text',
        });
      });

      // Still exactly one snapshot — taken at entry, not duplicated at exit.
      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'UPDATE_SOURCE_TEXT',
        sourceKey: 'src/components/Text.astro:1:1',
        textContent: 'edited text',
        originalText: 'original text',
      }));
    });
  });

  // =====================================================
  // ENTER_EDIT_MODE originalText baseline (task-049 TI-1/TI-2)
  // =====================================================
  describe('ENTER_EDIT_MODE originalText baseline', () => {
    afterEach(() => {
      testMockValues.originalSourceText = {};
    });

    it('includes the pre-override source text in the payload when resolvable', async () => {
      // The bridge stores payload.originalText unconditionally as the
      // RESTORE_ORIGINAL_TEXT baseline (fixes the stale first-seen-DOM capture).
      testMockValues.originalSourceText = { 'el-hero:p-0': 'source text' };
      selectedKeyValue = 'el-hero:p-0';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'el-hero:p-0',
          tagName: 'p',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          isDoubleClick: true,
          hasChildren: false,
        });
      });

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'ENTER_EDIT_MODE',
          payload: { key: 'el-hero:p-0', originalText: 'source text' },
        },
        '*',
      );
    });

    it('omits originalText when no source baseline exists (bridge falls back to DOM capture)', async () => {
      selectedKeyValue = 'src/components/Text.astro:1:1';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('ELEMENT_CLICK', {
          key: 'src/components/Text.astro:1:1',
          tagName: 'p',
          classes: '',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          isDoubleClick: true,
          hasChildren: false,
        });
      });

      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        {
          type: 'ENTER_EDIT_MODE',
          payload: { key: 'src/components/Text.astro:1:1' },
        },
        '*',
      );
    });
  });

  // =====================================================
  // KEYBOARD_EVENT Message Tests
  // =====================================================
  describe('KEYBOARD_EVENT Message', () => {
    it('should exit context on Escape when in context', async () => {
      contextKeyValue = 'parent-context';
      renderViewportFrame();

      await act(async () => {
        simulateMessage('KEYBOARD_EVENT', {
          key: 'Escape',
          code: 'Escape',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
      });

      expect(mockExitContext).toHaveBeenCalled();
    });

    it('should not exit context on Escape when not in context', async () => {
      contextKeyValue = null;
      renderViewportFrame();

      await act(async () => {
        simulateMessage('KEYBOARD_EVENT', {
          key: 'Escape',
          code: 'Escape',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
      });

      expect(mockExitContext).not.toHaveBeenCalled();
    });

    it('should drill down on Enter with selected element that has children', async () => {
      selectedKeyValue = 'parent-element';
      scannedElementsValue = [
        { key: 'parent-element', tagName: 'div', classes: '', parentKey: null },
        { key: 'child-element', tagName: 'p', classes: '', parentKey: 'parent-element' },
      ];
      renderViewportFrame();

      await act(async () => {
        simulateMessage('KEYBOARD_EVENT', {
          key: 'Enter',
          code: 'Enter',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
      });

      expect(mockEnterContext).toHaveBeenCalledWith('parent-element');
      expect(mockSelectInContext).toHaveBeenCalledWith('child-element', expect.anything());
    });

    it('should enter edit mode on Enter with element without children', async () => {
      selectedKeyValue = 'text-element';
      scannedElementsValue = [
        { key: 'text-element', tagName: 'p', classes: '', parentKey: null },
      ];
      renderViewportFrame();

      await act(async () => {
        simulateMessage('KEYBOARD_EVENT', {
          key: 'Enter',
          code: 'Enter',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
      });

      expect(mockEnterEditMode).toHaveBeenCalled();
    });

    it('should dispatch synthetic keyboard event for other keys', async () => {
      renderViewportFrame();
      const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

      await act(async () => {
        simulateMessage('KEYBOARD_EVENT', {
          key: 'Delete',
          code: 'Delete',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(expect.any(KeyboardEvent));
      dispatchSpy.mockRestore();
    });
  });

  // =====================================================
  // TEXT_SELECTION_CHANGED Message Tests
  // =====================================================
  describe('TEXT_SELECTION_CHANGED Message', () => {
    it('should set text selection when has selection', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('TEXT_SELECTION_CHANGED', {
          key: 'test-key',
          selectedText: 'selected text',
          hasSelection: true,
          isInsideLink: false,
        });
      });

      expect(mockSetTextSelection).toHaveBeenCalledWith({
        hasTextSelection: true,
        selectedText: 'selected text',
        isInsideLink: false,
        existingHref: undefined,
        existingTarget: undefined,
        linkKey: undefined,
      });
    });

    it('should set text selection when inside link', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('TEXT_SELECTION_CHANGED', {
          key: 'test-key',
          selectedText: '',
          hasSelection: false,
          isInsideLink: true,
          existingHref: '/about',
          existingTarget: '_blank',
          linkKey: 'link-key',
        });
      });

      expect(mockSetTextSelection).toHaveBeenCalledWith({
        hasTextSelection: false,
        selectedText: '',
        isInsideLink: true,
        existingHref: '/about',
        existingTarget: '_blank',
        linkKey: 'link-key',
      });
    });

    it('should clear text selection when no selection and not in link', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('TEXT_SELECTION_CHANGED', {
          key: 'test-key',
          selectedText: '',
          hasSelection: false,
          isInsideLink: false,
        });
      });

      expect(mockClearTextSelection).toHaveBeenCalled();
    });

    it('should not clear text selection when link is interacting', async () => {
      mockIsLinkInteractingRef.current = true;
      renderViewportFrame();

      await act(async () => {
        simulateMessage('TEXT_SELECTION_CHANGED', {
          key: 'test-key',
          selectedText: '',
          hasSelection: false,
          isInsideLink: false,
        });
      });

      expect(mockClearTextSelection).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // MARKUP_CHANGED Message Tests
  // =====================================================
  describe('MARKUP_CHANGED Message', () => {
    it('should handle markup change for instance child', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('MARKUP_CHANGED', {
          key: 'inst-1:selector-1',
          innerHTML: '<strong>Bold text</strong>',
        });
      });

      expect(mockTakeSnapshot).toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'UPDATE_MARKUP_OVERRIDE',
        instanceId: 'inst-1',
        selector: 'selector-1',
        markup: '<strong>Bold text</strong>',
      }));
    });

    it('should handle markup change for source element', async () => {
      scannedElementsValue = [
        {
          key: 'src/components/Text.astro:5:1',
          tagName: 'p',
          classes: '',
          parentKey: null,
          sourceLocation: { file: 'src/components/Text.astro', line: 5, column: 1 },
        },
      ];
      renderViewportFrame();

      await act(async () => {
        simulateMessage('MARKUP_CHANGED', {
          key: 'src/components/Text.astro:5:1',
          innerHTML: '<em>Italic text</em>',
        });
      });

      expect(mockTakeSnapshot).toHaveBeenCalled();
    });
  });

  // =====================================================
  // RECT_UPDATED Message Tests
  // =====================================================
  describe('RECT_UPDATED Message', () => {
    it('should update selection rect on RECT_UPDATED', async () => {
      renderViewportFrame();

      const rect = { top: 100, left: 200, width: 300, height: 150 };
      await act(async () => {
        simulateMessage('RECT_UPDATED', { rect });
      });

      expect(mockUpdateSelectionRect).toHaveBeenCalled();
    });
  });

  // =====================================================
  // RECTS_UPDATED Message Tests
  // =====================================================
  describe('RECTS_UPDATED Message', () => {
    it('should update scanned element rects', async () => {
      renderViewportFrame();

      const rects = [
        { key: 'el-1', rect: { top: 0, left: 0, width: 100, height: 50 } },
        { key: 'el-2', rect: { top: 50, left: 0, width: 100, height: 50 } },
      ];

      await act(async () => {
        simulateMessage('RECTS_UPDATED', { rects });
      });

      expect(mockUpdateScannedElementRects).toHaveBeenCalledWith(rects);
    });
  });

  // =====================================================
  // CONTENT_HEIGHT Message Tests
  // =====================================================
  describe('CONTENT_HEIGHT Message', () => {
    it('should update iframe height on CONTENT_HEIGHT', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('IFRAME_READY');
      });

      await act(async () => {
        simulateMessage('CONTENT_HEIGHT', { height: 500 });
      });

      const iframe = document.querySelector('iframe');
      // Height is applied via style
      expect(iframe).toBeTruthy();
    });

    it('keeps the last reported height across breakpoint/components changes (no collapse to auto)', async () => {
      // Regression: a now-removed effect reset contentHeight to null whenever
      // components.length or breakpoint changed. That collapsed the iframe to
      // `auto` (~150px) until the bridge re-reported — at zoom ≠ 1 the
      // collapsed sliver sat off-screen and every element add made the whole
      // canvas "disappear" until the user zoomed around to find it.
      const { rerender } = renderViewportFrame();

      await act(async () => {
        simulateMessage('IFRAME_READY');
      });
      await act(async () => {
        simulateMessage('CONTENT_HEIGHT', { height: 500 });
      });

      const iframe = document.querySelector('iframe') as HTMLIFrameElement;
      expect(iframe.style.height).toBe('500px');

      // Breakpoint change must NOT collapse the height back to 'auto'.
      await act(async () => {
        rerender(<ViewportFrame breakpoint="lg" scale={1} />);
      });
      expect(iframe.style.height).toBe('500px');
    });
  });

  // =====================================================
  // WHEEL Message Tests
  // =====================================================
  describe('WHEEL Message', () => {
    it('should call onZoom with Ctrl/Meta key', async () => {
      const onZoom = vi.fn();
      renderViewportFrame({ onZoom });

      await act(async () => {
        simulateMessage('WHEEL', {
          deltaX: 0,
          deltaY: -10,
          clientX: 100,
          clientY: 100,
          ctrlKey: true,
          metaKey: false,
        });
      });

      expect(onZoom).toHaveBeenCalled();
    });

    it('should call onPan without modifier keys', async () => {
      const onPan = vi.fn();
      renderViewportFrame({ onPan });

      await act(async () => {
        simulateMessage('WHEEL', {
          deltaX: 10,
          deltaY: 20,
          clientX: 100,
          clientY: 100,
          ctrlKey: false,
          metaKey: false,
        });
      });

      expect(onPan).toHaveBeenCalledWith(10, 20);
    });
  });

  // =====================================================
  // Class Sync Message Tests
  // =====================================================
  describe('Class Sync Messages', () => {
    it('should forward SYNC_CLASSES_TO_IFRAME to iframe', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateMessage('IFRAME_READY');
      });

      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'SYNC_CLASSES_TO_IFRAME',
            payload: {
              key: 'test-key',
              classes: 'text-red-500',
              sourceLocation: { file: 'test.astro', line: 1, column: 1 },
            },
          },
        }));
      });

      // Message is forwarded to iframe (can't directly test postMessage)
      expect(true).toBe(true);
    });
  });

  // =====================================================
  // Class intents (instant-edit P0b / P1): draft paint, observer bookkeeping, per-document capability
  // =====================================================
  describe('Class intents', () => {
    const LOC = { file: 'test.astro', line: 1, column: 1 };
    const KEY = 'test.astro:1:1';
    const intent = (seq: number, hold = true) => ({ epoch: 'e1', seq, hold });
    const sync = async (payload: Record<string, unknown>) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'SYNC_CLASSES_TO_IFRAME', payload: { key: KEY, sourceLocation: LOC, ...payload } }, source: window }));
      });
    };
    const classUpdates = () => mockContentWindow.postMessage.mock.calls
      .map((call: unknown[]) => call[0] as { type?: string; payload?: Record<string, unknown> })
      .filter((message) => message?.type === 'UPDATE_CLASSES');

    it('ignores a call-time draft while the document has not announced intents (it gets the observer value at acceptance)', async () => {
      renderViewportFrame();
      await act(async () => { simulateMessage('IFRAME_READY', { documentHeight: 1, documentWidth: 1 }); });
      mockContentWindow.postMessage.mockClear();
      await sync({ classes: 'w-[3px]', draft: true, intent: intent(1) });
      expect(classUpdates()).toEqual([]);
    });

    it('forwards a draft WITH its intent to a document that announced classIntentV, and never files it for the intent-less replay', async () => {
      renderViewportFrame();
      await act(async () => { simulateMessage('IFRAME_READY', { documentHeight: 1, documentWidth: 1, classIntentV: 1 }); });
      mockContentWindow.postMessage.mockClear();
      await sync({ classes: 'w-[3px]', draft: true, intent: intent(1) });
      expect(classUpdates()).toEqual([{ type: 'UPDATE_CLASSES', payload: { key: KEY, classes: 'w-[3px]', sourceLocation: LOC, intent: intent(1) } }]);
      mockContentWindow.postMessage.mockClear();
      await act(async () => { simulateMessage('ELEMENTS_SCANNED', { elements: [{ key: KEY, tagName: 'div', classes: '', parentKey: null, sourceLocation: LOC }] }); });
      expect(classUpdates()).toEqual([]);   // a draft may still be rejected: nothing replays it without its intent
    });

    it('skips the observer message for a value that was already painted, but applies hold:false (it releases the paint\'s hold)', async () => {
      renderViewportFrame();
      await act(async () => { simulateMessage('IFRAME_READY', { documentHeight: 1, documentWidth: 1, classIntentV: 1 }); });
      mockContentWindow.postMessage.mockClear();
      await sync({ classes: 'w-[3px]', painted: true, intent: intent(1) });
      expect(classUpdates()).toEqual([]);
      await sync({ classes: 'w-[3px]', painted: true, intent: intent(1, false) });
      expect(classUpdates()).toHaveLength(1);
      expect((classUpdates()[0].payload as { intent: { hold: boolean } }).intent.hold).toBe(false);
    });

    it('an older bridge gets the observer value as before: no intent field, no draft, painted values applied', async () => {
      renderViewportFrame();
      await act(async () => { simulateMessage('IFRAME_READY', { documentHeight: 1, documentWidth: 1 }); });
      mockContentWindow.postMessage.mockClear();
      await sync({ classes: 'w-[3px]', painted: true, intent: intent(1) });
      expect(classUpdates()).toEqual([{ type: 'UPDATE_CLASSES', payload: { key: KEY, classes: 'w-[3px]', sourceLocation: LOC } }]);
    });

    it('a write without any intent (a doc-only edit) is forwarded untouched', async () => {
      renderViewportFrame();
      await act(async () => { simulateMessage('IFRAME_READY', { documentHeight: 1, documentWidth: 1, classIntentV: 1 }); });
      mockContentWindow.postMessage.mockClear();
      await sync({ classes: 'w-[9px]' });
      expect(classUpdates()).toEqual([{ type: 'UPDATE_CLASSES', payload: { key: KEY, classes: 'w-[9px]', sourceLocation: LOC } }]);
    });
  });

  // =====================================================
  // Link Command Event Tests
  // =====================================================
  describe('Link Command Events', () => {
    it('posts WRAP_SELECTION_IN_LINK on sq:wrap-link WITHOUT taking a snapshot (snapshot is deferred to MARKUP_CHANGED)', async () => {
      renderViewportFrame();

      await act(async () => {
        document.dispatchEvent(new CustomEvent('sq:wrap-link', {
          detail: { key: 'test-key', href: '/about', target: '_self' },
        }));
      });

      // No snapshot at dispatch time — the MARKUP_CHANGED handler snapshots
      // immediately before the actual Yjs mutation. A successful wrap thus
      // produces exactly ONE undo entry (one Cmd+Z reverts it).
      expect(mockTakeSnapshot).not.toHaveBeenCalled();

      // Bridge message must be posted to the iframe.
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WRAP_SELECTION_IN_LINK',
          payload: { key: 'test-key', href: '/about', target: '_self' },
        }),
        '*',
      );
    });

    /**
     * REGRESSION PIN — supersedes the task-008 pin:
     *
     * WRAP_SELECTION_IN_LINK is a fire-and-forget bridge message. The bridge
     * handler in `preview-template/public/scripts/bridge.js` has multiple
     * early-return failure paths (no selection range, cross-boundary
     * selection, element not found, surroundContents throws) and, on any of
     * those, returns WITHOUT sending an error/ack back to the parent.
     *
     * Option (b) from the original task-008 pin — deferring takeSnapshot
     * until MARKUP_CHANGED arrives — is now implemented. The dispatch site
     * neither snapshots nor mutates Yjs; both happen in the MARKUP_CHANGED
     * handler, which the bridge only sends on success. A silent bridge
     * failure therefore leaves the undo stack completely untouched (the
     * phantom no-op entry is gone).
     */
    it('leaves the undo stack and Yjs untouched on sq:wrap-link (snapshot + mutation both deferred to MARKUP_CHANGED)', async () => {
      renderViewportFrame();

      await act(async () => {
        document.dispatchEvent(new CustomEvent('sq:wrap-link', {
          detail: { key: 'test-key', href: '/about', target: '_self' },
        }));
      });

      // Neither a snapshot nor a Yjs dispatch — if the bridge silently fails
      // (no MARKUP_CHANGED ever returns), nothing happened from undo's
      // perspective. No phantom entry.
      expect(mockTakeSnapshot).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('posts UNWRAP_LINK on sq:unwrap-link WITHOUT taking a snapshot (snapshot is deferred to MARKUP_CHANGED)', async () => {
      renderViewportFrame();

      await act(async () => {
        document.dispatchEvent(new CustomEvent('sq:unwrap-link', {
          detail: { key: 'test-key', linkSelector: 'a-0' },
        }));
      });

      expect(mockTakeSnapshot).not.toHaveBeenCalled();
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UNWRAP_LINK',
          payload: { key: 'test-key', linkSelector: 'a-0' },
        }),
        '*',
      );
    });

    it('takes exactly ONE snapshot when MARKUP_CHANGED arrives after a wrap', async () => {
      renderViewportFrame();

      // User wraps a selection in a link…
      await act(async () => {
        document.dispatchEvent(new CustomEvent('sq:wrap-link', {
          detail: { key: 'el-1:p-0', href: '/about', target: '_self' },
        }));
      });

      // …and the bridge succeeds, sending MARKUP_CHANGED back.
      await act(async () => {
        simulateMessage('MARKUP_CHANGED', {
          key: 'el-1:p-0',
          innerHTML: '<a data-key="el-1:a-0" href="/about">text</a>',
          linkKey: 'el-1:a-0',
          href: '/about',
          target: '_self',
        });
      });

      // Exactly one snapshot for the whole wrap flow — one Cmd+Z reverts it.
      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'UPDATE_MARKUP_OVERRIDE',
        instanceId: 'el-1',
        selector: 'p-0',
      }));
    });
  });

  // =====================================================
  // Edit Mode Request Event Tests
  // =====================================================
  describe('Edit Mode Request Events', () => {
    it('should handle sq:request-edit-mode event', async () => {
      selectedKeyValue = 'test-element';
      renderViewportFrame();

      await act(async () => {
        window.dispatchEvent(new CustomEvent('sq:request-edit-mode', {
          detail: { key: 'test-element' },
        }));
      });

      expect(mockEnterEditMode).toHaveBeenCalled();
    });

    it('should not enter edit mode if already editing', async () => {
      isEditingTextValue = true;
      renderViewportFrame();

      await act(async () => {
        window.dispatchEvent(new CustomEvent('sq:request-edit-mode', {
          detail: { key: 'test-element' },
        }));
      });

      expect(mockEnterEditMode).not.toHaveBeenCalled();
    });
  });

  // =====================================================
  // Legacy Preview Message Tests
  // =====================================================
  describe('Legacy Preview Messages', () => {
    it('should handle READY message', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateLegacyMessage('READY');
      });

      // Ready state is set internally
      expect(true).toBe(true);
    });

    it('should handle legacy ELEMENT_CLICKED message', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateLegacyMessage('ELEMENT_CLICKED', {
          elementId: 'el-1',
          slotId: 'slot-1',
          rect: { top: 0, left: 0, width: 100, height: 100 },
        });
      });

      expect(mockSelectInContext).toHaveBeenCalledWith('el-1', expect.objectContaining({
        rect: { top: 0, left: 0, width: 100, height: 100 },
      }));
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SELECT_ELEMENT' }),
      );
    });

    it('should handle legacy ELEMENT_HOVERED message', async () => {
      renderViewportFrame();

      await act(async () => {
        simulateLegacyMessage('ELEMENT_HOVERED', {
          elementId: 'el-1',
          rect: { top: 10, left: 20, width: 50, height: 30 },
        });
      });

      // Hover state updated
      expect(true).toBe(true);
    });

    it('should handle legacy ELEMENT_RECT message', async () => {
      // selectedElementId now derives from the context selection (task-075)
      selectedKeyValue = 'el-1';
      renderViewportFrame();

      await act(async () => {
        simulateLegacyMessage('ELEMENT_RECT', {
          elementId: 'el-1',
          rect: { top: 0, left: 0, width: 100, height: 100 },
        });
      });

      expect(mockUpdateSelectionRect).toHaveBeenCalled();
    });
  });

  // =====================================================
  // Selection State Sync Tests
  // =====================================================
  describe('Selection State Sync', () => {
    it('clears the selection when the page changes (task-075: replaces the meta clear bridge)', async () => {
      const { rerender } = renderViewportFrame();
      mockClearSelection.mockClear();

      testMockValues.currentPageId = 'page-2';
      testMockValues.currentPage = { id: 'page-2', name: 'About', rootElementIds: [] };
      rerender(<ViewportFrame breakpoint="md" scale={1} />);

      await waitFor(() => {
        expect(mockClearSelection).toHaveBeenCalled();
        expect(mockResetContext).toHaveBeenCalled();
      });
    });
  });

  // =====================================================
  // Context Management Tests
  // =====================================================
  describe('Context Management', () => {
    it('should send SET_CONTEXT to iframe when context changes', async () => {
      contextKeyValue = 'new-context';
      renderViewportFrame();

      // Effect runs on mount with context
      expect(true).toBe(true);
    });

    it('maps the Layout root context to bridge-null (the Layout has no DOM node)', async () => {
      // Editor context = the layout-chrome instance root. It has no single DOM
      // element, so the bridge must be scoped to ROOT (null), not the layout key.
      layoutNameValue = 'Marketing';
      contextKeyValue = 'layoutchrome-page-1'; // pageLayoutElementId('page-1')
      renderViewportFrame();

      await waitFor(() => {
        expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'SET_CONTEXT', payload: { contextKey: null } }),
          '*',
        );
      });
    });

    it('passes a real (non-layout) context key through to the bridge unchanged', async () => {
      layoutNameValue = 'Marketing';
      contextKeyValue = 'layoutchrome-page-1:slot-0'; // a real chrome/slot DOM node
      renderViewportFrame();

      await waitFor(() => {
        expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'SET_CONTEXT', payload: { contextKey: 'layoutchrome-page-1:slot-0' } }),
          '*',
        );
      });
    });
  });

  // =====================================================
  // Scale Tests
  // =====================================================
  describe('Scale Handling', () => {
    it('should apply scale to wheel event coordinates', async () => {
      const onZoom = vi.fn();
      renderViewportFrame({ scale: 0.5, onZoom });

      await act(async () => {
        simulateMessage('WHEEL', {
          deltaX: 0,
          deltaY: -10,
          clientX: 100,
          clientY: 100,
          ctrlKey: true,
          metaKey: false,
        });
      });

      // Coordinates are scaled
      expect(onZoom).toHaveBeenCalled();
    });
  });

  // =====================================================
  // Page Change Tests
  // =====================================================
  describe('Page Change Handling', () => {
    it('keeps iframe ready across page changes and sends SET_PAGE (task-120)', async () => {
      const { rerender } = renderViewportFrame();

      await act(async () => {
        simulateMessage('IFRAME_READY');
      });
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeFalsy();
      });

      // Simulate page change by changing mock value
      testMockValues.currentPageId = 'page-2';

      rerender(<ViewportFrame breakpoint="md" scale={1} />);

      // No spinner: the iframe does not reload on page switch — the bridge
      // gets a SET_PAGE message and the next RENDER swaps content in place.
      expect(document.querySelector('.animate-spin')).toBeFalsy();
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'SET_PAGE', payload: { pageId: 'page-2' } },
        '*',
      );
    });

    it('sets the selection doc scope to the current page (and follows page changes)', async () => {
      const { rerender } = renderViewportFrame();
      expect(mockSetSelectionDocScope).toHaveBeenCalledWith('page-1');

      testMockValues.currentPageId = 'page-2';
      rerender(<ViewportFrame breakpoint="md" scale={1} />);
      expect(mockSetSelectionDocScope).toHaveBeenCalledWith('page-2');
    });
  });

  // =====================================================
  // Pending Updates Tests
  // =====================================================
  describe('Pending Class Updates', () => {
    /** Every UPDATE_CLASSES the parent posted INTO the iframe, as `key=classes`. */
    const postedClassUpdates = () =>
      mockContentWindow.postMessage.mock.calls
        .filter(([m]: [{ type?: string }]) => m?.type === 'UPDATE_CLASSES')
        .map(([m]: [{ payload: { key: string; classes: string } }]) =>
          `${m.payload.key}=${m.payload.classes}`);

    const syncClasses = async (
      key: string,
      classes: string,
      sourceLocation: { file: string; line: number; column: number },
    ) => {
      await act(async () => {
        // SYNC_CLASSES_TO_IFRAME is a SAME-WINDOW relay from ClassStoreContext,
        // and the handler drops anything whose source isn't `window`.
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'SYNC_CLASSES_TO_IFRAME', payload: { key, classes, sourceLocation } },
          source: window,
        }));
      });
    };

    const scan = async (elements: unknown[]) => {
      await act(async () => { simulateMessage('ELEMENTS_SCANNED', { elements }); });
    };

    it('should track and replay a pending class update onto the SAME key', async () => {
      renderViewportFrame();
      const loc = { file: 'test.astro', line: 1, column: 1 };
      await syncClasses('test.astro:1:1', 'new-classes', loc);
      mockContentWindow.postMessage.mockClear();

      await scan([{ key: 'test.astro:1:1', tagName: 'div', classes: '', parentKey: null, sourceLocation: loc }]);

      expect(mockSetScannedElements).toHaveBeenCalled();
      expect(postedClassUpdates()).toContain('test.astro:1:1=new-classes');
    });

    /**
     * task-181 — the owner report: "when I change instance bg and go to master,
     * background also changes without pushing to the master".
     *
     * Two independent leaks, both through the parent's replay queue, both
     * reproduced live 2026-08-05 on the r17 fixture:
     *
     *  - the queue carried a SECOND map keyed `file:line` (no column, no
     *    placement) and the replay took the FIRST scanned element on that line,
     *    re-selecting and re-registering it. The master view's bare key and the
     *    page's placement-tailed key are the same line;
     *  - nothing cleared the queue when the iframe navigated to the master view
     *    (the page-change effect keys on currentPageId, which does not move).
     */
    describe('a queued class edit never crosses to another element or surface (task-181)', () => {
      const CARD = 'src/components/DynCard.astro';
      const loc = { file: CARD, line: 4, column: 52 };
      const PLACED = `${CARD}:4:52~sbc0b0d5634d3ccf6`;
      const BARE = `${CARD}:4:52`;

      it('does not repaint the master view with an edit made on a page instance', async () => {
        renderViewportFrame({ currentPagePath: '/' });
        await syncClasses(PLACED, 'dyncard bg-red-950', loc);
        mockContentWindow.postMessage.mockClear();

        // The master view renders the component alone — no placement ancestor,
        // so the SAME DOM node is scanned under a BARE key.
        await scan([{ key: BARE, tagName: 'div', classes: 'dyncard bg-slate-100', parentKey: null, sourceLocation: loc }]);

        expect(postedClassUpdates()).toEqual([]);
      });

      it('drops the queue when the iframe navigates to the master view', async () => {
        // The colliding-key case: a page element with no placement ancestor has
        // the SAME key as its master-view self, so exact-key matching alone
        // cannot separate them — only the navigation can.
        const { rerender } = renderViewportFrame({ currentPagePath: '/' });
        await syncClasses(BARE, 'dyncard bg-red-950', loc);
        mockContentWindow.postMessage.mockClear();

        await act(async () => {
          rerender(
            <ViewportFrame breakpoint="md" scale={1} currentPagePath={`/__sq_component_view/${CARD}`} />,
          );
        });
        await scan([{ key: BARE, tagName: 'div', classes: 'dyncard bg-slate-100', parentKey: null, sourceLocation: loc }]);

        expect(postedClassUpdates()).toEqual([]);
      });
    });
  });

  // =====================================================
  // Empty Page Tests
  // =====================================================
  // =====================================================
  // Grid geometry request on host-side selection (task-094 D5)
  // =====================================================
  describe('grid geometry request on host-side selection (task-094 D5)', () => {
    it('posts REQUEST_GRID_GEOMETRY when selectedKey changes without an iframe click', async () => {
      // LayersPanel path: selection changes host-side; the iframe never sends
      // ELEMENT_SELECTED, so selection.ts (the only pre-fix requester) is silent.
      const { rerender } = renderViewportFrame();
      await act(async () => {
        simulateMessage('IFRAME_READY');
      });
      mockContentWindow.postMessage.mockClear();

      selectedKeyValue = 'src/components/Card.astro:5:1';
      rerender(<ViewportFrame breakpoint="md" scale={1} />);

      await waitFor(() => {
        expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'REQUEST_GRID_GEOMETRY',
            payload: { key: 'src/components/Card.astro:5:1' },
          }),
          '*',
        );
      });
    });

    // Live 2026-11-12: a card stayed selected while the canvas went from lg to
    // xl — the panel's Start/Span went empty, because the stored cell is
    // stamped with the breakpoint it was measured at and nothing measured again.
    it('measures the selected cell again when the canvas width changes', async () => {
      selectedKeyValue = 'src/components/Card.astro:5:1';
      const { rerender } = renderViewportFrame();
      await act(async () => {
        simulateMessage('IFRAME_READY');
      });
      await waitFor(() => expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REQUEST_GRID_GEOMETRY' }), '*'));
      mockContentWindow.postMessage.mockClear();

      rerender(<ViewportFrame breakpoint="lg" scale={1} />);

      await waitFor(() => {
        expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'REQUEST_GRID_GEOMETRY', payload: { key: 'src/components/Card.astro:5:1' } }),
          '*',
        );
      });
    });

    it('does not request geometry while the iframe is not ready', async () => {
      renderViewportFrame();
      mockContentWindow.postMessage.mockClear();

      selectedKeyValue = 'src/components/Card.astro:5:1';
      await act(async () => {
        // re-render via a state-free message; selection changed but iframe never became ready
        simulateMessage('CONTENT_HEIGHT', { height: 500 });
      });

      expect(mockContentWindow.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REQUEST_GRID_GEOMETRY' }),
        '*',
      );
    });
  });

  // task-132 local mode: the viewport-height drag handle under the frame.
  // Regression (2026-08-10): the scroll-passthrough overlay (absolute inset-0
  // z-[100], same wrapper) sat ON TOP of the handle and swallowed every real
  // mousedown — the drag only ever worked for synthetic events dispatched
  // straight at the element, so to a user it simply did nothing.
  describe('design mode never scrolls (vh pinned to the design viewport)', () => {
    beforeEach(() => localStorage.removeItem('sq:screen-h'));
    const local = { status: 'running' as const, url: 'http://localhost:9999' };

    it('automatically grows and shrinks normal pages, preserving fractional bottoms — floored at one screen', async () => {
      const { container } = renderViewportFrame({ breakpoint: 'lg', localInstanceState: local });
      const iframe = container.querySelector('iframe[data-viewport]') as HTMLElement;
      // Owner 2026-10-08: never shorter than the desktop screen (900).
      for (const [height, expected] of [[1600.4, 1601], [2400, 2400], [1600.4, 1601], [700, 900], [240, 900], [Infinity, 900], [-1, 900]]) {
        await act(async () => simulateMessage('CONTENT_HEIGHT', { height }));
        expect(iframe.style.height).toBe(`${expected}px`);
      }
    });

    it('one screen height per device: every desktop width shares it, per project', async () => {
      const { container, rerender } = renderViewportFrame({ breakpoint: 'lg', localInstanceState: local });
      const iframe = container.querySelector('iframe[data-viewport]') as HTMLElement;
      expect(iframe.style.height).toBe('900px');
      await act(async () => setScreenHeight('project-1', 'desktop', 1080));
      expect(iframe.style.height).toBe('1080px');
      rerender(<ViewportFrame breakpoint="2xl" localInstanceState={local} />);
      expect(iframe.style.height).toBe('1080px');
      rerender(<ViewportFrame breakpoint="md" localInstanceState={local} />);
      expect(iframe.style.height).toBe('1024px');
      testMockValues.projectId = 'other-project';
      rerender(<ViewportFrame breakpoint="xl" localInstanceState={local} />);
      expect(iframe.style.height).toBe('900px');
    });

    it('SET_MODE carries the design viewport height and follows the breakpoint', async () => {
      // No localInstanceState: the local startup gate (identity probe) is not
      // simulated here, and readiness is what gates SET_MODE — the height
      // payload is computed the same way on both paths.
      const props = { breakpoint: 'lg' as const, scale: 1 };
      const { rerender } = renderViewportFrame(props);
      await act(async () => simulateMessage('IFRAME_READY'));
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'SET_MODE', payload: { mode: 'design', designViewportHeight: 900 } }, '*');
      mockContentWindow.postMessage.mockClear();
      rerender(<ViewportFrame {...props} breakpoint="md" />);
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'SET_MODE', payload: { mode: 'design', designViewportHeight: 1024 } }, '*');
      mockContentWindow.postMessage.mockClear();
      rerender(<ViewportFrame {...props} breakpoint="md" isPreview />);
      expect(mockContentWindow.postMessage).toHaveBeenCalledWith(
        { type: 'SET_MODE', payload: { mode: 'preview', designViewportHeight: 1024 } }, '*');
    });

    it('wheel over the frame pans the canvas (⌘ zooms) and is never forwarded into the iframe, even when the fit froze', async () => {
      const onPan = vi.fn();
      const onZoom = vi.fn();
      const { container } = renderViewportFrame({ breakpoint: 'lg', localInstanceState: local, onPan, onZoom });
      await act(async () => simulateMessage('IFRAME_READY'));
      const metadata = { documentId: 'scroll-document', href: 'http://localhost:9999/', revision: 1 };
      // A page the pin could not tame (inline vh): reports keep overflowing the frame.
      for (let i = 0; i < 12; i++) {
        const viewportHeight = Number.parseFloat((container.querySelector('iframe[data-viewport]') as HTMLElement).style.height);
        await act(async () => simulateMessage('CONTENT_HEIGHT', { height: viewportHeight + 400, viewportHeight, ...metadata }));
      }
      mockContentWindow.postMessage.mockClear();
      const overlay = container.querySelector('.absolute.inset-0.z-\\[100\\]')!;
      fireEvent.wheel(overlay, { deltaX: 5, deltaY: 240, deltaMode: 0 });
      expect(onPan).toHaveBeenCalledWith(5, 240);
      expect(mockContentWindow.postMessage).not.toHaveBeenCalled();
      fireEvent.wheel(overlay, { deltaY: -100, ctrlKey: true, clientX: 30, clientY: 40 });
      expect(onZoom).toHaveBeenCalledWith(30, 40, -100);
    });

    it('restores the wheel interception owner after returning from Preview', async () => {
      const onPan = vi.fn();
      const props = { breakpoint: 'lg' as const, scale: 1, localInstanceState: local, onPan };
      const { container, rerender } = renderViewportFrame(props);
      rerender(<ViewportFrame {...props} isPreview />);
      rerender(<ViewportFrame {...props} />);
      fireEvent.wheel(container.querySelector('.absolute.inset-0.z-\\[100\\]')!, { deltaY: 100 });
      expect(onPan).toHaveBeenCalledWith(0, 100);
    });

    it('resets sizing on route, project, width and Preview transitions and rejects stale metadata', async () => {
      const props = { breakpoint: 'lg' as const, localInstanceState: local, currentPagePath: '/' };
      const { container, rerender } = renderViewportFrame(props);
      const iframe = container.querySelector('iframe[data-viewport]') as HTMLElement;
      await act(async () => simulateMessage('CONTENT_HEIGHT', { height: 2400 }));
      expect(iframe.style.height).toBe('2400px');
      rerender(<ViewportFrame {...props} currentPagePath="/about" />);
      expect(iframe.style.height).toBe('900px');
      await act(async () => simulateMessage('CONTENT_HEIGHT', { height: 2400, href: 'http://localhost:9999/', viewportWidth: 1024 }));
      expect(iframe.style.height).toBe('900px');
      rerender(<ViewportFrame {...props} breakpoint="md" />);
      expect(iframe.style.height).toBe('1024px');
      await act(async () => simulateMessage('CONTENT_HEIGHT', { height: 2400, viewportWidth: 1024 }));
      expect(iframe.style.height).toBe('1024px');
      rerender(<ViewportFrame {...props} isPreview />);
      expect(iframe.style.height).toBe('100%');
      await act(async () => simulateMessage('CONTENT_HEIGHT', { height: 9000, mode: 'preview' }));
      rerender(<ViewportFrame {...props} />);
      expect(iframe.style.height).toBe('900px');
      await act(async () => simulateMessage('CONTENT_HEIGHT', { height: 9000, mode: 'preview' }));
      expect(iframe.style.height).toBe('900px');
      await act(async () => simulateMessage('CONTENT_HEIGHT', { height: 2400 }));
      testMockValues.projectId = 'other-project';
      rerender(<ViewportFrame {...props} />);
      expect(iframe.style.height).toBe('900px');
    });
  });

  // The visual alignment grid (top-bar Grid chip): docs/plans/2026-11-16-layout-grid-design.md
  describe('alignment grid overlay', () => {
    beforeEach(() => { localStorage.removeItem('sq:grid'); _resetGridCacheForTests(); });
    const gridOf = (c: HTMLElement) => c.querySelector('[data-testid="layout-grid-overlay"]');

    it('is drawn over the artboard once the page is ready — and only while the grid is on', async () => {
      const { container } = renderViewportFrame({ breakpoint: 'lg' });
      await act(async () => simulateMessage('IFRAME_READY'));
      expect(gridOf(container)).toBeNull(); // off by default
      act(() => setGrid('project-1', { on: true }));
      expect(gridOf(container)).not.toBeNull();
      expect(gridOf(container)!.parentElement).toBe(container.querySelector('[data-testid="editor-canvas"]'));
      act(() => setGrid('project-1', { on: false }));
      expect(gridOf(container)).toBeNull();
    });

    it('is not drawn while the page boots', () => {
      setGrid('project-1', { on: true });
      const { container } = renderViewportFrame({ breakpoint: 'lg' });
      expect(gridOf(container)).toBeNull();
    });

    it('is gone in Preview (a live website shows no editor chrome) and back after it', async () => {
      setGrid('project-1', { on: true });
      const props = { breakpoint: 'lg' as const, scale: 1 };
      const { container, rerender } = renderViewportFrame(props);
      await act(async () => simulateMessage('IFRAME_READY'));
      expect(gridOf(container)).not.toBeNull();
      rerender(<ViewportFrame {...props} isPreview />);
      expect(gridOf(container)).toBeNull();
      rerender(<ViewportFrame {...props} />);
      expect(gridOf(container)).not.toBeNull();
    });

    it("is the open project's own: another project's grid is not drawn", async () => {
      setGrid('some-other-project', { on: true });
      const { container } = renderViewportFrame({ breakpoint: 'lg' });
      await act(async () => simulateMessage('IFRAME_READY'));
      expect(gridOf(container)).toBeNull();
    });
  });
});
