/**
 * Regression (2026-08-11, reported live as "selection doesn't follow the
 * size of an object" — a well-known recurring bug): the body ResizeObserver
 * only reported content HEIGHT. A layout change with no DOM mutation and no
 * window resize (image finished loading, media/content grew) refreshed no
 * element rects, so the parent's selection overlay kept the box measured at
 * scan time. Now every body-size change also pushes RECTS_UPDATED, which
 * re-syncs the selection overlay parent-side (handleRectsUpdated).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type GeometryBridge = HarnessBridge & {
  startResizeObserver: () => void;
  sendRectsUpdate: () => void;
  reportContentHeight: () => void;
};

describe('rects follow element resizes', () => {
  beforeEach(() => {
    resetHarnessDom();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sendRectsUpdate reports every data-key element (scan stamps them all)', () => {
    document.body.innerHTML =
      '<div data-key="drawn-1">a</div>' +
      '<section data-key="src/pages/index.astro:5:1">b</section>';
    const bridge = mountBridgeForTest() as GeometryBridge;
    bridge.sendRectsUpdate();

    const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
    const msg = send.mock.calls
      .map((c) => c[0] as { type: string; payload?: { rects: Array<{ key: string }> } })
      .find((m) => m.type === 'RECTS_UPDATED');
    expect(msg, 'RECTS_UPDATED must be sent').toBeTruthy();
    const keys = msg!.payload!.rects.map((r) => r.key);
    expect(keys).toContain('drawn-1');
    expect(keys).toContain('src/pages/index.astro:5:1');
  });

  // Regression (filmstrip 2026-11-08): a heading grew a line while typing, the
  // content below moved, but the vh-pinned body kept its size — no ResizeObserver
  // call, so the selection box stayed one line tall for ~430 ms after commit.
  it('a content change with no body resize pushes rects (once per burst)', async () => {
    document.body.innerHTML = '<h1 data-key="src/pages/index.astro:2:1">Short</h1><p data-key="src/pages/index.astro:3:1">x</p>';
    const bridge = mountBridgeForTest() as GeometryBridge & { _reportContentHeightNow: () => void };
    bridge._reportContentHeightNow(); // arms the content observer, as the first height report does
    const rectsSpy = vi.fn();
    bridge.sendRectsUpdate = rectsSpy;
    const text = document.querySelector('h1')!.firstChild as Text;
    text.data = 'A much longer heading that wraps';
    text.data = 'A much longer heading that wraps twice';
    await Promise.resolve(); // MutationObserver delivery
    expect(rectsSpy).not.toHaveBeenCalled(); // coalesced to the next task
    vi.advanceTimersByTime(0);
    expect(rectsSpy).toHaveBeenCalledTimes(1);
  });

  // Regression (pre-push gate 2026-11-08): the coalesced rects timer fired after a
  // test file's jsdom was torn down → "document is not defined", an unhandled error
  // that failed the whole run. A missing document means nothing to measure.
  it('the coalesced rects push is a no-op once the document is gone', () => {
    const bridge = mountBridgeForTest() as GeometryBridge & { scheduleRectsUpdate: () => void };
    const rectsSpy = vi.fn();
    bridge.sendRectsUpdate = rectsSpy;
    bridge.scheduleRectsUpdate();
    vi.stubGlobal('document', undefined);
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();
    vi.unstubAllGlobals();
    expect(rectsSpy).not.toHaveBeenCalled();
  });

  it('a body resize pushes fresh rects IMMEDIATELY (leading edge), then trails', () => {
    let observed: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class {
      cb: () => void;
      constructor(cb: () => void) { this.cb = cb; observed = () => this.cb(); }
      observe() {}
      disconnect() {}
    });
    const bridge = mountBridgeForTest() as GeometryBridge;
    const rectsSpy = vi.fn();
    bridge.sendRectsUpdate = rectsSpy;
    bridge.reportContentHeight = vi.fn();
    bridge.startResizeObserver();

    observed!();
    // Leading edge: the overlay travels WITH the element — no debounce lag.
    expect(rectsSpy).toHaveBeenCalledTimes(1);
    // Burst right behind it: mid-burst calls coalesce into ONE trailing report.
    observed!();
    observed!();
    expect(rectsSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(rectsSpy).toHaveBeenCalledTimes(2);
    // Quiet afterwards: no duplicate pass once the burst is reported.
    vi.advanceTimersByTime(300);
    expect(rectsSpy).toHaveBeenCalledTimes(2);
  });
});
