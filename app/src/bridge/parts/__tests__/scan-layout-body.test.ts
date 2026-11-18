/**
 * Layout-element paradigm (2026-08-24): the scan reports document.body as a
 * real element when its data-sq-source points into src/layouts/ — the Layout
 * row in Layers IS that element. Children auto-nest via findParentKey.
 * WC bare-shell bodies (non-layout sources) must stay unreported.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = { key: string; parentKey: string | null; tagName: string };

function runScan(bridge: HarnessBridge): ScannedEl[] {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

describe('scan reports a layout-owned <body> as a real element', () => {
  beforeEach(() => {
    resetHarnessDom();
    document.body.removeAttribute('data-sq-source');
    document.body.removeAttribute('data-key');
  });

  it('body with a src/layouts/ source is scanned; children nest under it', () => {
    document.body.setAttribute('data-sq-source', 'src/layouts/Main.astro:37:2');
    document.body.innerHTML =
      '<header data-sq-source="src/components/Header.astro:6:1">nav</header>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const body = elements.find((e) => e.tagName === 'body');
    expect(body, 'layout body must be scanned').toBeTruthy();
    expect(body!.key).toBe('src/layouts/Main.astro:37:2');

    const header = elements.find((e) => e.tagName === 'header');
    expect(header!.parentKey, 'children nest under body').toBe('src/layouts/Main.astro:37:2');
  });

  it('body WITHOUT a layouts source stays unreported (WC shell / plain pages)', () => {
    document.body.setAttribute('data-sq-source', 'src/pages/index.astro:1:1');
    document.body.innerHTML = '<div data-sq-source="src/pages/index.astro:3:1">x</div>';
    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);
    expect(elements.some((e) => e.tagName === 'body')).toBe(false);
    expect(elements.find((e) => e.tagName === 'div')!.parentKey).toBeNull();
  });

  it('untagged body stays unreported', () => {
    document.body.innerHTML = '<div data-sq-source="src/pages/index.astro:3:1">x</div>';
    const bridge = mountBridgeForTest();
    expect(runScan(bridge).some((e) => e.tagName === 'body')).toBe(false);
  });
});
