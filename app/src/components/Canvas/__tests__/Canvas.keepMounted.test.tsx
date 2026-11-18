/**
 * Canvas must stay MOUNTED (hidden) when the Content tab / post editor /
 * variables editor is active. Unmounting it destroys the preview iframe, and
 * returning to the File tab cold-reloads the page from the instance's
 * Astro server — a multi-second blank canvas (only drag handles visible).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { Canvas } from '../Canvas';
import { fitView } from '../zoomMath';
import { setLocalComponentViewFile } from '@/services/localComponentView';
import { selectCurrentBreakpoint, selectCurrentPageId } from '@/store/selectors';

// ==============================================================
// Controllable context state
// ==============================================================
const ctxState = {
  activeTopTab: 'pages' as string,
  isPreview: false,
  currentPageId: 'page-1',
  editingPost: null as { collection: string; slug: string } | null,
  activeCollectionId: null as string | null,
};

// ==============================================================
// Child component stubs
// ==============================================================
vi.mock('../ViewportFrame', () => ({
  ViewportFrame: () => <div data-testid="viewport-frame" />,
}));
vi.mock('../DrawOverlay', () => ({ DrawOverlay: () => null }));
vi.mock('../PenOverlay', () => ({ PenOverlay: () => null }));
vi.mock('../BreakpointBar', () => ({
  BreakpointBar: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../DragGutter', () => ({ DragGutter: () => null }));
vi.mock('../DropIndicator', () => ({ DropIndicator: () => null }));
vi.mock('../ZoomChip', () => ({
  ZoomChip: ({ scale, labelRef }: { scale: number; labelRef?: React.Ref<HTMLSpanElement> }) => <span ref={labelRef} data-testid="zoom-chip" data-scale={scale}>{Math.round(scale * 100)}%</span>,
}));
vi.mock('@/components/PostEditor/PostEditor', () => ({
  PostEditor: () => <div data-testid="post-editor" />,
}));
vi.mock('@/components/VariablesEditor/VariablesEditor', () => ({
  VariablesEditor: () => <div data-testid="variables-editor" />,
}));

// ==============================================================
// Context/hook mocks
// ==============================================================
vi.mock('@/store/hooks', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    useDispatch: () => vi.fn(),
    useEditorDoc: () => doc,
    useYjsValue: (sel: unknown) => {
      if (sel === mockedSelectors.selectCurrentBreakpoint) return 'lg';
      if (sel === mockedSelectors.selectCurrentPageId) return ctxState.currentPageId;
      if (sel === mockedSelectors.selectAllPages) return [];
      // isPostPage / pageComponents lambdas — non-empty so the page counts as
      // having elements (empty pages hide the content div by design).
      return [{}];
    },
  };
});
// Indirection so the useYjsValue mock (hoisted) can compare selector identity.
import * as mockedSelectors from '@/store/selectors';
const sel = vi.hoisted(() => ({ clearSelection: vi.fn() }));
vi.mock('@/context', () => ({
  useDropIndicator: () => ({ dropIndicator: { isVisible: false, top: 0 } }),
  useSelectionContext: () => ({ clearSelection: sel.clearSelection, select: vi.fn() }),
  useTool: () => ({ activeTool: null, isPreview: ctxState.isPreview }),
}));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));
vi.mock('@/context/VariablesContext', () => ({
  useVariables: () => ({ activeCollectionId: ctxState.activeCollectionId }),
}));
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ editingPost: ctxState.editingPost, closePost: vi.fn() }),
}));
vi.mock('@/context/SidebarTabContext', () => ({
  useSidebarTab: () => ({ activeTopTab: ctxState.activeTopTab, setActiveTopTab: vi.fn() }),
}));
vi.mock('@/hooks/useContentCollections', () => ({
  useContentCollections: () => ({
    collections: [{ name: 'blog', posts: [{ slug: 'hello', frontmatter: {}, body: '' }] }],
    refresh: vi.fn(),
  }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [] }),
}));
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [] }),
}));

// jsdom has no ResizeObserver; Canvas observes its scroll container.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function renderCanvas(hideSite?: boolean) {
  return render(
    <Canvas activeDragId={null} localInstance={runningLocal} hideSite={hideSite} />,
  );
}

// jsdom applies no stylesheets, so visibility must be asserted via inline style.
function canvasWrapper(): HTMLElement {
  const frame = screen.getByTestId('viewport-frame');
  let el: HTMLElement | null = frame;
  while (el && el.style.visibility !== 'hidden') el = el.parentElement;
  if (!el) throw new Error('no hidden ancestor — canvas is visible');
  return el;
}

const runningLocal = { status: 'running' as const, url: 'http://localhost:4999', error: null, pages: [], dynamicInstances: [], discoveryDone: true, retry: () => {} };

describe('Canvas stays mounted behind overlays', () => {
  beforeEach(() => {
    ctxState.activeTopTab = 'pages';
    ctxState.isPreview = false;
    ctxState.currentPageId = 'page-1';
    ctxState.editingPost = null;
    ctxState.activeCollectionId = null;
  });
  afterEach(() => setLocalComponentViewFile(null));

  it('keeps ViewportFrame mounted (hidden) on the Content tab', () => {
    ctxState.activeTopTab = 'content';
    renderCanvas();
    expect(screen.getByTestId('viewport-frame')).toBeInTheDocument();
    expect(canvasWrapper()).toBeTruthy(); // hidden, not unmounted
    expect(screen.getByText('Select a post to edit')).toBeInTheDocument();
  });

  it('keeps ViewportFrame mounted (hidden) while a post is being edited', () => {
    ctxState.activeTopTab = 'content';
    ctxState.editingPost = { collection: 'blog', slug: 'hello' };
    renderCanvas();
    expect(screen.getByTestId('viewport-frame')).toBeInTheDocument();
    expect(canvasWrapper()).toBeTruthy();
    expect(screen.getByTestId('post-editor')).toBeInTheDocument();
  });

  it('keeps ViewportFrame mounted (hidden) while the variables editor is open', () => {
    ctxState.activeCollectionId = 'col-1';
    renderCanvas();
    expect(screen.getByTestId('viewport-frame')).toBeInTheDocument();
    expect(canvasWrapper()).toBeTruthy();
    expect(screen.getByTestId('variables-editor')).toBeInTheDocument();
  });

  it('rescues a fully off-screen frame when the overlay closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    // Frame far above the visible canvas (user panned away while on Assets).
    const iframeRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 500, right: 640, top: -5000, bottom: -4000, width: 140, height: 1000,
        }),
      } as unknown as HTMLIFrameElement,
    };
    ctxState.activeTopTab = 'content';
    const { container, rerender } = render(
      <Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />,
    );
    const scroll = container.querySelector('[data-scroll-container]') as HTMLElement;
    scroll.getBoundingClientRect = () =>
      ({ left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800 }) as DOMRect;

    // Flush the mount-time element-count rescue (0→1) so it can't mask the
    // overlay-close rescue this test is about.
    act(() => {
      vi.advanceTimersByTime(700);
    });

    // Drift the view through the real zoom path so scale ≠ 1.
    act(() => {
      window.dispatchEvent(new CustomEvent('sq:zoom-command', { detail: { action: 'out' } }));
      vi.advanceTimersByTime(500); // rAF transform + 150ms state flush
    });
    expect(Number(screen.getByTestId('zoom-chip').dataset.scale)).not.toBe(1);

    // Close the overlay — the rescue must notice the frame is off-screen.
    ctxState.activeTopTab = 'pages';
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} iframeRef={iframeRef} />);
    act(() => {
      vi.advanceTimersByTime(700); // rescue check runs after 600ms
    });
    expect(Number(screen.getByTestId('zoom-chip').dataset.scale)).toBe(1);
    vi.useRealTimers();
  });

  // Owner 2026-11-17: the Assets tab is the component editor — people
  // dropped components into the site showing behind it.
  it('hides the site on an empty Assets tab', () => {
    ctxState.activeTopTab = 'assets';
    renderCanvas(true);
    expect(screen.getByTestId('viewport-frame')).toBeInTheDocument();
    expect(canvasWrapper()).toBeTruthy();
    expect(screen.getByText('Select a component to edit')).toBeInTheDocument();
  });

  it('keeps the site covered, without words, while a component is opening', () => {
    ctxState.activeTopTab = 'assets';
    setLocalComponentViewFile('src/components/Hero.astro'); // switch started, frame still on the page
    renderCanvas(true);
    expect(canvasWrapper()).toBeTruthy();
    expect(screen.queryByText('Select a component to edit')).toBeNull();
  });

  it('shows the open component on the Assets tab (no overlay)', () => {
    ctxState.activeTopTab = 'assets';
    renderCanvas(false);
    expect(screen.queryByText('Select a component to edit')).toBeNull();
    expect(() => canvasWrapper()).toThrow(); // visible
  });

  it('shows the canvas normally on the pages tab (no overlay, not hidden)', () => {
    renderCanvas();
    const frame = screen.getByTestId('viewport-frame');
    expect(frame).toBeInTheDocument();
    let el: HTMLElement | null = frame;
    while (el) {
      expect(el.style.visibility).not.toBe('hidden');
      el = el.parentElement;
    }
    expect(screen.queryByText('Select a post to edit')).toBeNull();
  });
});


describe('Canvas Preview view restoration', () => {
  beforeEach(() => {
    ctxState.activeTopTab = 'pages';
    ctxState.editingPost = null;
    ctxState.activeCollectionId = null;
    ctxState.isPreview = false;
    ctxState.currentPageId = 'page-1';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => vi.useRealTimers());

  function zoomedCanvas() {
    const rendered = renderCanvas();
    const scroll = rendered.container.querySelector('[data-scroll-container]') as HTMLElement;
    Object.defineProperties(scroll, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
    act(() => {
      window.dispatchEvent(new CustomEvent('sq:zoom-command', { detail: { action: 'out' } }));
      vi.advanceTimersByTime(300);
    });
    return { ...rendered, content: rendered.container.querySelector('#canvas-content') as HTMLElement };
  }

  it('restores the same zoom, pan and label after same-page Preview', () => {
    const { rerender, content } = zoomedCanvas();
    const previousTransform = content.style.transform;
    const previousLabel = screen.getByTestId('zoom-chip').textContent;
    expect(previousTransform).not.toBe('translate(0px, 0px) scale(1)');
    expect(previousLabel).not.toBe('100%');

    ctxState.isPreview = true;
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} />);
    act(() => vi.advanceTimersByTime(700));
    expect(content.style.transform).toBe('none');

    ctxState.isPreview = false;
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} />);
    act(() => vi.advanceTimersByTime(700));
    expect(content.style.transform).toBe(previousTransform);
    expect(screen.getByTestId('zoom-chip')).toHaveTextContent(previousLabel!);
  });

  it.each([false, true])('still resets on a real page change (Preview=%s)', (preview) => {
    const { rerender, content } = zoomedCanvas();
    ctxState.isPreview = preview;
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} />);
    ctxState.currentPageId = 'page-2';
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} />);
    act(() => vi.advanceTimersByTime(700));
    // Design mode resets to the FIT of the lg artboard in the 1000×800 canvas
    // (no iframe here → width-only fit), never the zoomed-out gesture value.
    const fit = fitView({ canvasWidth: 1000, canvasHeight: 800, viewportWidth: 1024, frameHeight: 0 });
    const fitTransform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
    expect(content.style.transform).toBe(preview ? 'none' : fitTransform);
    expect(screen.getByTestId('zoom-chip')).toHaveTextContent(`${Math.round(fit.scale * 100)}%`);
    ctxState.isPreview = false;
    rerender(<Canvas activeDragId={null} localInstance={runningLocal} />);
    expect(content.style.transform).toBe(fitTransform);
  });
});

it('runtime error has one curated recovery owner without a viewport, spinner or duplicate banner', () => {
  const { container, rerender } = render(<Canvas activeDragId={null} localInstance={{ ...runningLocal, status: 'error', error: 'private runtime token' }} runtimeFailureKind="unsupported" />);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert')).not.toHaveTextContent(/private runtime token/);
  expect(screen.queryByRole('button', { name: 'Restart preview' })).toBeNull();
  expect(screen.queryByTestId('viewport-frame')).toBeNull();
  expect(container.querySelector('.animate-spin')).toBeNull();
  rerender(<Canvas activeDragId={null} localInstance={{ ...runningLocal, status: 'starting', error: null }} bootStatusMessage="private npm path" />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(container.querySelectorAll('.animate-spin')).toHaveLength(1);
  expect(container).not.toHaveTextContent(/private npm path/);
  rerender(<Canvas activeDragId={null} localInstance={runningLocal} />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('viewport-frame')).toBeInTheDocument();
});

describe('background click (ledger A8)', () => {
  beforeEach(() => {
    sel.clearSelection.mockClear();
    ctxState.activeTopTab = 'pages';
    ctxState.isPreview = false;
    ctxState.currentPageId = 'page-1';
    ctxState.editingPost = null;
    ctxState.activeCollectionId = null;
  });
  it('a plain click on empty canvas clears the selection', () => {
    const { container } = renderCanvas();
    fireEvent.click(container.querySelector('#canvas-content')!);
    expect(sel.clearSelection).toHaveBeenCalledTimes(1);
  });
  it('Shift+click on empty canvas keeps it', () => {
    const { container } = renderCanvas();
    fireEvent.click(container.querySelector('#canvas-content')!, { shiftKey: true });
    expect(sel.clearSelection).not.toHaveBeenCalled();
  });
});
