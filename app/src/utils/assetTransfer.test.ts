/**
 * assetTransfer Tests (task-011)
 *
 * Verifies the SYNC_ASSET_TO_IFRAME message contract:
 * - posts to window.self (same origin) so ViewportFrame's listener can pick it up
 *   and double-hop the buffer to the iframe as TRANSFER_ASSET
 * - the payload carries assetId, the blob's bytes as ArrayBuffer, and the mimeType
 *
 * The double-hop matters because Yjs stores compact `sq-asset:{id}` refs, but
 * bridge.js needs the actual bytes to construct an iframe-origin blob URL.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import {
  transferAssetToIframe,
  markAssetRelayReady,
  markAssetRelayTorndown,
  resetAssetRelayForTests,
} from './assetTransfer';

// jsdom's Blob does not implement arrayBuffer() in this Node version — polyfill.
beforeAll(() => {
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Blob.prototype as any).arrayBuffer = function arrayBuffer(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

describe('transferAssetToIframe', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy?.mockRestore();
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    // These tests cover the message contract with the relay mounted
    // (the pre-task-049 behavior, preserved when ready).
    resetAssetRelayForTests();
    markAssetRelayReady();
  });

  it('posts SYNC_ASSET_TO_IFRAME to window with assetId, ArrayBuffer, and mimeType', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blob = new Blob([bytes], { type: 'image/png' });

    await transferAssetToIframe('asset-123', blob);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessageSpy.mock.calls[0] as [
      { type: string; payload: { assetId: string; arrayBuffer: ArrayBuffer; mimeType: string } },
      string,
    ];
    expect(message.type).toBe('SYNC_ASSET_TO_IFRAME');
    expect(message.payload.assetId).toBe('asset-123');
    expect(message.payload.mimeType).toBe('image/png');
    expect(message.payload.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(message.payload.arrayBuffer)).toEqual(bytes);
    // Wildcard origin so the message reaches same-window listeners regardless of port.
    expect(targetOrigin).toBe('*');
  });

  it('forwards an empty blob without throwing (zero-byte ArrayBuffer)', async () => {
    const blob = new Blob([], { type: 'image/jpeg' });
    await transferAssetToIframe('empty-asset', blob);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const message = postMessageSpy.mock.calls[0][0] as { payload: { arrayBuffer: ArrayBuffer; mimeType: string } };
    expect(message.payload.arrayBuffer.byteLength).toBe(0);
    expect(message.payload.mimeType).toBe('image/jpeg');
  });

  it('passes the blob.type through verbatim as mimeType', async () => {
    const blob = new Blob([new Uint8Array([0xff])], { type: 'image/svg+xml' });
    await transferAssetToIframe('svg-asset', blob);

    const message = postMessageSpy.mock.calls[0][0] as { payload: { mimeType: string } };
    // bridge.js uses this to construct the iframe-origin Blob — must match exactly.
    expect(message.payload.mimeType).toBe('image/svg+xml');
  });
});

/**
 * Relay gate (task-049, invariants II-1/II-2): the SYNC_ASSET_TO_IFRAME hop
 * only works while ViewportFrame's relay listener is mounted. Before this
 * gate, a transfer fired before mount was SILENTLY lost. Now it warns and
 * queues; markAssetRelayReady() (called by ViewportFrame when the listener
 * mounts) flushes the queue exactly once.
 */
describe('asset relay gate (II-1/II-2)', () => {
  let postMessageSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const bytes = new Uint8Array([9, 8, 7]);

  beforeEach(() => {
    postMessageSpy?.mockRestore();
    warnSpy?.mockRestore();
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // spyOn on an already-spied method returns the existing spy — drop any
    // call history carried over from the contract describe above.
    postMessageSpy.mockClear();
    warnSpy.mockClear();
    resetAssetRelayForTests();
  });

  it('warns and queues when no relay listener is registered (no silent drop)', async () => {
    await transferAssetToIframe('asset-1', new Blob([bytes], { type: 'image/png' }));

    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[assetTransfer]'),
      'asset-1',
    );
  });

  it('flushes queued transfers exactly once when the relay becomes ready', async () => {
    await transferAssetToIframe('asset-1', new Blob([bytes], { type: 'image/png' }));
    expect(postMessageSpy).not.toHaveBeenCalled();

    markAssetRelayReady();

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const message = postMessageSpy.mock.calls[0][0] as {
      type: string;
      payload: { assetId: string; arrayBuffer: ArrayBuffer; mimeType: string };
    };
    expect(message.type).toBe('SYNC_ASSET_TO_IFRAME');
    expect(message.payload.assetId).toBe('asset-1');
    expect(new Uint8Array(message.payload.arrayBuffer)).toEqual(bytes);

    // Re-marking ready must not re-send (no duplicate delivery — II-2).
    markAssetRelayReady();
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('queues multiple transfers and flushes them in order', async () => {
    await transferAssetToIframe('asset-1', new Blob([bytes], { type: 'image/png' }));
    await transferAssetToIframe('asset-2', new Blob([bytes], { type: 'image/jpeg' }));

    markAssetRelayReady();

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
    const ids = postMessageSpy.mock.calls.map(
      (c) => (c[0] as { payload: { assetId: string } }).payload.assetId,
    );
    expect(ids).toEqual(['asset-1', 'asset-2']);
  });

  it('transfers immediately when relay already ready (existing behavior preserved)', async () => {
    markAssetRelayReady();

    await transferAssetToIframe('asset-1', new Blob([bytes], { type: 'image/png' }));

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('queues again after teardown (relay unmounted)', async () => {
    markAssetRelayReady();
    markAssetRelayTorndown();

    await transferAssetToIframe('asset-1', new Blob([bytes], { type: 'image/png' }));
    expect(postMessageSpy).not.toHaveBeenCalled();

    markAssetRelayReady();
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });
});
