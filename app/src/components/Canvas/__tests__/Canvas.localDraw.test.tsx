/**
 * task-133 Task 7: Canvas.handleElementCreated wiring.
 *
 * - WC (default) mode: a draw still dispatches ADD_DRAWN_ELEMENT (regression
 *   pin — the local branch must not change the free tier).
 * - Local mode (localInstance prop set): the draw routes to
 *   insertLocalDrawnElement with the page file — NO doc dispatch, NO snapshot
 *   (files-truth: drawn elements never enter the doc).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { Canvas } from '../Canvas';
import type { LocalInstanceResult } from '@/hooks/useLocalInstance';

const PAGE_ID = 'page-1';
const PAGE_FILE = 'src/pages/index.astro';

const h = vi.hoisted(() => ({
  onElementCreated: null as null | ((r: unknown) => Promise<void> | void),
  dispatch: vi.fn(),
  takeSnapshot: vi.fn(),
  insertLocal: vi.fn(async () => ({ ok: true }) as { ok: boolean }),
}));

// ==============================================================
// Child component stubs (same harness as Canvas.emptyPageDraw.test.tsx);
// DrawOverlay is the capture point for handleElementCreated.
// ==============================================================
vi.mock('../ViewportFrame', () => ({
  ViewportFrame: () => <div data-testid="viewport-frame" />,
}));
vi.mock('../DrawOverlay', () => ({
  DrawOverlay: (props: { onElementCreated: (r: unknown) => void }) => {
    h.onElementCreated = props.onElementCreated;
    return null;
  },
}));
vi.mock('../PenOverlay', () => ({ PenOverlay: () => null }));
vi.mock('../BreakpointBar', () => ({ BreakpointBar: () => null }));
vi.mock('../DragGutter', () => ({ DragGutter: () => null }));
vi.mock('../DropIndicator', () => ({ DropIndicator: () => null }));
vi.mock('../PreviewHealthBanner', () => ({ PreviewHealthBanner: () => null }));
vi.mock('../ZoomChip', () => ({ ZoomChip: () => null }));
vi.mock('@/components/PostEditor/PostEditor', () => ({ PostEditor: () => null }));
vi.mock('@/components/VariablesEditor/VariablesEditor', () => ({ VariablesEditor: () => null }));
vi.mock('../localDrawInsert', () => ({
  insertLocalDrawnElement: h.insertLocal,
}));

// ==============================================================
// Context/hook mocks
// ==============================================================
vi.mock('@/store/hooks', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    useDispatch: () => h.dispatch,
    useYjsValue: (sel: (d: unknown) => unknown) => {
      if (sel === mockedSelectors.selectCurrentBreakpoint) return 'lg';
      if (sel === mockedSelectors.selectCurrentPageId) return PAGE_ID;
      return sel(doc);
    },
  };
});
import * as mockedSelectors from '@/store/selectors';
vi.mock('@/context', () => ({
  useDropIndicator: () => ({ dropIndicator: { isVisible: false, top: 0 } }),
  useSelectionContext: () => ({ clearSelection: vi.fn(), select: vi.fn() }),
  useTool: () => ({ activeTool: 'frame' }),
}));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: h.takeSnapshot }),
}));
vi.mock('@/context/VariablesContext', () => ({
  useVariables: () => ({ activeCollectionId: null }),
}));
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ editingPost: null, closePost: vi.fn() }),
}));
vi.mock('@/context/SidebarTabContext', () => ({
  useSidebarTab: () => ({ activeTopTab: 'pages', setActiveTopTab: vi.fn() }),
}));
vi.mock('@/hooks/useContentCollections', () => ({
  useContentCollections: () => ({ collections: [], refresh: vi.fn() }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [] }),
}));
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [] }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const runningInstance = { status: 'running', url: 'http://instance.test' } as unknown as LocalInstanceResult;
const runningLocal = {
  status: 'running',
  url: 'http://localhost:43210',
  error: null,
  retry: vi.fn(),
  pages: [],
  dynamicInstances: [],
} as unknown as LocalInstanceResult;

const drawResult = {
  tag: 'div',
  classes: 'w-[120px] h-[80px]',
  textContent: '',
  parentKey: null,
  insertIndex: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.onElementCreated = null;
});

describe('Canvas draw commit wiring', () => {
  it('local mode: routes to insertLocalDrawnElement — no doc dispatch, no snapshot', async () => {
    render(
      <Canvas
        activeDragId={null}
        localInstance={runningLocal}
        currentPageFile={PAGE_FILE}
      />,
    );
    expect(h.onElementCreated).not.toBeNull();

    await act(async () => {
      await h.onElementCreated!(drawResult);
    });

    expect(h.insertLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        draw: drawResult,
        isSlotDraw: false,
        pageFile: PAGE_FILE,
      }),
    );
    expect(h.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADD_DRAWN_ELEMENT' }),
    );
    expect(h.takeSnapshot).not.toHaveBeenCalled();
  });

  // Filmstrip 2026-11-08: the box vanished on mouseup and the element showed
  // ~280 ms later. It now stays until the next source refresh paints it.
  it('local mode: the drawn box stays until the page shows the element', async () => {
    const { SOURCE_REFRESHED_EVENT } = await import('../viewportMessages/sourceStatus');
    const view = render(<Canvas activeDragId={null} localInstance={runningLocal} currentPageFile={PAGE_FILE} />);
    const preview = { left: 10, top: 20, width: 120, height: 80, className: 'border-2' };
    await act(async () => { await h.onElementCreated!({ ...drawResult, preview }); });
    expect(view.getByTestId('draw-landing')).toHaveStyle({ left: '10px', top: '20px', width: '120px', height: '80px' });
    act(() => { window.dispatchEvent(new Event(SOURCE_REFRESHED_EVENT)); });
    expect(view.queryByTestId('draw-landing')).toBeNull();
  });

  it('local mode: a refused draw drops the box at once', async () => {
    h.insertLocal.mockResolvedValueOnce({ ok: false });
    const view = render(<Canvas activeDragId={null} localInstance={runningLocal} currentPageFile={PAGE_FILE} />);
    await act(async () => { await h.onElementCreated!({ ...drawResult, preview: { left: 1, top: 1, width: 5, height: 5, className: '' } }); });
    expect(view.queryByTestId('draw-landing')).toBeNull();
  });
});
