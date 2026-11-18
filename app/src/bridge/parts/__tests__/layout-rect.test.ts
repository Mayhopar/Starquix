/**
 * Layout selection identity has no single DOM box: its rect is the UNION of the
 * top-level chrome tags ([data-sq-chrome] keyed "<layoutElementId>:<selector>").
 * Asking the bridge for the rect of a bare layout-element id returns that union.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

function stubRect(el: Element, r: { left: number; top: number; right: number; bottom: number }) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.right - r.left,
      height: r.bottom - r.top,
      x: r.left,
      y: r.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function requestRect(bridge: HarnessBridge, key: string) {
  (bridge as unknown as { handleRequestElementRect: (p: { key: string }) => void })
    .handleRequestElementRect({ key });
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const msg = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { key: string; rect: { top: number; left: number; width: number; height: number } } })
    .find((m) => m.type === 'ELEMENT_RECT_RESPONSE');
  return msg?.payload?.rect;
}

describe('layout union-rect for Layout selection identity', () => {
  beforeEach(() => resetHarnessDom());

  it('returns the union rect of top-level chrome tags for a bare layout-element id', () => {
    document.body.innerHTML =
      '<header data-sq-chrome data-key="layoutchrome-p1:header"></header>' +
      '<footer data-sq-chrome data-key="layoutchrome-p1:footer"></footer>';

    const header = document.querySelector('[data-key="layoutchrome-p1:header"]')!;
    const footer = document.querySelector('[data-key="layoutchrome-p1:footer"]')!;
    stubRect(header, { left: 10, top: 5, right: 110, bottom: 55 });
    stubRect(footer, { left: 20, top: 200, right: 140, bottom: 260 });

    const bridge = mountBridgeForTest();
    const rect = requestRect(bridge, 'layoutchrome-p1');

    expect(rect).toBeTruthy();
    // Union: min-left/top, max-right/bottom.
    expect(rect!.left).toBe(10);
    expect(rect!.top).toBe(5);
    expect(rect!.width).toBe(130); // maxRight(140) - minLeft(10)
    expect(rect!.height).toBe(255); // maxBottom(260) - minTop(5)
  });
});
