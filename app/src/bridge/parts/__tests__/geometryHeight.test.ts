// app/src/bridge/parts/__tests__/geometryHeight.test.ts
// Regression (2026-07-14, task-111 follow-up): the resize-observer safety net
// gated reports on scrollHeight, which is pinned to the tall iframe viewport
// and can NEVER detect shrinkage — any direct-DOM removal (e.g. the AI stream
// preview container) left a permanent white gap. The net must delegate to
// reportContentHeight(), whose content-bottom measure shrinks correctly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type GeometryBridge = HarnessBridge & {
  startResizeObserver: () => void;
  reportContentHeight: () => void;
};

describe('startResizeObserver height safety net', () => {
  beforeEach(() => {
    resetHarnessDom();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('reports via reportContentHeight unconditionally (no grow-only scrollHeight gate)', () => {
    const bridge = mountBridgeForTest() as GeometryBridge;
    const spy = vi.fn();
    bridge.reportContentHeight = spy;
    bridge.startResizeObserver(); // jsdom has no ResizeObserver → interval fallback
    vi.advanceTimersByTime(1000);
    // jsdom scrollHeight is 0 — the old |0 - 0| > 10 gate silently swallowed
    // this report (and every shrink on real pages). The delegate must fire.
    expect(spy).toHaveBeenCalled();
  });
});
