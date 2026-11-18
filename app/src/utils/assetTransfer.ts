/**
 * Transfer an asset blob to the iframe via the SYNC_ASSET_TO_IFRAME window message.
 * ViewportFrame listens for this and forwards it as TRANSFER_ASSET to the iframe,
 * where bridge.js creates an iframe-origin blob URL.
 *
 * Relay gate (task-049, II-1/II-2): the hop only works while ViewportFrame's
 * forwarder listener is mounted. Transfers fired before mount used to be
 * SILENTLY lost; now they warn and queue, and markAssetRelayReady() (called
 * by ViewportFrame when the listener mounts) flushes the queue exactly once.
 * This gates the single existing postMessage callsite — it is NOT a second
 * transfer path (see systems.json image-upload no-duplicate-callsite rule).
 */

type PendingTransfer = { assetId: string; arrayBuffer: ArrayBuffer; mimeType: string };

let relayReady = false;
const pendingTransfers: PendingTransfer[] = [];

function postTransfer(transfer: PendingTransfer): void {
  // task-120: transfer the buffer on the same-window hop too — the
  // ViewportFrame forwarder re-transfers it into the iframe, so the bytes
  // are never structured-cloned (they used to be cloned twice per asset).
  window.postMessage({
    type: 'SYNC_ASSET_TO_IFRAME',
    payload: transfer,
  }, '*', [transfer.arrayBuffer]);
}

/** ViewportFrame calls this when its SYNC_ASSET_TO_IFRAME relay listener mounts. */
export function markAssetRelayReady(): void {
  relayReady = true;
  while (pendingTransfers.length > 0) {
    postTransfer(pendingTransfers.shift()!);
  }
}

/** ViewportFrame calls this when the relay listener unmounts. */
export function markAssetRelayTorndown(): void {
  relayReady = false;
}

export function resetAssetRelayForTests(): void {
  relayReady = false;
  pendingTransfers.length = 0;
}

export async function transferAssetToIframe(assetId: string, blob: Blob): Promise<void> {
  const arrayBuffer = await blob.arrayBuffer();
  const transfer: PendingTransfer = { assetId, arrayBuffer, mimeType: blob.type };

  if (!relayReady) {
    console.warn('[assetTransfer] relay not mounted — queueing asset transfer', assetId);
    pendingTransfers.push(transfer);
    return;
  }

  postTransfer(transfer);
}
