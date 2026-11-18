/**
 * gap-59 regression: local iframe reload → parent re-send fires.
 *
 * A local HMR full reload re-boots the bridge, which announces IFRAME_READY —
 * but local mode never sends RENDER (files are truth), so ViewportFrame's
 * post-RENDER `sq:iframe-ready` sweep never fired and every injected session
 * stylesheet (SET_FONTS_CSS, SET_VARIABLES_CSS) stayed dead until a manual
 * page switch. The parent-side relay (Canvas.tsx relayLocalIframeReady) must
 * fire the sweep straight off the bridge's announce — pinned to the local
 * iframe's own window, IFRAME_READY only, and never anything RENDER-shaped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import { relayLocalIframeReady } from '@/components/Canvas/Canvas';

type SentMessage = { type: string; payload?: unknown };

function sentTypes(bridge: HarnessBridge): SentMessage[] {
  return (bridge.sendToParent as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => c[0] as SentMessage,
  );
}

function fakeMessageEvent(data: unknown, source: unknown): MessageEvent {
  return { data, source } as unknown as MessageEvent;
}

describe('gap-59: local iframe reload → parent re-send sweep', () => {
  const sweep = vi.fn();

  beforeEach(() => {
    resetHarnessDom();
    sweep.mockClear();
    window.addEventListener('sq:iframe-ready', sweep);
  });

  afterEach(() => {
    window.removeEventListener('sq:iframe-ready', sweep);
  });

  it('the bridge announces IFRAME_READY on every (re)boot — the reload edge the relay keys on', () => {
    const bridge = mountBridgeForTest();
    bridge.notifyReady();
    expect(sentTypes(bridge).map((m) => m.type)).toContain('IFRAME_READY');
  });

  it('relay dispatches sq:iframe-ready when the LOCAL iframe posts IFRAME_READY', () => {
    const bridge = mountBridgeForTest();
    bridge.notifyReady();
    const ready = sentTypes(bridge).find((m) => m.type === 'IFRAME_READY');
    expect(ready).toBeTruthy();

    const localWin = {} as Window;
    const relay = relayLocalIframeReady(() => localWin);
    relay(fakeMessageEvent(ready, localWin));

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('every reload re-fires the sweep (HMR full reload = new announce)', () => {
    const localWin = {} as Window;
    const relay = relayLocalIframeReady(() => localWin);
    relay(fakeMessageEvent({ type: 'IFRAME_READY' }, localWin));
    relay(fakeMessageEvent({ type: 'IFRAME_READY' }, localWin));
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('relay ignores foreign sources, non-ready types, and a missing local window', () => {
    const localWin = {} as Window;
    const relay = relayLocalIframeReady(() => localWin);

    relay(fakeMessageEvent({ type: 'IFRAME_READY' }, {} as Window)); // wrong source
    relay(fakeMessageEvent({ type: 'ELEMENTS_SCANNED' }, localWin)); // wrong type
    relay(fakeMessageEvent({ type: 'RENDER' }, localWin)); // never a RENDER trigger
    relay(fakeMessageEvent(null, localWin)); // malformed
    const gone = relayLocalIframeReady(() => null);
    gone(fakeMessageEvent({ type: 'IFRAME_READY' }, localWin)); // iframe torn down

    expect(sweep).not.toHaveBeenCalled();
  });

  it('the re-sent css channels land in the rebooted DOM (what the sweep restores)', () => {
    // Fresh boot = fresh document: no injected styles survive an HMR reload.
    expect(document.getElementById('sq-fonts')).toBeNull();
    expect(document.getElementById('sq-variables')).toBeNull();

    const bridge = mountBridgeForTest();
    // What useFontsSync / useVariablesSync re-send on sq:iframe-ready:
    bridge.handleSetFontsCss({ css: "@font-face{font-family:'X';src:url(/fonts/x.woff2)}" });
    bridge.handleSetVariablesCSS({ css: ':root{--sq-brand:#123456;}' });

    expect(document.getElementById('sq-fonts')?.textContent).toContain("font-family:'X'");
    expect(document.getElementById('sq-variables')?.textContent).toContain('--sq-brand');
  });
});
