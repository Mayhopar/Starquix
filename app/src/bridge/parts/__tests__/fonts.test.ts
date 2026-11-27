import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

function mountFontsBridge() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bridge = mountBridgeForTest() as any;
  bridge._assetMap = {};
  bridge._pendingAssetClasses = {};
  bridge._pendingAssetImages = {};
  return bridge;
}

describe('handleSetFontsCss', () => {
  beforeEach(() => {
    resetHarnessDom();
    // jsdom lacks URL.createObjectURL — emulate the iframe-origin blob URL.
    let n = 0;
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => `blob:sq-test/${++n}`),
    }));
  });

  it('injects #sq-fonts style with sq-asset refs resolved from _assetMap', () => {
    const bridge = mountFontsBridge();
    bridge._assetMap['a1'] = 'blob:fake-url';
    bridge.handleSetFontsCss({ css: "@font-face{font-family:'Inter';src:url('sq-asset:a1');}" });
    const style = document.getElementById('sq-fonts');
    expect(style?.textContent).toContain("url('blob:fake-url')");
    expect(style?.textContent).not.toContain('sq-asset:');
  });

  it('re-resolves after TRANSFER_ASSET arrives (asset lands late)', () => {
    const bridge = mountFontsBridge();
    bridge.handleSetFontsCss({ css: "src:url('sq-asset:0f0e0d0c-1111-2222-3333-444455556666')" });
    expect(document.getElementById('sq-fonts')?.textContent).toContain('sq-asset:');
    bridge.handleTransferAsset({
      assetId: '0f0e0d0c-1111-2222-3333-444455556666',
      arrayBuffer: new ArrayBuffer(4), mimeType: 'font/woff2',
    });
    expect(document.getElementById('sq-fonts')?.textContent).toContain('blob:');
  });

  it('ignores malformed payloads', () => {
    const bridge = mountFontsBridge();
    bridge.handleSetFontsCss(null);
    bridge.handleSetFontsCss({});
    expect(document.getElementById('sq-fonts')).toBeNull();
  });

  it('same resolved CSS twice → textContent assigned once (task-120 FOUT guard)', () => {
    const bridge = mountFontsBridge();
    const css = "@font-face{font-family:'Inter';src:url('/f.woff2');}";
    bridge.handleSetFontsCss({ css });
    // Poke the node: if the guard skips, this marker survives the re-send.
    const style = document.getElementById('sq-fonts')!;
    style.textContent = 'MARKER';
    bridge.handleSetFontsCss({ css });
    expect(style.textContent).toBe('MARKER');
    // A genuinely different CSS still updates.
    bridge.handleSetFontsCss({ css: '@font-face{font-family:X;}' });
    expect(style.textContent).toBe('@font-face{font-family:X;}');
  });
});

describe('reportFontFamilies', () => {
  it('posts FONT_FAMILIES with each declared face family, Chrome quotes stripped', () => {
    const bridge = mountFontsBridge();
    const faces = [{ family: '"Open Sans"' }, { family: 'Open Sans' }, { family: "'My Brand'" }, { family: '' }];
    Object.defineProperty(document, 'fonts', { value: faces, configurable: true });
    bridge.reportFontFamilies();
    expect(bridge.sendToParent).toHaveBeenLastCalledWith({ type: 'FONT_FAMILIES', payload: { fontFamilies: ['Open Sans', 'Open Sans', 'My Brand'] } });
  });

  it('no FontFaceSet → empty list', () => {
    const bridge = mountFontsBridge();
    Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
    bridge.reportFontFamilies();
    expect(bridge.sendToParent).toHaveBeenLastCalledWith({ type: 'FONT_FAMILIES', payload: { fontFamilies: [] } });
  });

  it('a <head> change (CSS tab, CSS HMR) re-reports after a short settle', async () => {
    vi.useFakeTimers();
    try {
      const bridge = mountFontsBridge();
      Object.defineProperty(document, 'fonts', { value: [{ family: 'Brand' }], configurable: true });
      bridge.watchFontFamilies();
      document.head.appendChild(document.createElement('style'));
      await Promise.resolve();
      vi.advanceTimersByTime(300);
      expect(bridge.sendToParent).toHaveBeenLastCalledWith({ type: 'FONT_FAMILIES', payload: { fontFamilies: ['Brand'] } });
    } finally { vi.useRealTimers(); }
  });
});
