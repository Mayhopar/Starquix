/**
 * task-120 (5.3) — wheel events are accumulated and flushed as ONE WHEEL
 * message per animation frame (deltas summed, position/modifiers latest);
 * TEXT_SELECTION_CHANGED skips sends when the payload is unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type WheelBridge = HarnessBridge & {
  handleWheel: (e: Partial<WheelEvent> & { preventDefault: () => void }) => void;
};

let rafQueue: Array<() => void>;

function flushRaf(): void {
  rafQueue.splice(0).forEach((cb) => cb());
}

describe('wheel coalescing', () => {
  beforeEach(() => {
    resetHarnessDom();
    rafQueue = [];
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0));
      return ++id;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wheel(bridge: WheelBridge, dx: number, dy: number, x = 10, y = 20): void {
    bridge.handleWheel({
      deltaX: dx, deltaY: dy, clientX: x, clientY: y,
      ctrlKey: false, metaKey: false, preventDefault: vi.fn(),
    });
  }

  it('N wheel events in one frame → one WHEEL message with summed deltas', () => {
    const bridge = mountBridgeForTest() as WheelBridge;
    wheel(bridge, 1, 10);
    wheel(bridge, 2, 20);
    wheel(bridge, 3, 30, 99, 88);

    expect(bridge.sendToParent).not.toHaveBeenCalled();
    flushRaf();

    const calls = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'WHEEL');
    expect(calls.length).toBe(1);
    const payload = (calls[0][0] as { payload: Record<string, number> }).payload;
    expect(payload.deltaX).toBe(6);
    expect(payload.deltaY).toBe(60);
    expect(payload.clientX).toBe(99); // latest position wins
  });

  it('separate frames → separate messages', () => {
    const bridge = mountBridgeForTest() as WheelBridge;
    wheel(bridge, 0, 10);
    flushRaf();
    wheel(bridge, 0, 5);
    flushRaf();
    const calls = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'WHEEL');
    expect(calls.length).toBe(2);
  });
});

describe('text-selection dedupe', () => {
  beforeEach(() => {
    resetHarnessDom();
  });

  it('identical selectionchange payloads send once', () => {
    const bridge = mountBridgeForTest();
    const el = document.createElement('p');
    el.setAttribute('data-key', 'k1');
    el.textContent = 'Hello world';
    document.body.appendChild(el);

    bridge.handleEnterEditMode({ key: 'k1' });
    (bridge.sendToParent as ReturnType<typeof vi.fn>).mockClear();

    // Fire selectionchange twice with the same (empty) selection
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('selectionchange'));

    const sends = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_SELECTION_CHANGED');
    expect(sends.length).toBe(1);
  });
});
