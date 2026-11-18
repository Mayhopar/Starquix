/**
 * task-120 Phase 2 — stable asset identity. One blob URL per asset id for
 * the iframe's lifetime: re-transfer with identical bytes is a no-op (URL
 * survives, no stylesheet/DOM rewrite); byte change revokes + re-mints.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type AssetBridge = HarnessBridge & {
  _assetMap: Record<string, string>;
  _assetHashes: Record<string, string>;
  _pendingAssetClasses: Record<string, unknown>;
  _pendingAssetImages: Record<string, unknown>;
  updateAssetStyleSheet: () => void;
  resolveAssetRefsInDOM: () => void;
};

function bytes(...vals: number[]): ArrayBuffer {
  return new Uint8Array(vals).buffer;
}

function mountAssetBridge(): AssetBridge {
  const bridge = mountBridgeForTest() as AssetBridge;
  bridge._assetMap = {};
  bridge._pendingAssetClasses = {};
  bridge._pendingAssetImages = {};
  return bridge;
}

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;

describe('hash-guarded asset transfer', () => {
  beforeEach(() => {
    resetHarnessDom();
    let n = 0;
    createSpy = vi.fn(() => `blob:sq-test/${++n}`);
    revokeSpy = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    }));
  });

  it('same bytes twice → one createObjectURL, URL stays stable, no revoke', () => {
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3), mimeType: 'image/png' });
    const url = bridge._assetMap['a1'];

    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3), mimeType: 'image/png' });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(bridge._assetMap['a1']).toBe(url);
  });

  it('no-op path skips the stylesheet + DOM rewrite', () => {
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3), mimeType: 'image/png' });

    const styleSpy = vi.fn();
    const domSpy = vi.fn();
    bridge.updateAssetStyleSheet = styleSpy;
    bridge.resolveAssetRefsInDOM = domSpy;

    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3), mimeType: 'image/png' });

    expect(styleSpy).not.toHaveBeenCalled();
    expect(domSpy).not.toHaveBeenCalled();
  });

  it('different bytes → old URL revoked, new URL minted, rewrites run', () => {
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3), mimeType: 'image/png' });
    const oldUrl = bridge._assetMap['a1'];

    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(9, 9, 9), mimeType: 'image/png' });

    expect(revokeSpy).toHaveBeenCalledWith(oldUrl);
    expect(bridge._assetMap['a1']).not.toBe(oldUrl);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });

  it('same length but different content is a byte change (hash covers content)', () => {
    const bridge = mountAssetBridge();
    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3, 4), mimeType: 'image/png' });
    bridge.handleTransferAsset({ assetId: 'a1', arrayBuffer: bytes(1, 2, 3, 5), mimeType: 'image/png' });
    expect(createSpy).toHaveBeenCalledTimes(2);
  });
});
