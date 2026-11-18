/**
 * Finding 29 (adversarial review of the parity waves): a local internal-link
 * click double-navigated. The bridge lets the browser navigate NATIVELY
 * (files-truth), then the PREVIEW_NAVIGATE announce drives setActivePage →
 * currentPagePath → a new buildPreviewSrc string → React re-sets the iframe
 * src attribute → the browser loads the route it is ALREADY on a second time
 * (two document loads, two IFRAME_READY sweeps, two scans per click).
 *
 * The fix: the announce handler records the natively-reached route in
 * localNativeRoute (previewSrc.ts); ViewportFrame's src render skips the
 * attribute re-set while the desired route equals it. Programmatic switches
 * (sidebar) still navigate exactly as before — including the "return to the
 * route the stale attribute still names" corner, which needs an imperative
 * setAttribute because React sees an unchanged string, and the
 * sq:reload-preview corner, which must reload the TRUE route rather than the
 * stale attribute.
 *
 * Mock preamble copied from ViewportFrame.postViewBody.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { ViewportFrame } from '../ViewportFrame';
import { localNativeRoute, localOverridesFragment } from '../previewSrc';
import * as previewReload from '../reloadPreview';
import { setLocalExpectedRoute, setLocalPageFile, isLocalPageInSync } from '@/utils/localPageSync';
const testProjectId = 'browser_lf_p1';

vi.mock('../previewSrc', async importOriginal => ({
  ...await importOriginal<typeof import('../previewSrc')>(),
  localOverridesFragment: vi.fn(() => ''),
}));

// ==============================================================
// Mocks (ViewportFrame.test.tsx pattern)
// ==============================================================

const mockDispatch = vi.fn();
const mockSetActivePage = vi.fn();
let testCurrentPageId = 'index';
const defaultPages = [{ id: 'index', name: '/' }, { id: 'about', name: '/about' }];
let testPages = defaultPages;

const mockDoc = {
  getMap: vi.fn((name: string) => ({
    forEach: vi.fn(),
    observe: vi.fn(),
    unobserve: vi.fn(),
    observeDeep: vi.fn(),
    unobserveDeep: vi.fn(),
    get: vi.fn((key: string) => name === 'meta' && key === 'projectId' ? testProjectId : undefined),
  })),
  transact: vi.fn((fn: () => void) => fn()),
};

vi.mock('@/services/previewServerStatus', () => ({
  previewServer: {
    getState: vi.fn(() => ({ status: 'stopped', url: null })),
    onStateChange: vi.fn(() => () => {}),
  },
}));

vi.mock('@/services/paidInstanceService', () => ({
  startAndAwaitReady: vi.fn(),
  stopInstance: vi.fn(),
}));

vi.mock('@/utils/serverMode', () => ({
  isRealInstanceEnabled: vi.fn(() => false),
}));

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: {
    setIframeRef: vi.fn(),
    setRealInstanceState: vi.fn(),
    setLocalInstanceState: vi.fn(),
    writeClassUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: {
    setIframeRef: vi.fn(),
    setRealInstanceState: vi.fn(),
    setLocalInstanceState: vi.fn(),
    writeTextUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/services/ViteImageWriter', () => ({
  viteImageWriter: {
    setIframeRef: vi.fn(),
    setRealInstanceState: vi.fn(),
    setLocalInstanceState: vi.fn(),
    writeImageUpdate: vi.fn().mockResolvedValue(false),
  },
}));

const stableCollections = { collections: [], isLoading: false, error: null, refresh: vi.fn() };

vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollections: () => [],
}));

vi.mock('@/hooks/useContentCollections', () => ({
  useContentCollections: () => stableCollections,
}));

vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({
    editingPost: null,
    openPost: vi.fn(),
    closePost: vi.fn(),
    previewPost: null,
    setPreviewPost: vi.fn(),
    clearPreviewPost: vi.fn(),
  }),
}));

vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({ pages: testPages, setActivePage: mockSetActivePage }),
}));

vi.mock('@/context/SelectionContext', async (importOriginal) => {
  const { deriveSelectedElementId } =
    await importOriginal<typeof import('@/context/SelectionContext')>();
  return {
    deriveSelectedElementId,
    useScannedElements: () => ({
      scannedElements: [],
      setScannedElements: vi.fn(),
      updateScannedElementRects: vi.fn(),
      scannedByKey: new Map(),
    }),
    useScannedElementsRef: () => ({
      scannedElementsRef: { current: [] },
      scannedByKeyRef: { current: new Map() },
      treeNodesRef: { current: [] },
    }),
    useSelectionContext: () => ({
      additionalSelections: [],
      select: vi.fn(),
      clearSelection: vi.fn(),
      setSelectionDocScope: vi.fn(),
      selectedKey: null,
      selectedElementId: null,
      selectedKeyRef: { current: null },
      selectedElementIdRef: { current: null },
      contextKeyRef: { current: null },
      contextKey: null,
      enterContext: vi.fn(),
      exitContext: vi.fn(),
      resetContext: vi.fn(),
      isEditingText: false,
      enterEditMode: vi.fn(),
      exitEditMode: vi.fn(),
      reparentDragKey: null,
      setReparentDragKey: vi.fn(),
      updateBgImagePreview: vi.fn(),
      updateImagePreview: vi.fn(),
    }),
    useRectActions: () => ({ updateSelectionRect: vi.fn() }),
    useRectHover: () => ({ selectedRect: null, updateSelectionRect: vi.fn() }),
    useTextSelection: () => ({
      setTextSelection: vi.fn(),
      clearTextSelection: vi.fn(),
      isLinkInteractingRef: { current: false },
    }),
  };
});

vi.mock('@/context', () => ({
  useClassStore: () => ({ registerElement: vi.fn() }),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    takeSnapshot: vi.fn(),
    isUndoingRef: { current: false },
    pushStructuralUndo: vi.fn(),
  }),
}));

const stableRenderState = { components: [], childOrders: {}, drawnElements: [] };

vi.mock('@/store/selectors', () => ({
  selectCurrentPage: () => ({ id: 'index', name: '/', rootElementIds: [] }),
  selectCurrentPageId: () => testCurrentPageId,
  selectCurrentThemeMode: () => null,
  selectProjectId: () => testProjectId,
  selectPageRootElements: () => [],
  selectPageComponents: () => [],
  selectRootElementIds: () => [],
  selectRenderState: () => stableRenderState,
  isRenderStateEmpty: () => true,
  selectChildOrders: () => ({}),
  selectPageDrawnElements: () => [],
  selectPageLayout: () => ({ layoutName: null, layoutProps: {} }),
  selectPostPageByCollectionId: () => null,
  selectPostPageRenderData: () => null,
  selectOriginalSourceText: () => null,
}));

vi.mock('@/store/hooks', async () => {
  const { useRef } = await import('react');
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
    useCurrentPageId: () => testCurrentPageId,
    useProjectId: () => testProjectId,
    useCurrentThemeMode: () => null,
    useDispatch: () => mockDispatch,
    useEditorDoc: () => mockDoc,
  };
});

vi.mock('@/store/overrides', () => ({
  getInstanceOverrideAPI: vi.fn(() => ({ setHref: vi.fn() })),
}));

// ==============================================================
// Test utilities
// ==============================================================

const mockContentWindow = { postMessage: vi.fn(), location: { replace: vi.fn() } };
Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
  get() { return mockContentWindow; },
  configurable: true,
});

const LOCAL = { status: 'running' as const, url: 'http://localhost:5001' };

function frame(path: string) {
  return (
    <ViewportFrame
      breakpoint="md"
      scale={1}
      localInstanceState={LOCAL}
      currentPagePath={path}
    />
  );
}

const frameEl = (): HTMLIFrameElement => {
  const el = document.querySelector('iframe[data-viewport]');
  expect(el).not.toBeNull();
  return el as HTMLIFrameElement;
};

function confirmedLoad(href: string) {
  fireEvent.load(frameEl());
  const request = mockContentWindow.postMessage.mock.calls.filter(([m]) => m.type === 'REQUEST_LOCAL_ROUTE').at(-1)![0];
  act(() => window.dispatchEvent(new MessageEvent('message', { source: mockContentWindow as unknown as Window, origin: LOCAL.url, data: { type: 'LOCAL_ROUTE_RESULT', payload: { ...request.payload, href: LOCAL.url + href } } })));
}

describe('ViewportFrame — local src skip after a native link navigation (finding 29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testCurrentPageId = 'index';
    localNativeRoute.current = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
    testCurrentPageId = 'index';
    localNativeRoute.current = null;
  });

  it('does NOT re-set the src attribute when the page switch is the announce of a native navigation', () => {
    const { rerender } = render(frame('/'));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/');

    // The bridge announced a native link navigation to /about
    // (previewNavigation.ts records it before setActivePage), then the page
    // switch landed as a currentPagePath change.
    confirmedLoad('/');
    confirmedLoad('/about');
    testCurrentPageId = 'about';
    rerender(frame('/about'));

    // The frame is ALREADY at /about — re-setting the attribute would load
    // the page a second time.
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/');
  });

  it('a later sidebar switch to a third page still navigates and consumes the marker', () => {
    const { rerender } = render(frame('/'));
    confirmedLoad('/');
    confirmedLoad('/about');
    testCurrentPageId = 'about';
    rerender(frame('/about')); // parked (skip)

    rerender(frame('/contact'));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/contact');
    expect(localNativeRoute.current).toBeNull();
  });

  it('a sidebar return to the route the stale attribute still names forces the navigation imperatively', () => {
    const { rerender } = render(frame('/'));
    confirmedLoad('/');
    confirmedLoad('/about');
    testCurrentPageId = 'about';
    rerender(frame('/about')); // parked: attribute '/', frame natively at /about

    const spy = vi.spyOn(frameEl(), 'setAttribute');
    rerender(frame('/')); // React sees the same string → no attribute write on its own
    expect(spy).toHaveBeenCalledWith('src', 'http://localhost:5001/');
    expect(localNativeRoute.current).toBeNull();
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/');
  });

  it('sq:reload-preview while parked reloads the TRUE route, not the stale attribute', () => {
    const { rerender } = render(frame('/'));
    confirmedLoad('/');
    confirmedLoad('/about');
    testCurrentPageId = 'about';
    rerender(frame('/about')); // parked: attribute '/', frame natively at /about

    act(() => {
      window.dispatchEvent(new CustomEvent('sq:reload-preview'));
    });
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/about');
    expect(localNativeRoute.current).toBeNull();
  });

  it('programmatic page switches with no native navigation in play are unchanged', () => {
    const { rerender } = render(frame('/'));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/');
    rerender(frame('/about'));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/about');
    rerender(frame('/'));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/');
  });
});


// Owner 2026-11-10 ("it must just SWITCH"), live: click a page and straight
// back — the superseded navigation committed after the newer src write and the
// canvas stayed on the page the user had left, for good.
describe('ViewportFrame — the page clicked last always loads', () => {
  beforeEach(() => { vi.clearAllMocks(); testCurrentPageId = 'about'; localNativeRoute.current = null; });
  afterEach(() => { testCurrentPageId = 'index'; localNativeRoute.current = null; });

  it('a superseded page that commits after a newer click is replaced by the clicked page, once', () => {
    const { rerender } = render(frame('/about'));
    confirmedLoad('/about');
    rerender(frame('/contact')); // click a page …
    rerender(frame('/about'));   // … and straight back before it committed
    const spy = vi.spyOn(frameEl(), 'setAttribute');
    mockSetActivePage.mockClear();
    confirmedLoad('/contact');   // the superseded navigation commits anyway
    expect(spy).toHaveBeenCalledWith('src', 'http://localhost:5001/about');
    expect(mockSetActivePage).not.toHaveBeenCalled(); // the editor stays where the user clicked
    spy.mockClear();
    confirmedLoad('/about');     // the page clicked last arrives
    confirmedLoad('/contact');   // consumed: a later native click to it is followed, not fought
    expect(spy).not.toHaveBeenCalled();
  });

  it('…also when the page left commits AFTER the clicked page already loaded (slow page)', () => {
    const { rerender } = render(frame('/about'));
    confirmedLoad('/about');
    rerender(frame('/contact'));
    rerender(frame('/about'));
    confirmedLoad('/about');     // the clicked page commits first …
    const spy = vi.spyOn(frameEl(), 'setAttribute');
    mockSetActivePage.mockClear();
    confirmedLoad('/contact');   // … then the slow page left behind replaces it
    expect(spy).toHaveBeenCalledWith('src', 'http://localhost:5001/about');
    expect(mockSetActivePage).not.toHaveBeenCalled(); // never adopted like a native link click
  });
});

describe('ViewportFrame — same-document overrides', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(localOverridesFragment).mockReturnValue(''); localNativeRoute.current = null; });
  afterEach(() => { vi.mocked(localOverridesFragment).mockReturnValue(''); localNativeRoute.current = null; });

  it('keeps the iframe/src while refreshing the in-frame fragment, including removal', () => {
    const { rerender } = render(frame('/?q=1'));
    const iframe = frameEl();
    const setSrc = vi.spyOn(iframe, 'setAttribute');
    vi.mocked(localOverridesFragment).mockReturnValue('#sq-ov=next');
    rerender(frame('/?q=1'));
    expect(frameEl()).toBe(iframe);
    expect(iframe.getAttribute('src')).toBe('http://localhost:5001/?q=1');
    expect(setSrc.mock.calls.filter(([name]) => name === 'src')).toEqual([]);
    expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'SYNC_LOCAL_OVERRIDES_FRAGMENT', payload: { url: 'http://localhost:5001/?q=1#sq-ov=next' } }, '*');
    vi.mocked(localOverridesFragment).mockReturnValue('');
    rerender(frame('/?q=1'));
    expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'SYNC_LOCAL_OVERRIDES_FRAGMENT', payload: { url: 'http://localhost:5001/?q=1' } }, '*');
  });

  it('a reload-from-source refreshes in place (no src write); the next route still carries the latest fragment', () => {
    const { rerender } = render(frame('/'));
    vi.mocked(localOverridesFragment).mockReturnValue('#sq-ov=next');
    rerender(frame('/'));
    const setSrc = vi.spyOn(frameEl(), 'setAttribute');
    mockContentWindow.postMessage.mockClear();
    act(() => window.dispatchEvent(new CustomEvent('sq:reload-preview')));
    // Seamless canvas (2.6): the bridge re-fetches the file bytes in place.
    expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'REFRESH_FROM_SOURCE' }, '*');
    expect(setSrc.mock.calls.filter(([name]) => name === 'src')).toEqual([]);
    rerender(frame('/about'));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/about#sq-ov=next');
  });

  it('replays the current fragment after IFRAME_READY, even under StrictMode', () => {
    const { rerender } = render(<React.StrictMode>{frame('/')}</React.StrictMode>);
    vi.mocked(localOverridesFragment).mockReturnValue('#sq-ov=next');
    rerender(<React.StrictMode>{frame('/')}</React.StrictMode>);
    mockContentWindow.postMessage.mockClear();
    act(() => window.dispatchEvent(new MessageEvent('message', { source: mockContentWindow as unknown as Window, origin: LOCAL.url, data: { type: 'IFRAME_READY', payload: { documentHeight: 800, documentWidth: 800 } } })));
    expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'SYNC_LOCAL_OVERRIDES_FRAGMENT', payload: { url: 'http://localhost:5001/#sq-ov=next' } }, '*');
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5001/');
  });
});


it('publishes the preview URL provider (URL only — no runtime provider) and clears it on unmount', () => {
  const publish = vi.spyOn(previewReload, 'setPreviewUrlProvider');
  try {
    const { unmount } = render(frame('/'));
    const call = publish.mock.calls.at(-1)!;
    expect(call).toHaveLength(1);
    expect(call[0]!()).toBe(frameEl().getAttribute('src'));
    unmount();
    expect(publish).toHaveBeenLastCalledWith(null);
  } finally { publish.mockRestore(); }
});


describe('ViewportFrame current-document route handshake', () => {
  beforeEach(() => { vi.clearAllMocks(); localNativeRoute.current = null; testCurrentPageId = 'about'; });
  afterEach(() => { testCurrentPageId = 'index'; localNativeRoute.current = null; setLocalExpectedRoute(null); setLocalPageFile(null); });
  const reply = (requestId: string, href: string) => act(() => window.dispatchEvent(new MessageEvent('message', {
    source: mockContentWindow as unknown as Window, origin: LOCAL.url,
    data: { type: 'LOCAL_ROUTE_RESULT', payload: { requestId, href, documentId: `doc-${requestId}` } },
  })));
  function loadedRequest() {
    fireEvent.load(frameEl());
    const request = mockContentWindow.postMessage.mock.calls.filter(([message]) => message.type === 'REQUEST_LOCAL_ROUTE').at(-1)?.[0];
    expect(request).toBeDefined();
    return request.payload.requestId as string;
  }

  it('follows confirmed home after a lost departing announce and asks for a fresh matching scan', () => {
    setLocalExpectedRoute('/about');
    setLocalPageFile('src/pages/about.astro');
    const { rerender } = render(frame('/about'));
    reply(loadedRequest(), LOCAL.url + '/about');
    mockSetActivePage.mockClear();
    // No trusted departing PREVIEW_NAVIGATE arrived. The same iframe loaded home.
    reply(loadedRequest(), LOCAL.url + '/');
    expect(mockSetActivePage).toHaveBeenCalledWith('index');
    // An early home scan cannot vouch after the Editor's new intent is armed.
    act(() => window.dispatchEvent(new MessageEvent('message', { source: mockContentWindow as unknown as Window, data: { type: 'ELEMENTS_SCANNED', payload: { route: '/', elements: [] } } })));
    expect(isLocalPageInSync()).toBe(false);
    testCurrentPageId = 'index'; // the one Editor/Pages owner commits the adoption
    setLocalExpectedRoute('/');
    setLocalPageFile('src/pages/index.astro');
    rerender(frame('/'));
    expect(isLocalPageInSync()).toBe(false);
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/about'); // native load is not repeated
    const scanRequest = mockContentWindow.postMessage.mock.calls.filter(([m]) => m.type === 'REQUEST_LOCAL_SCAN').at(-1)![0];
    expect(scanRequest.payload).toEqual({ href: LOCAL.url + '/', documentId: expect.any(String) });
    act(() => window.dispatchEvent(new MessageEvent('message', { source: mockContentWindow as unknown as Window, data: { type: 'ELEMENTS_SCANNED', payload: { route: '/', elements: [], ...scanRequest.payload } } })));
    expect(isLocalPageInSync()).toBe(true);
  });

  it('a late route reply cannot override a newer sidebar request', () => {
    const { rerender } = render(frame('/about'));
    const old = loadedRequest();
    testCurrentPageId = 'index';
    rerender(frame('/'));
    mockSetActivePage.mockClear();
    reply(old, LOCAL.url + '/about');
    expect(mockSetActivePage).not.toHaveBeenCalled();
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/');
  });
});


describe('review F1–F3: current document and editor intent stay distinct', () => {
  beforeEach(() => { vi.clearAllMocks(); testCurrentPageId = 'index'; testPages = defaultPages; localNativeRoute.current = null; });
  afterEach(() => { testCurrentPageId = 'index'; testPages = defaultPages; localNativeRoute.current = null; vi.mocked(localOverridesFragment).mockReturnValue(''); vi.restoreAllMocks(); });
  function loaded(href: string) {
    fireEvent.load(frameEl());
    const request = mockContentWindow.postMessage.mock.calls.filter(([m]) => m.type === 'REQUEST_LOCAL_ROUTE').at(-1)![0];
    act(() => window.dispatchEvent(new MessageEvent('message', { source: mockContentWindow as unknown as Window, origin: LOCAL.url, data: { type: 'LOCAL_ROUTE_RESULT', payload: { ...request.payload, href: LOCAL.url + href, documentId: `doc-${request.payload.requestId}` } } })));
  }

  it('adopts every hop over repeated native cycles even when returning to the parked attribute', () => {
    const { rerender } = render(frame('/'));
    loaded('/');
    for (const route of ['/about', '/', '/about', '/', '/about']) {
      mockSetActivePage.mockClear();
      loaded(route);
      const pageId = route === '/' ? 'index' : 'about';
      expect(mockSetActivePage).toHaveBeenCalledExactlyOnceWith(pageId);
      testCurrentPageId = pageId;
      rerender(frame(route));
      expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/');
    }
  });

  it('parks src across a ready-triggered render while the next native load reply is pending', () => {
    const publish = vi.spyOn(previewReload, 'setPreviewUrlProvider');
    const { rerender } = render(frame('/'));
    loaded('/'); loaded('/about/');
    testCurrentPageId = 'about'; rerender(frame('/about'));
    fireEvent.load(frameEl()); // new native Home has loaded, reply not delivered yet
    const request = mockContentWindow.postMessage.mock.calls.filter(([m]) => m.type === 'REQUEST_LOCAL_ROUTE').at(-1)![0];
    rerender(frame('/about')); // IFRAME_READY/scan render still has the previous editor page
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/');
    expect(publish.mock.calls.at(-1)![0]!()).toBeNull(); // no old URL can vouch for this load
    act(() => window.dispatchEvent(new MessageEvent('message', { source: mockContentWindow as unknown as Window, origin: LOCAL.url, data: { type: 'LOCAL_ROUTE_RESULT', payload: { ...request.payload, href: LOCAL.url + '/' } } })));
    testCurrentPageId = 'index'; rerender(frame('/'));
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/');
    expect(publish.mock.calls.at(-1)![0]!()).toBe(LOCAL.url + '/');
  });

  it('retains exact native path/query for fragment sync, current reads and explicit reload', () => {
    const publish = vi.spyOn(previewReload, 'setPreviewUrlProvider');
    const { rerender } = render(frame('/'));
    loaded('/');
    loaded('/about/?q=1');
    testCurrentPageId = 'about';
    rerender(frame('/about'));
    const currentUrl = publish.mock.calls.at(-1)![0]!;
    expect(currentUrl()).toBe(LOCAL.url + '/about/?q=1');
    const iframe = frameEl();
    const setSrc = vi.spyOn(iframe, 'setAttribute');
    vi.mocked(localOverridesFragment).mockReturnValue('#sq-ov=next');
    rerender(frame('/about'));
    expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'SYNC_LOCAL_OVERRIDES_FRAGMENT', payload: { url: LOCAL.url + '/about/?q=1#sq-ov=next' } }, '*');
    expect(setSrc.mock.calls.filter(([name]) => name === 'src')).toEqual([]);
    act(() => window.dispatchEvent(new CustomEvent('sq:reload-preview')));
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/about/?q=1#sq-ov=next');
    loaded('/about/?q=1#sq-ov=next');
    mockSetActivePage.mockClear();
    loaded('/');
    expect(mockSetActivePage).toHaveBeenCalledExactlyOnceWith('index');
  });

  it('adopts a still-current confirmed route when delayed discovery supplies its page', () => {
    testPages = [defaultPages[0]];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(frame('/'));
    loaded('/');
    loaded('/products/widget/?q=1');
    expect(mockSetActivePage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No local page matches route'));
    testPages = [...defaultPages, { id: 'products-widget', name: '/products/widget' }];
    rerender(frame('/'));
    expect(mockSetActivePage).toHaveBeenCalledExactlyOnceWith('products-widget');
    testCurrentPageId = 'products-widget';
    rerender(frame('/products/widget'));
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/');
    expect(mockContentWindow.postMessage).toHaveBeenCalledWith({ type: 'REQUEST_LOCAL_SCAN', payload: { href: LOCAL.url + '/products/widget/?q=1', documentId: expect.any(String) } }, '*');
  });

  it('a delayed seed cannot adopt an old confirmation after a newer sidebar intent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(frame('/'));
    loaded('/');
    loaded('/products/widget/');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No local page matches route'));
    testCurrentPageId = 'about';
    rerender(frame('/about'));
    mockSetActivePage.mockClear();
    testPages = [...defaultPages, { id: 'products-widget', name: '/products/widget' }];
    rerender(frame('/about'));
    expect(mockSetActivePage).not.toHaveBeenCalled();
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/about');
  });
});

// A4/A5 (2026-11-10): a crashed instance comes back on its port (supervisor lastPorts), so the src
// string does not change and React does not navigate; a NEW origin cannot be paint-held at all (one
// blank frame, log-proven). The canvas replaces the frame's document itself — whatever it holds, even
// the error page of a load that hit the dying server (case 29: stuck blank forever, log-proven).
describe('ViewportFrame — a crashed instance back on the same port', () => {
  beforeEach(() => { vi.clearAllMocks(); testCurrentPageId = 'about'; localNativeRoute.current = null; });
  afterEach(() => { vi.clearAllMocks(); testCurrentPageId = 'index'; });
  const at = (state: { status: 'running' | 'starting'; url: string | null }) => (
    <ViewportFrame breakpoint="md" scale={1} localInstanceState={state} currentPagePath="/about" />
  );
  const boundaries = () => mockContentWindow.location.replace.mock.calls.map(([href]) => new URL(href as string));

  it('keeps the src and replaces the kept document with a NEW url of the same page — once', () => {
    const { rerender } = render(at(LOCAL));
    rerender(at({ status: 'starting', url: null }));
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/about'); // case 29: the last frame stays
    expect(boundaries()).toHaveLength(0);
    rerender(at(LOCAL));
    expect(frameEl().getAttribute('src')).toBe(LOCAL.url + '/about');
    expect(boundaries()).toHaveLength(1);
    expect(boundaries()[0].origin + boundaries()[0].pathname).toBe(LOCAL.url + '/about');
    expect(boundaries()[0].searchParams.get('sq-b')).toMatch(/^\d+$/);
    rerender(at(LOCAL));
    expect(boundaries()).toHaveLength(1);
  });

  it('a new port: React navigates to it and nothing else does', () => {
    const { rerender } = render(at(LOCAL));
    rerender(at({ status: 'starting', url: null }));
    rerender(at({ status: 'running', url: 'http://localhost:5002' }));
    expect(frameEl().getAttribute('src')).toBe('http://localhost:5002/about');
    expect(boundaries()).toHaveLength(0);
  });

  it('a first boot (nothing shown yet) never sends one', () => {
    const { rerender } = render(at({ status: 'starting', url: null }));
    rerender(at(LOCAL));
    expect(boundaries()).toHaveLength(0);
  });
});
