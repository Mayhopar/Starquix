/**
 * Design mode never scrolls (wheel = pan), so the artboard must show its full
 * WIDTH without the user zooming: a 1280-wide xl artboard in a 900px canvas
 * used to sit at 100% under both sidebars (owner, 2026-09-10: "our scale of
 * the app is huge"). The view reset now width-fits the artboard, top-aligned,
 * never above 100% — on page switch and breakpoint switch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { Canvas } from '../Canvas';
import { fitView } from '../zoomMath';
import type { LocalInstanceResult } from '@/hooks/useLocalInstance';

const ctxState = { breakpoint: 'xl' as string, currentPageId: 'page-1', isPreview: false };

vi.mock('../ViewportFrame', () => ({ ViewportFrame: () => <div data-testid="viewport-frame" /> }));
vi.mock('../DrawOverlay', () => ({ DrawOverlay: () => null }));
vi.mock('../PenOverlay', () => ({ PenOverlay: () => null }));
vi.mock('../BreakpointBar', () => ({ BreakpointBar: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock('../DragGutter', () => ({ DragGutter: () => null }));
vi.mock('../DropIndicator', () => ({ DropIndicator: () => null }));
vi.mock('../ZoomChip', () => ({
  ZoomChip: ({ scale, labelRef }: { scale: number; labelRef?: React.Ref<HTMLSpanElement> }) => <span ref={labelRef} data-testid="zoom-chip" data-scale={scale} />,
}));
vi.mock('@/components/PostEditor/PostEditor', () => ({ PostEditor: () => null }));
vi.mock('@/components/VariablesEditor/VariablesEditor', () => ({ VariablesEditor: () => null }));
vi.mock('@/store/hooks', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    useDispatch: () => vi.fn(),
    useEditorDoc: () => doc,
    useYjsValue: (sel: unknown) => {
      if (sel === mockedSelectors.selectCurrentBreakpoint) return ctxState.breakpoint;
      if (sel === mockedSelectors.selectCurrentPageId) return ctxState.currentPageId;
      if (sel === mockedSelectors.selectAllPages) return [];
      return [{}];
    },
  };
});
import * as mockedSelectors from '@/store/selectors';
vi.mock('@/context', () => ({
  useDropIndicator: () => ({ dropIndicator: { isVisible: false, top: 0 } }),
  useSelectionContext: () => ({ clearSelection: vi.fn(), select: vi.fn() }),
  useTool: () => ({ activeTool: null, isPreview: ctxState.isPreview }),
}));
vi.mock('@/context/SelectionContext', () => ({ useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }) }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ activeCollectionId: null }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ editingPost: null, closePost: vi.fn() }) }));
vi.mock('@/context/SidebarTabContext', () => ({ useSidebarTab: () => ({ activeTopTab: 'pages', setActiveTopTab: vi.fn() }) }));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [], refresh: vi.fn() }) }));
vi.mock('@/hooks/useLayoutLibrary', () => ({ useLayoutLibrary: () => ({ layouts: [] }) }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ builtIn: [], userProject: [] }) }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const runningLocal = { status: 'running' as const, url: 'http://localhost:4999', error: null, pages: [], dynamicInstances: [], discoveryDone: true } as unknown as LocalInstanceResult;
const CANVAS = { width: 900, height: 650 };
const FRAME_H = 1024;

// jsdom lays nothing out: give the scroll container a size and the frame a height.
function sizedCanvas(container: HTMLElement) {
  const el = container.querySelector('[data-scroll-container]') as HTMLElement;
  Object.defineProperty(el, 'clientWidth', { value: CANVAS.width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: CANVAS.height, configurable: true });
  return el;
}
const iframeRef = { current: { getBoundingClientRect: () => ({ left: 0, right: 1024, top: 0, bottom: FRAME_H, width: 1024, height: FRAME_H }) } as unknown as HTMLIFrameElement };
const scaleShown = () => Number(screen.getByTestId('zoom-chip').dataset.scale);

beforeEach(() => { ctxState.breakpoint = 'xl'; ctxState.currentPageId = 'page-1'; ctxState.isPreview = false; });

describe('Canvas auto-fit', () => {
  it('fits the whole artboard into the canvas on page switch (never above 100%)', () => {
    const { container, rerender } = render(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    sizedCanvas(container);
    ctxState.currentPageId = 'page-2';
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    const expected = fitView({ canvasWidth: CANVAS.width, canvasHeight: CANVAS.height, viewportWidth: 1280, frameHeight: 0 });
    expect(expected.scale).toBeLessThan(1); // the premise: 1280 wide does not fit a 900px canvas at 1:1
    expect(scaleShown()).toBeCloseTo(expected.scale, 6);
    expect(screen.getByTestId('zoom-chip').textContent).toBe(`${Math.round(expected.scale * 100)}%`);
  });

  it('re-fits when the breakpoint changes', () => {
    const { container, rerender } = render(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    sizedCanvas(container);
    ctxState.breakpoint = 'lg';
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    const expected = fitView({ canvasWidth: CANVAS.width, canvasHeight: CANVAS.height, viewportWidth: 1024, frameHeight: 0 });
    expect(expected.scale).toBeLessThan(1);
    expect(scaleShown()).toBeCloseTo(expected.scale, 6);
  });

  it('stays at 100% when the artboard width already fits (a tall page pans, never shrinks)', () => {
    ctxState.breakpoint = 'sm';
    const { container, rerender } = render(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    sizedCanvas(container);
    ctxState.currentPageId = 'page-2';
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    expect(scaleShown()).toBe(1);
  });

  it('preview mode applies no transform (native scroll), but the fit is what design mode restores', () => {
    ctxState.isPreview = true;
    const { container, rerender } = render(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    sizedCanvas(container);
    ctxState.currentPageId = 'page-2';
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    const content = container.querySelector('#canvas-content') as HTMLElement;
    expect(content.style.transform).toBe('none');
    ctxState.isPreview = false;
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    const expected = fitView({ canvasWidth: CANVAS.width, canvasHeight: CANVAS.height, viewportWidth: 1280, frameHeight: 0 });
    expect(content.style.transform).toBe(`translate(${expected.x}px, ${expected.y}px) scale(${expected.scale})`);
  });
});
