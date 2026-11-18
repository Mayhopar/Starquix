/**
 * task-146: the initial post-load scan must NOT depend on requestAnimationFrame.
 * Chrome freezes rAF in the local-mode cross-origin iframe (proven live:
 * 'pre-rAF' marker posted, the rAF callback NEVER ran while plain timers did),
 * so a rAF-gated scan chain meant ELEMENTS_SCANNED never fired on navigation —
 * stale Layers, dead selection targets, edits lost on every fresh local page.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

describe('initial scan without requestAnimationFrame (task-146)', () => {
  beforeEach(() => {
    resetHarnessDom();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifyReady schedules the initial scan with rAF frozen (timers only)', async () => {
    // Freeze rAF exactly like the live local-mode iframe: callbacks never run.
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);

    const bridge = mountBridgeForTest(); // harness stubs scanElements as a spy
    bridge.notifyReady();

    // real timers: SCAN_INITIAL_DELAY_MS (100) — no animation frame ever fires
    await new Promise((r) => setTimeout(r, 400));

    expect(bridge.scanElements).toHaveBeenCalled();
  });
});
