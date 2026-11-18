/**
 * Owner report 2026-09-16: on a brand-new (empty) project, drawing a section
 * right away toasted "Still switching pages — try again in a moment". The scan
 * that vouches the route waited for "at least one source-tagged element" with
 * an 8-step backoff (~8 s) — a heuristic for un-hydrated pages that an EMPTY
 * body can never satisfy. An empty page reports on the first scan.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

function runRealScan(bridge: HarnessBridge) {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  return send.mock.calls.map((c) => c[0] as { type: string; payload?: { elements: unknown[] } }).filter((m) => m.type === 'ELEMENTS_SCANNED');
}

describe('scan of an empty page', () => {
  beforeEach(() => resetHarnessDom());

  it('reports an empty body immediately instead of waiting out the hydration retries', () => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    try {
      const bridge = mountBridgeForTest();
      const scans = runRealScan(bridge);
      expect(scans).toHaveLength(1);
      expect(scans[0].payload?.elements).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('still waits for tagging when candidates exist but none is source-tracked yet', () => {
    document.body.innerHTML = '<main><p>not tagged yet</p></main>';
    vi.useFakeTimers();
    try {
      const bridge = mountBridgeForTest();
      const scans = runRealScan(bridge);
      expect(scans).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
});
