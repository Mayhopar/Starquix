/**
 * Regression (log-proven 2026-11-08): a canvas drag held past the 500 ms rescan
 * throttle let the scan record the drag placeholder `<div>` as a sibling
 * (`dynamic:div:N`). The drop handler counts indices against those siblings, so
 * "drop after the last link" planned "before Hello post" — the move landed one
 * slot off on disk and the canvas jumped there. The ghost (a body-level clone)
 * also showed in Layers as an extra row mid-drag. Drag chrome is never a row.
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

beforeEach(() => resetHarnessDom());

describe('scan — drag chrome is not a layer', () => {
  it('skips the drop line and the ghost mid-drag', () => {
    document.body.innerHTML =
      '<main data-sq-source="src/pages/index.astro:5:1">' +
      '<a data-sq-source="src/pages/index.astro:11:5" style="display:none">Release widget</a>' +
      '<a data-sq-source="src/pages/index.astro:12:5">Nested about</a>' +
      '<div data-sq-drop-line="true"></div>' +
      '<a data-sq-source="src/pages/index.astro:13:5">Hello post</a>' +
      '</main>' +
      '<a data-drag-ghost="true"><span>Release widget</span></a>';
    const elements = runScan(mountBridgeForTest());
    const main = elements.find((e) => e.key === 'src/pages/index.astro:5:1')!;
    const siblings = elements.filter((e) => e.parentKey === main.key).map((e) => e.key);
    expect(siblings).toEqual(['src/pages/index.astro:11:5', 'src/pages/index.astro:12:5', 'src/pages/index.astro:13:5']);
    expect(elements.filter((e) => e.key.startsWith('dynamic:'))).toEqual([]);
  });
});
