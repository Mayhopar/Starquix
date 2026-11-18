/**
 * Fake ViewportMessageContext factory for handler unit tests.
 * Plain `{ current }` refs + vi.fn() actions — no React rendering, no iframe.
 * Override per-test via the partial groups.
 */
import { vi } from 'vitest';
import * as Y from 'yjs';
import type { ViewportMessageContext } from '../context';

function ref<T>(value: T): { current: T } {
  return { current: value };
}

export interface FakeCtxOverrides {
  refs?: { [K in keyof ViewportMessageContext['refs']]?: ViewportMessageContext['refs'][K] };
  actions?: Partial<Record<keyof ViewportMessageContext['actions'], unknown>>;
  env?: Partial<ViewportMessageContext['env']>;
}

export function makeFakeCtx(overrides: FakeCtxOverrides = {}): ViewportMessageContext {
  const ctx = {
    refs: {
      iframe: ref<HTMLIFrameElement | null>(null),
      isReady: ref(false),
      selectedKey: ref<string | null>(null),
      scannedElements: ref<never[]>([]),
      selectedElementId: ref<string | null>(null),
      contextKey: ref<string | null>(null),
      isEditingText: ref(false),
      onZoom: ref(undefined),
      onPan: ref(undefined),
      scaleProps: ref(1),
      selectInContext: ref(vi.fn()),
      toggleInSelection: ref(vi.fn(() => 'select')),
      registerElement: ref(vi.fn()),
      enterContext: ref(vi.fn()),
      exitContext: ref(vi.fn()),
      resetContext: ref(vi.fn()),
      currentPageId: ref<string | null>(null),
      layoutRootKey: ref<string | null>(null),
      breakpoint: ref('base'),
      aiContextMode: ref(false),
      aiHighlightKey: ref<string | null>(null),
      gridGeometry: ref(null),
      highlightedGridCell: ref(null),
      dragMode: ref<'grid' | 'reparent' | null>(null),
      pendingGridRefreshKey: ref<string | null>(null),
      pendingSelect: ref<string | null>(null),
      pendingKeyUpdates: ref(new Map()),
      isLinkInteracting: ref(false),
      ...overrides.refs,
    },
    actions: {
      dispatch: vi.fn(() => true),
      updateSelectionRect: vi.fn(),
      setHoveredRect: vi.fn(),
      setGridGeometry: vi.fn(),
      setHighlightedGridCell: vi.fn(),
      setIsGridOverlayVisible: vi.fn(),
      setReparentDragKey: vi.fn(),
      setContentHeight: vi.fn(),
      setSourceError: vi.fn(),
      setIsIframeReady: vi.fn(),
      iframeReloaded: vi.fn(),
      setScannedElements: vi.fn(),
      updateScannedElementRects: vi.fn(),
      setTextSelection: vi.fn(),
      clearTextSelection: vi.fn(),
      exitEditMode: vi.fn(),
      sendEnterEditMode: vi.fn(),
      takeSnapshot: vi.fn(),
      pushStructuralUndo: vi.fn(),
      getClassesFromYjs: vi.fn(() => ''),
      clearSelection: vi.fn(),
      updateBgImagePreview: vi.fn(),
      updateImagePreview: vi.fn(),
      setSelectedPosition: vi.fn(),
      persistGridClasses: vi.fn(),
      syncClassToIframe: vi.fn(),
      refreshGridState: vi.fn(),
      setActivePage: vi.fn(),
      goToPost: vi.fn(),
      ...overrides.actions,
    },
    env: {
      doc: new Y.Doc(),
      webContainerState: undefined,
      projectId: null,
      pages: [],
      isLocalMode: false,
      ...overrides.env,
    },
  };
  return ctx as unknown as ViewportMessageContext;
}

/** A fake iframe ref whose contentWindow.postMessage is a spy. */
export function makeFakeIframe(): {
  iframe: { current: HTMLIFrameElement };
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  const postMessage = vi.fn();
  const focus = vi.fn();
  const iframe = {
    current: {
      focus,
      contentWindow: { postMessage },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    } as unknown as HTMLIFrameElement,
  };
  return { iframe, postMessage, focus };
}
