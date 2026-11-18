/**
 * Parity gap 25/58 — local preview-mode link navigation must ANNOUNCE the
 * destination so the editor's active page can follow.
 *
 * Local mode (task-132) lets the browser navigate natively (files are truth —
 * the iframe serves REAL routes), but before this fix the handler early-returned
 * without telling the parent anything: the canvas showed page B while the doc,
 * Pages panel and currentPageFile still said page A, and the task-133
 * wrong-file-write guard correctly refused every structural op until a manual
 * page click. The fix keeps navigation native (NO preventDefault) and sends the
 * SAME PREVIEW_NAVIGATE announce WC uses, so the parent can select the page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type LocalWindow = Window & { __SQ_LOCAL_MODE__?: boolean };

function previewNavCalls(bridge: HarnessBridge): Array<Record<string, unknown>> {
  return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as { type: string; payload?: Record<string, unknown> })
    .filter((m) => m.type === 'PREVIEW_NAVIGATE')
    .map((m) => m.payload ?? {});
}

function mountLocalPreview(): HarnessBridge {
  (window as LocalWindow).__SQ_LOCAL_MODE__ = true;
  const bridge = mountBridgeForTest();
  bridge.handleSetMode({ mode: 'preview' });
  (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
  return bridge;
}

describe('local preview link clicks — announce without preventing (gap 25/58)', () => {
  beforeEach(() => resetHarnessDom());
  afterEach(() => {
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    vi.restoreAllMocks();
  });

  it('sends PREVIEW_NAVIGATE for an internal link and leaves navigation native', () => {
    const bridge = mountLocalPreview();
    document.body.innerHTML = '<a href="/about"><span id="inner">deep</span></a>';
    const event = {
      target: document.getElementById('inner'),
      preventDefault: vi.fn(),
    } as unknown as MouseEvent;

    bridge.handlePreviewLinkClick(event);

    // Announce…
    expect(previewNavCalls(bridge)).toEqual([{ href: '/about' }]);
    // …but files-truth: the REAL route navigation must stay native.
    expect((event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault)
      .not.toHaveBeenCalled();
  });

  it('fires through the real document listener in preview mode, unprevented', () => {
    const bridge = mountLocalPreview();
    document.body.innerHTML = '<a id="lnk" href="/works/timepad-redesign">Work</a>';
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('lnk')!.dispatchEvent(event);

    expect(previewNavCalls(bridge)).toEqual([{ href: '/works/timepad-redesign' }]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ['cross-origin', '<a id="lnk" href="https://example.com/about">External</a>'],
    ['mailto:', '<a id="lnk" href="mailto:hi@example.com">Mail</a>'],
    ['target=_blank', '<a id="lnk" href="/about" target="_blank">New tab</a>'],
    ['download', '<a id="lnk" href="/file.pdf" download>File</a>'],
    ['in-page anchor', '<a id="lnk" href="#section">Section</a>'],
    ['empty href', '<a id="lnk">No href</a>'],
  ])('stays silent and native for a %s link', (_label, html) => {
    const bridge = mountLocalPreview();
    document.body.innerHTML = html;
    const event = {
      target: document.getElementById('lnk'),
      preventDefault: vi.fn(),
    } as unknown as MouseEvent;

    bridge.handlePreviewLinkClick(event);

    expect(previewNavCalls(bridge)).toEqual([]);
    expect((event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault)
      .not.toHaveBeenCalled();
  });

  it('a local blog-card anchor announces its REAL href, never the postSlug shape', () => {
    // Local blog cards point at real routes the site serves itself — the WC
    // postSlug/slotKey resolution (doc blogSlotBindings) has no meaning there.
    const bridge = mountLocalPreview();
    document.body.innerHTML =
      '<div data-key="el-slot1:div-0" data-blog-source="posts">' +
        '<a data-sq-post-slug="my-post" href="/blog/my-post">' +
          '<article><h3 id="title">Title</h3></article>' +
        '</a>' +
      '</div>';
    const event = {
      target: document.getElementById('title'),
      preventDefault: vi.fn(),
    } as unknown as MouseEvent;

    bridge.handlePreviewLinkClick(event);

    expect(previewNavCalls(bridge)).toEqual([{ href: '/blog/my-post' }]);
    expect((event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault)
      .not.toHaveBeenCalled();
  });

  it('WC (flag unset) keeps the intercept-and-block contract byte-identical', () => {
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    const bridge = mountBridgeForTest();
    bridge.handleSetMode({ mode: 'preview' });
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
    document.body.innerHTML = '<a id="lnk" href="/about">About</a>';
    const event = {
      target: document.getElementById('lnk'),
      preventDefault: vi.fn(),
    } as unknown as MouseEvent;

    bridge.handlePreviewLinkClick(event);

    expect(previewNavCalls(bridge)).toEqual([{ href: '/about' }]);
    expect((event as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault)
      .toHaveBeenCalled();
  });
});


describe('handleRequestLocalRoute / handleRequestLocalScan current-document handshake', () => {
  beforeEach(() => { resetHarnessDom(); (window as LocalWindow).__SQ_LOCAL_MODE__ = true; window.history.replaceState(null, '', '/about?q=1'); });
  afterEach(() => { delete (window as LocalWindow).__SQ_LOCAL_MODE__; window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

  it('answers a correlated read with this document URL, then scans only a full matching URL', () => {
    const bridge = mountBridgeForTest();
    bridge._handlers = {};
    bridge.registerHandlers();
    bridge._handlers.REQUEST_LOCAL_ROUTE({ requestId: 'current-load' });
    const documentId = (document as Document & { __sqBridgeDocumentId?: string }).__sqBridgeDocumentId;
    expect(documentId).toEqual(expect.stringMatching(/^[a-z0-9]+$/));
    expect(bridge.sendToParent).toHaveBeenCalledWith({ type: 'LOCAL_ROUTE_RESULT', payload: { requestId: 'current-load', href: window.location.href, documentId } });
    bridge._handlers.REQUEST_LOCAL_ROUTE({ requestId: 'same-document' });
    expect(bridge.sendToParent).toHaveBeenLastCalledWith({ type: 'LOCAL_ROUTE_RESULT', payload: { requestId: 'same-document', href: window.location.href, documentId } });
    const ownership = { documentId };
    bridge._handlers.REQUEST_LOCAL_SCAN({ href: window.location.href, ...ownership });
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
    bridge._handlers.REQUEST_LOCAL_SCAN({ href: new URL('/other?q=1', window.location.href).href, ...ownership });
    bridge._handlers.REQUEST_LOCAL_SCAN({ href: new URL('/about?q=2', window.location.href).href, ...ownership });
    bridge._handlers.REQUEST_LOCAL_SCAN({ href: 'https://other.test/about?q=1', ...ownership });
    expect(bridge.scanElements).toHaveBeenCalledTimes(1);
  });

  it('does not answer malformed requests or non-files-truth frames', () => {
    const bridge = mountBridgeForTest();
    bridge._handlers = {};
    bridge.registerHandlers();
    bridge._handlers.REQUEST_LOCAL_ROUTE({});
    bridge._handlers.REQUEST_LOCAL_SCAN({});
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    bridge._handlers.REQUEST_LOCAL_ROUTE({ requestId: 'doc-mode' });
    bridge._handlers.REQUEST_LOCAL_SCAN({ href: window.location.href });
    expect(bridge.sendToParent).not.toHaveBeenCalled();
    expect(bridge.scanElements).not.toHaveBeenCalled();
  });
});
