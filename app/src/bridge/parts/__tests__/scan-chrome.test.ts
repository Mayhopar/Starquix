/**
 * Scan inclusion of layout-chrome tags (data-sq-chrome).
 *
 * A chrome slot div (data-sq-chrome + data-key="layoutchrome-p1:slot") wraps a
 * content root (data-sq-source). After the scan:
 *  - the chrome div IS in ELEMENTS_SCANNED (keyed by its data-key, no source tracking)
 *  - the content root's parentKey resolves to the chrome slot div's key
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = {
  key: string;
  parentKey: string | null;
  hasSourceTracking: boolean;
  sourceKey?: string;
  tagName: string;
  slotName?: string;
};

function runScan(bridge: HarnessBridge): ScannedEl[] {
  // Expose the real prototype scanElements (the ctor shadows it with a vi.fn()),
  // and skip observer/resize wiring (geometry/styles parts aren't mounted).
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

describe('scan includes data-sq-chrome chrome tags', () => {
  beforeEach(() => resetHarnessDom());

  it('chrome slot div is scanned; content root parentKey resolves to it', () => {
    document.body.innerHTML =
      '<div data-sq-chrome data-key="layoutchrome-p1:slot" class="bg-white">' +
      '<section data-sq-source="Page.astro:3:1" data-key="Page.astro:3:1">content</section>' +
      '</div>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const chrome = elements.find((e) => e.key === 'layoutchrome-p1:slot');
    expect(chrome, 'chrome slot div must be in the scan').toBeTruthy();
    expect(chrome!.hasSourceTracking).toBe(false);
    expect(chrome!.sourceKey).toBeUndefined();
    expect(chrome!.tagName).toBe('div');

    const content = elements.find((e) => e.key === 'Page.astro:3:1');
    expect(content, 'content root must be in the scan').toBeTruthy();
    expect(content!.parentKey).toBe('layoutchrome-p1:slot');
  });

  it('stamps slotName on layout slots (named + default), not on other chrome/content', () => {
    document.body.innerHTML =
      '<div data-sq-chrome data-sq-slot data-key="layoutchrome-p1:slot-0" name="sidebar">' +
      '<section data-sq-source="Page.astro:3:1" data-key="Page.astro:3:1">x</section>' +
      '</div>' +
      '<div data-sq-chrome data-sq-slot data-key="layoutchrome-p1:slot-1">' +
      '<section data-sq-source="Page.astro:4:1" data-key="Page.astro:4:1">y</section>' +
      '</div>' +
      '<header data-sq-chrome data-key="layoutchrome-p1:header-0">H</header>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const named = elements.find((e) => e.key === 'layoutchrome-p1:slot-0');
    const def = elements.find((e) => e.key === 'layoutchrome-p1:slot-1');
    const header = elements.find((e) => e.key === 'layoutchrome-p1:header-0');
    const content = elements.find((e) => e.key === 'Page.astro:3:1');

    expect(named!.slotName).toBe('sidebar');
    expect(def!.slotName).toBe(''); // default slot
    expect(header!.slotName).toBeUndefined(); // chrome, not a slot
    expect(content!.slotName).toBeUndefined(); // content, not a slot
  });
});
