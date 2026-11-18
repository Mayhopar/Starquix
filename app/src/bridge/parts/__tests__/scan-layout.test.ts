import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScanBridge = HarnessBridge & {
  scanElements: () => void;
  startResizeListener: () => void;
  stopMutationObserver: () => void;
  _rescanCount: number;
  startResizeObserver: () => void;
};
const mounted: ScanBridge[] = [];
let events: ReturnType<typeof vi.spyOn>;

function mount() {
  const bridge = mountBridgeForTest() as ScanBridge;
  bridge._assetMap = {};
  bridge.pendingClassUpdates = [];
  // This suite observes scan messages, not geometry reporting or polling.
  bridge.reportContentHeight = vi.fn();
  bridge.startResizeObserver = vi.fn();
  mounted.push(bridge);
  delete (bridge as Partial<ScanBridge>).scanElements;
  return bridge;
}

function layout(bridge: ScanBridge) {
  const calls = vi.mocked(bridge.sendToParent).mock.calls;
  const message = calls.map(([message]) => message as { type: string; payload: { elements: Array<{ key: string; layout?: string }> } })
    .filter(message => message.type === 'ELEMENTS_SCANNED').at(-1)!;
  return message.payload.elements.find(element => element.key === 'container')?.layout;
}

describe('scanned container layout', () => {
  beforeEach(() => {
    resetHarnessDom();
    events = vi.spyOn(window, 'addEventListener');
  });
  afterEach(() => {
    mounted.splice(0).forEach(bridge => bridge.stopMutationObserver());
    for (const [type, handler] of events.mock.calls) window.removeEventListener(type as string, handler as EventListener);
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetHarnessDom();
  });

  it.each([
    ['block', '', '', undefined],
    ['flex', 'row', '', 'flex-row'],
    ['inline-flex', 'column', '', 'flex-column'],
    ['flex', 'row-reverse', '', 'flex-row-reverse'],
    ['flex', 'column-reverse', '', 'flex-column-reverse'],
    ['grid', '', 'row dense', 'grid-row'],
    ['inline-grid', '', 'column dense', 'grid-column'],
  ])('reports rendered %s / %s / %s', (display, direction, flow, expected) => {
    document.body.innerHTML = `<div id="sq-components"><div data-key="container" style="display:${display};flex-direction:${direction};grid-auto-flow:${flow}"></div></div>`;
    const bridge = mount();
    bridge.scanElements();
    expect(layout(bridge)).toBe(expected);
  });

  it('reads CSS rules rather than guessing from Tailwind class names', () => {
    document.body.innerHTML = '<style>.custom-layout { display: flex; flex-direction: column-reverse; }</style><div id="sq-components"><div data-key="container" class="custom-layout"></div></div>';
    const bridge = mount();
    bridge.scanElements();
    expect(layout(bridge)).toBe('flex-column-reverse');
    (document.querySelector('[data-key="container"]') as HTMLElement).style.display = 'block';
    bridge.scanElements();
    expect(layout(bridge)).toBeUndefined();
  });

  it('refreshes layout on viewport width changes, without scanning on height-only resize', () => {
    vi.useFakeTimers();
    const bridge = mount();
    const scan = vi.spyOn(bridge, 'scanElements').mockImplementation(() => {});
    vi.spyOn(bridge as unknown as { sendRectsUpdate(): void }, 'sendRectsUpdate').mockImplementation(() => {});
    const initialWidth = window.innerWidth;
    bridge.startResizeListener();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    expect(scan).not.toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth - 100 });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    expect(scan).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
  });

  it.each(['parent', 'html'])('refreshes descendants when a %s class changes their layout', async (target) => {
    vi.useFakeTimers();
    document.body.innerHTML = '<style>.target { display: flex; flex-direction: row; } .column .target { flex-direction: column; }</style><div id="sq-components"><div id="parent"><div data-key="container" class="target"></div></div></div>';
    const bridge = mount();
    bridge.scanElements();
    bridge._rescanCount = 10;
    const ancestor = target === 'html' ? document.documentElement : document.getElementById('parent')!;
    try {
      ancestor.classList.add('column');
      await vi.advanceTimersByTimeAsync(600);
      expect(layout(bridge)).toBe('flex-column');
      expect(bridge._rescanCount).toBe(10);
    } finally {
      ancestor.classList.remove('column');
    }
  });

  it('publishes layout-changing class edits even after the ordinary scan budget is exhausted', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<style>.row { display: flex; flex-direction: row; } .column { display: flex; flex-direction: column; }</style><div id="sq-components"><div data-key="container" class="row"></div></div>';
    const bridge = mount();
    bridge.scanElements();
    bridge._rescanCount = 10;
    const element = document.querySelector('[data-key="container"]')!;
    element.setAttribute('class', 'column');
    await vi.advanceTimersByTimeAsync(600);
    expect(layout(bridge)).toBe('flex-column');
    expect(bridge._rescanCount).toBe(10);
    // Returning to normal flow also updates the icon; inline style counts.
    (element as HTMLElement).style.display = 'block';
    await vi.advanceTimersByTimeAsync(600);
    expect(layout(bridge)).toBeUndefined();
    bridge.stopMutationObserver();
  });
});
