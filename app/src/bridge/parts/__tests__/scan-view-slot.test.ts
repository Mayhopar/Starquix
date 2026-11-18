/**
 * Component/layout view slot placeholder (data-sq-view-slot, SqComponentView.astro).
 *
 * The placeholder ROOT is reported as a slot row (slotName '') so the layout
 * view's Layers tree shows the authored shape (main ▸ slot); its inline-styled
 * scenery children are never scanned (no phantom img/div rows).
 * 2026-08-23 local-layout Layers nesting — docs/plans/2026-08-23-local-layout-layers-nesting.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = {
  key: string;
  parentKey: string | null;
  tagName: string;
  slotName?: string;
};

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

describe('scan reports data-sq-view-slot as a slot row without its scenery', () => {
  beforeEach(() => resetHarnessDom());

  it('placeholder root is a slot row; children are excluded', () => {
    document.body.innerHTML =
      '<main data-sq-source="src/layouts/Main.astro:8:1" data-key="src/layouts/Main.astro:8:1">' +
      '<div data-sq-view-slot>' +
      '<img src="x.png" alt="Placeholder"><div>Slot content</div><div>copy</div>' +
      '</div>' +
      '</main>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const slot = elements.find((e) => e.slotName !== undefined);
    expect(slot, 'placeholder root must be reported as a slot').toBeTruthy();
    expect(slot!.slotName).toBe('');
    expect(slot!.key).toBe('sq-view-slot'); // pinned — never the wrapper temp-dir path
    expect(slot!.parentKey).toBe('src/layouts/Main.astro:8:1');

    expect(elements.some((e) => e.tagName === 'img'), 'scenery img must not be scanned').toBe(false);
    expect(elements.filter((e) => e.tagName === 'div').length, 'only the slot root div is scanned').toBe(1);
  });
});
