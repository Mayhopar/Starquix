/**
 * Regression (2026-07-24): inline <svg> shapes in generated markup never
 * appeared in Layers — the scanner's SKIP_TAGS excluded 'svg' entirely.
 * Root <svg> is now scanned/keyed like <img>; svg internals stay skipped;
 * nested <svg> and drawn-shape inner svg stay excluded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScanBridge = HarnessBridge & {
  scanElements: (retryCount?: number, scanScope?: Element[] | null) => void;
  _ensureBlogCardKeys: () => void;
  _assetMap: Record<string, string>;
};

function mount(): ScanBridge {
  const bridge = mountBridgeForTest() as ScanBridge;
  bridge._assetMap = {};
  (bridge as unknown as Record<string, unknown>).pendingClassUpdates = [];
  delete (bridge as unknown as Record<string, unknown>).scanElements;
  return bridge;
}

function scannedKeys(bridge: ScanBridge): string[] {
  const call = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .find((c) => (c[0] as { type: string }).type === 'ELEMENTS_SCANNED')!;
  return (call[0] as { payload: { elements: Array<{ key: string }> } })
    .payload.elements.map((e) => e.key);
}

describe('scan: svg as a layer', () => {
  beforeEach(() => {
    resetHarnessDom();
  });

  it('root <svg> gets a data-key and appears in ELEMENTS_SCANNED', () => {
    document.body.innerHTML =
      '<div id="sq-components"><div data-key="root-a">' +
      '<svg width="96" height="96"><circle cx="48" cy="48" r="32"></circle></svg>' +
      '</div></div>';
    const bridge = mount();
    bridge.scanElements(0, null);

    const svg = document.querySelector('svg')!;
    expect(svg.getAttribute('data-key')).toBeTruthy();
    expect(scannedKeys(bridge)).toContain(svg.getAttribute('data-key'));
    // internals stay unkeyed
    expect(document.querySelector('circle')!.getAttribute('data-key')).toBeNull();
  });

  it('svg inside a drawn-shape wrapper is NOT scanned (pen/shape editing owns it)', () => {
    document.body.innerHTML =
      '<div id="sq-components"><div data-key="element-123" data-drawn="true">' +
      '<svg viewBox="0 0 100 100"><path d="M0 0 L100 100"></path></svg>' +
      '</div></div>';
    const bridge = mount();
    bridge.scanElements(0, null);

    expect(document.querySelector('svg')!.getAttribute('data-key')).toBeNull();
    expect(scannedKeys(bridge)).toContain('element-123');
  });

  it('nested <svg> is NOT scanned', () => {
    document.body.innerHTML =
      '<div id="sq-components"><div data-key="root-a">' +
      '<svg id="outer"><svg id="inner"></svg></svg>' +
      '</div></div>';
    const bridge = mount();
    bridge.scanElements(0, null);

    expect(document.getElementById('outer')!.getAttribute('data-key')).toBeTruthy();
    expect(document.getElementById('inner')!.getAttribute('data-key')).toBeNull();
  });

  it('class updates land on svg via setAttribute (SVGElement.className is read-only)', () => {
    document.body.innerHTML =
      '<div id="sq-components"><div data-key="el-1">' +
      '<svg data-key="el-1:svg-0"></svg></div></div>';
    const bridge = mount() as ScanBridge & {
      handleUpdateInstanceOverride: (p: Record<string, unknown>) => void;
    };
    bridge.handleUpdateInstanceOverride({
      instanceId: 'el-1',
      selector: 'svg-0',
      classes: 'fill-red-500 w-24',
    });
    expect(document.querySelector('svg')!.getAttribute('class')).toBe('fill-red-500 w-24');
  });
});
