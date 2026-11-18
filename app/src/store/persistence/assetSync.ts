// Asset byte sync (cloud-tier task-087b) — the bytes companion to SyncClient.
// The Y.Doc carries canonical sq-asset:<id> refs only (task-093 invariant:
// className/Yjs never hold blob URLs); this module moves the BYTES:
// device A pushes on upload (useAssetUpload), device B pulls refs it lacks
// locally into db.assets on open (useProjectSync, after SyncClient.whenReady)
// so the existing TRANSFER_ASSET replay + rehydration paths work unchanged.
import * as Y from 'yjs';
import { db, getAssetBlob } from '@/db';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import type { SyncConfig } from './SyncClient';

/** Mirrors the server's asset ID_RE. */
const REF_RE = /sq-asset:([A-Za-z0-9._-]{1,128})/g;

/** One warn per session — a dead sync server must not spam per-asset errors. */
let warnedPushFailure = false;
export function resetAssetPushWarningForTests(): void {
  warnedPushFailure = false;
}

/**
 * Best-effort byte upload. The bytes are durable locally either way; any push
 * the server did NOT ack (thrown connection failure OR non-ok response) marks
 * the db.assets row pendingSync so flushPendingAssets re-uploads it on the
 * next sync connection. Returns true when the server acked the bytes.
 */
export async function pushAsset(assetId: string, blob: Blob, cfg: SyncConfig): Promise<boolean> {
  let acked = false;
  try {
    const res = await fetch(`${cfg.url}/assets/${encodeURIComponent(assetId)}`, {
      method: 'PUT',
      body: await blob.arrayBuffer(),
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': blob.type || 'application/octet-stream',
      },
    });
    acked = res.ok;
  } catch {
    if (!warnedPushFailure) {
      warnedPushFailure = true;
      console.warn('[assetSync] sync server unreachable — asset kept locally, will re-upload on next sync connection');
    }
  }
  if (!acked) {
    try {
      await db.assets.update(assetId, { pendingSync: 1 });
    } catch {
      // IndexedDB unavailable — local-first, stay silent
    }
  }
  return acked;
}

/**
 * Re-upload assets whose earlier push was never acked. Runs at the start of
 * syncAssets, i.e. on the next open with a live sync connection.
 * ponytail: one attempt per asset per open, no backoff — until that bites.
 */
export async function flushPendingAssets(projectId: string, cfg: SyncConfig): Promise<void> {
  try {
    const pending = await db.assets
      .where('projectId')
      .equals(projectId)
      .filter((a) => a.pendingSync === 1)
      .toArray();
    for (const a of pending) {
      if (await pushAsset(a.id, getAssetBlob(a), cfg)) {
        await db.assets.update(a.id, { pendingSync: undefined });
      }
    }
  } catch {
    // IndexedDB unavailable — stay silent
  }
}

/**
 * All sq-asset ids the doc references. Scans the encoded update: refs are
 * always written as whole map-value strings (class strings, image attrs), so
 * they appear contiguous in the UTF-8 bytes — no per-map enumeration needed.
 * ponytail: would miss a ref split across Y.Text character edits; no such
 * write path exists (sourceText never holds asset refs).
 */
export function collectAssetRefs(doc: Y.Doc): Set<string> {
  const text = new TextDecoder().decode(Y.encodeStateAsUpdate(doc));
  return new Set([...text.matchAll(REF_RE)].map((m) => m[1]));
}

/**
 * Device-B pull: fetch every referenced asset missing from db.assets, store
 * it under this project, and hand the bytes to the iframe once (same one-shot
 * hand-off as upload — the rehydration sweep has usually already run by the
 * time these arrive). Never overwrites an existing local row. All failures
 * are silent and per-asset; the next open retries.
 */
export async function syncAssets(projectId: string, doc: Y.Doc, cfg: SyncConfig): Promise<void> {
  await flushPendingAssets(projectId, cfg);
  for (const id of collectAssetRefs(doc)) {
    try {
      if (await db.assets.get(id)) continue;
      const res = await fetch(`${cfg.url}/assets/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) continue;
      const blob = await res.blob();
      await db.assets.add({
        id,
        projectId,
        name: id,
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
        blob,
        createdAt: new Date(),
      });
      await transferAssetToIframe(id, blob);
    } catch {
      // offline / IndexedDB unavailable — local-first, stay silent
    }
  }
}
