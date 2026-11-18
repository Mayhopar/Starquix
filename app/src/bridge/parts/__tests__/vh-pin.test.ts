/**
 * Design mode never scrolls: the bridge pins every vh in the document's own
 * stylesheets to the breakpoint's design viewport height, so a 100vh hero is
 * one design screen tall and the frame can fit the whole page. Preview mode
 * removes the pin. Ledger: docs/plans/2026-09-10-design-mode-no-scroll-ledger.md
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type PinBridge = HarnessBridge & {
  _vhPinHeight?: number;
  _vhPinObserver: MutationObserver | null;
  _vhPinCssFor: (height: number) => string;
  pinDesignViewport: (height: unknown) => void;
  unpinDesignViewport: () => void;
  handleSetMode: (payload: { mode?: string; designViewportHeight?: unknown }) => void;
  reportContentHeight: () => void;
};

function addSheet(css: string, id?: string): HTMLStyleElement {
  const el = document.createElement('style');
  if (id) el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
  return el;
}
const pin = (): string => document.getElementById('sq-vh-pin')?.textContent ?? '';
// document.head persists across tests: every bridge's observer must be released.
const bridges: PinBridge[] = [];
const mount = (): PinBridge => { const b = mountBridgeForTest() as PinBridge; bridges.push(b); return b; };

beforeEach(() => { resetHarnessDom(); vi.useFakeTimers(); });
afterEach(() => { for (const b of bridges.splice(0)) b.unpinDesignViewport(); vi.useRealTimers(); });

describe('vh pin (design mode)', () => {
  it('re-emits every vh declaration in px at the design height, !important, keeping the @media chain', () => {
    addSheet('.h-screen{height:100vh}.hero{min-height:50vh;padding:2vh 0}.plain{height:10px}@media (min-width:768px){.md\\:h-screen{height:100vh}}');
    const bridge = mount();
    bridge.mode = 'design';
    bridge.pinDesignViewport(900);
    const css = pin();
    expect(css).toContain('.h-screen{height:900px !important}');
    // jsdom's CSSOM may expand shorthands; the pinned values are what matters.
    expect(css).toMatch(/\.hero\{min-height:450px !important;.*padding[^}]*18px 0(px)? !important\}/);
    expect(css).not.toContain('.plain');
    expect(css).toMatch(/@media \(min-width: ?768px\)\{\.md\\:h-screen\{height:900px !important\}\}/);
    // Last in <head>, so it wins ties against the author's own !important.
    expect(document.head.lastElementChild?.id).toBe('sq-vh-pin');
  });

  it('handles calc/min, decimals, negatives and dvh/svh/lvh as vh', () => {
    addSheet('.a{height:calc(100vh - 4rem)}.b{margin-top:-10vh}.c{font-size:2.5vh}.d{height:100dvh;min-height:100svh;max-height:100lvh}');
    const bridge = mount();
    bridge.mode = 'design';
    bridge.pinDesignViewport(800);
    const css = pin();
    expect(css).toContain('.a{height:calc(800px - 4rem) !important}');
    expect(css).toContain('.b{margin-top:-80px !important}');
    expect(css).toContain('.c{font-size:20px !important}');
    expect(css).toContain('.d{height:800px !important;min-height:800px !important;max-height:800px !important}');
  });

  it('pins nothing on a page without vh, skips a cross-origin sheet, ignores an invalid height', () => {
    addSheet('.x{height:10px}');
    const foreign = addSheet('.y{height:100vh}');
    Object.defineProperty(foreign.sheet!, 'cssRules', { get() { throw new DOMException('cross-origin', 'SecurityError'); } });
    const bridge = mount();
    bridge.mode = 'design';
    bridge.pinDesignViewport(900);
    expect(document.getElementById('sq-vh-pin')).not.toBeNull();
    expect(pin()).toBe('');
    for (const bad of [undefined, null, 0, -5, NaN, Infinity, '900']) {
      bridge.pinDesignViewport(bad);
      expect(bridge._vhPinHeight).toBe(900);
    }
  });

  it('re-pins after a stylesheet is swapped (Vite HMR) and re-reports the content height', async () => {
    const first = addSheet('.h-screen{height:100vh}');
    const bridge = mount();
    bridge.mode = 'design';
    const report = vi.spyOn(bridge, 'reportContentHeight');
    bridge.pinDesignViewport(900);
    expect(report).toHaveBeenCalledTimes(1);
    first.remove();
    addSheet('.h-screen{height:100vh}.new{min-height:100vh}');
    await vi.advanceTimersByTimeAsync(150);
    expect(pin()).toContain('.new{min-height:900px !important}');
    // Fake timers may split the remove/add records into separate deliveries;
    // what matters: it re-reported, and its own re-append never loops.
    expect(report.mock.calls.length).toBeGreaterThanOrEqual(2);
    const settled = report.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(report).toHaveBeenCalledTimes(settled);
  });

  it('SET_MODE carries the height: same mode + new height re-pins; preview removes the pin; design restores it', () => {
    addSheet('.h-screen{height:100vh}');
    const bridge = mount();
    bridge.handleSetMode({ mode: 'design', designViewportHeight: 900 });
    expect(pin()).toContain('900px');
    bridge.handleSetMode({ mode: 'design', designViewportHeight: 1024 });
    expect(pin()).toContain('1024px');
    bridge.handleSetMode({ mode: 'preview' });
    expect(document.getElementById('sq-vh-pin')).toBeNull();
    expect(bridge._vhPinObserver).toBeNull();
    bridge.handleSetMode({ mode: 'design', designViewportHeight: 1024 });
    expect(pin()).toContain('1024px');
  });

  it('SET_MODE design without a height (reloaded bridge before the parent answers) keeps the page unpinned', () => {
    addSheet('.h-screen{height:100vh}');
    const bridge = mount();
    bridge.mode = 'preview';
    bridge.handleSetMode({ mode: 'design' });
    expect(document.getElementById('sq-vh-pin')).toBeNull();
  });
});
