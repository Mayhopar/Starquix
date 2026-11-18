/**
 * task-120 (5.4) — scoped scans. The ELEMENTS_SCANNED contract stays FULL
 * arrays; only rect reads are skipped, and only for elements preceding the
 * first changed node in document order. Timer rescans (500/1500ms) are gone;
 * the rescan budget resets on RENDER and SET_PAGE.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScanBridge = HarnessBridge & {
  scanElements: (retryCount?: number, scanScope?: Element[] | null) => void;
  startMutationObserver: () => void;
  handleRender: (payload: Record<string, unknown>) => void;
  handleSetPage: (payload: { pageId?: string }) => void;
  mutationObserverStarted: boolean;
  _rescanCount: number;
  _lastRectByKey: Record<string, unknown>;
  elementsReady: boolean;
  processPendingClassUpdates: () => void;
  resolveAssetRefsInDOM: () => void;
  _ensureBlogCardKeys: () => void;
  _assetMap: Record<string, string>;
};

function mount(): ScanBridge {
  const bridge = mountBridgeForTest() as ScanBridge;
  bridge._assetMap = {};
  (bridge as unknown as Record<string, unknown>).pendingClassUpdates = [];
  // The harness stubs scanElements per instance — drop the stub so the REAL
  // prototype method (the shipped code) runs.
  delete (bridge as unknown as Record<string, unknown>).scanElements;
  return bridge;
}

function trackRectReads(el: Element): { count: () => number } {
  let calls = 0;
  (el as HTMLElement).getBoundingClientRect = () => {
    calls++;
    return { top: 0, left: 0, width: 100, height: 50, right: 100, bottom: 50 } as DOMRect;
  };
  return { count: () => calls };
}

describe('scoped scans (task-120)', () => {
  beforeEach(() => {
    resetHarnessDom();
    document.body.innerHTML =
      '<div id="sq-components">' +
      '<section data-key="root-a"><h1 data-key="root-a:h1-0">A</h1></section>' +
      '<section data-key="root-b"><h1 data-key="root-b:h1-0">B</h1></section>' +
      '</div>';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('full ELEMENTS_SCANNED array is always sent (contract preserved)', () => {
    const bridge = mount();
    const rootB = document.querySelector('[data-key="root-b"]')!;
    bridge.scanElements(0, null); // full scan seeds the cache
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();
    bridge.scanElements(0, [rootB]); // scoped

    const scanned = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => (c[0] as { type: string }).type === 'ELEMENTS_SCANNED')!;
    const keys = (scanned[0] as { payload: { elements: Array<{ key: string }> } })
      .payload.elements.map((e) => e.key);
    expect(keys).toContain('root-a');
    expect(keys).toContain('root-b');
    expect(keys).toContain('root-a:h1-0');
  });

  it('scoped scan reuses cached rects for elements preceding the change', () => {
    const bridge = mount();
    const rootA = document.querySelector('[data-key="root-a"]')!;
    const rootB = document.querySelector('[data-key="root-b"]')!;
    const aReads = trackRectReads(rootA);
    const bReads = trackRectReads(rootB);

    bridge.scanElements(0, null); // full: both read
    const aAfterFull = aReads.count();
    const bAfterFull = bReads.count();
    expect(aAfterFull).toBeGreaterThan(0);

    bridge.scanElements(0, [rootB]); // only B changed
    expect(aReads.count()).toBe(aAfterFull); // A's rect reused from cache
    expect(bReads.count()).toBeGreaterThan(bAfterFull); // B re-read
  });

  it('elements at/after the change are re-read (they may have shifted)', () => {
    const bridge = mount();
    const rootA = document.querySelector('[data-key="root-a"]')!;
    const rootB = document.querySelector('[data-key="root-b"]')!;
    const bReads = trackRectReads(rootB);

    bridge.scanElements(0, null);
    const bAfterFull = bReads.count();

    bridge.scanElements(0, [rootA]); // A changed → B (after A) must re-read
    expect(bReads.count()).toBeGreaterThan(bAfterFull);
  });

  it('startMutationObserver schedules NO deferred timer rescans', () => {
    vi.useFakeTimers();
    const bridge = mount();
    const scanSpy = vi.fn();
    bridge.scanElements = scanSpy as unknown as ScanBridge['scanElements'];
    bridge.startMutationObserver();
    vi.advanceTimersByTime(3000);
    expect(scanSpy).not.toHaveBeenCalled();
  });

});
