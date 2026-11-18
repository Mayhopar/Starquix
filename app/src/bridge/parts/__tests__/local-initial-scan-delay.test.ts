/**
 * The local surface-switch blink, remaining half (owner report 2026-08-06).
 *
 * A local page frame is a REAL navigation: it paints the FILE bytes first, and
 * the instance override lives only in the parent's doc, so the parent cannot
 * re-paint it until the frame reports ELEMENTS_SCANNED. Everything the user
 * sees between those two moments is the wrong canvas.
 *
 * That gap was ~950 ms, and the reason is NOT in-frame work — measured live on
 * the local instance (astro dev 4.16.19, real bridge, fixture served at
 * :55228), three timers armed together at `load` inside the frame:
 *
 *     0 ms timer   → 0 ms late      (the thread is free)
 *     100 ms timer → 757 ms late    ┐ both fired at the SAME ~860 ms instant
 *     500 ms timer → 363 ms late    ┘ = a 1-second alignment boundary
 *
 * A busy main thread delays every timer; timer ALIGNMENT delays only the ones
 * carrying a delay. Chrome aligns timers to 1 s in a frame it treats as
 * background — the same family as task-146 (rAF frozen in the local cross-origin
 * iframe), and the same signature the owner's own paired-timer probe recorded
 * (0 ms on time, 100 ms 647 ms late) before it was read as a main-thread block.
 *
 * So `SCAN_INITIAL_DELAY_MS`, a 100 ms post-load settle, costs ~900 ms in local
 * mode. A zero delay is not alignable and cannot be charged that second.
 *
 * WC / server keep the settle: their frames are not the ones
 * being aligned, and the second test here is what pins that they are unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';
import { SCAN_INITIAL_DELAY_MS } from '../../constants';

type LocalWindow = Window & { __SQ_LOCAL_MODE__?: boolean };

/** Delays of every timer notifyReady arms, in order. */
function delaysArmedByNotifyReady(): number[] {
  const delays: number[] = [];
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return real(() => {}, 0); // never run the scan — this test only reads scheduling
  }) as typeof globalThis.setTimeout);

  const bridge = mountBridgeForTest();
  bridge.notifyReady();
  return delays;
}

describe('initial scan delay — local frames must not pay the alignment second', () => {
  beforeEach(() => {
    resetHarnessDom();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
  });

  it('local mode arms the initial scan with no delay', () => {
    (window as LocalWindow).__SQ_LOCAL_MODE__ = true;
    expect(delaysArmedByNotifyReady()).toEqual([0]);
  });

  it('WC / server keep the post-load settle (unchanged)', () => {
    expect(delaysArmedByNotifyReady()).toEqual([SCAN_INITIAL_DELAY_MS]);
  });
});
