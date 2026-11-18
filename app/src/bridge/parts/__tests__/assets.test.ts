/**
 * Asset pipeline (parts/assets.ts, ported from bridge.js).
 *
 * handleTransferAsset receives an ArrayBuffer from the editor, creates an
 * iframe-origin blob URL in _assetMap, refreshes the sq-asset override
 * stylesheet, and resolves sq-asset: refs already present in the DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type AssetBridge = HarnessBridge & {
  _assetMap: Record<string, string>;
  _pendingAssetClasses: Record<string, unknown>;
  _pendingAssetImages: Record<string, unknown>;
  handleTransferAsset: (payload: {
    assetId: string;
    arrayBuffer: ArrayBuffer;
    mimeType?: string;
  }) => void;
  resolveAssetRef: (value: string) => string;
  resolveAssetRefs: (str: string) => string;
  resolveAssetRefsInDOM: () => void;
  updateAssetStyleSheet: () => void;
};

function mountAssetBridge(): AssetBridge {
  const bridge = mountBridgeForTest() as AssetBridge;
  // Constructor in the harness doesn't run the real bridge constructor —
  // initialize the asset state the way the real constructor does.
  bridge._assetMap = {};
  bridge._pendingAssetClasses = {};
  bridge._pendingAssetImages = {};
  return bridge;
}

describe('asset pipeline', () => {
  beforeEach(() => {
    resetHarnessDom();
    // jsdom lacks URL.createObjectURL — emulate the iframe-origin blob URL.
    let n = 0;
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => `blob:sq-test/${++n}`),
    }));
  });

  it('handleTransferAsset stores a blob URL into _assetMap', () => {
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: 'abc123', arrayBuffer: new ArrayBuffer(4), mimeType: 'image/png' });
    expect(bridge._assetMap['abc123']).toMatch(/^blob:/);
  });

  it('ignores payloads without assetId or arrayBuffer', () => {
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: '', arrayBuffer: new ArrayBuffer(0) });
    expect(Object.keys(bridge._assetMap)).toEqual([]);
  });

  it('resolves an sq-asset: img src already in the DOM', () => {
    document.body.innerHTML = '<img data-key="k1" src="sq-asset:abc123">';
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: 'abc123', arrayBuffer: new ArrayBuffer(4), mimeType: 'image/png' });
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/^blob:/);
  });

  it('updateAssetStyleSheet writes !important bg overrides for every asset', () => {
    const bridge = mountAssetBridge();
    bridge._assetMap['abc123'] = 'blob:sq-test/fixed';
    bridge.updateAssetStyleSheet();
    const style = document.getElementById('sq-asset-overrides')!;
    expect(style.textContent).toContain('sq-asset');
    expect(style.textContent).toContain('blob:sq-test/fixed');
    expect(style.textContent).toContain('!important');
  });

  it('resolveAssetRefs substitutes known ids and leaves unknown ones', () => {
    const bridge = mountAssetBridge();
    bridge._assetMap['aaa111'] = 'blob:sq-test/a';
    expect(bridge.resolveAssetRefs("bg-[url('sq-asset:aaa111')] sq-asset:ffffff"))
      .toBe("bg-[url('blob:sq-test/a')] sq-asset:ffffff");
  });
});
