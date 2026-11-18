/**
 * Files-truth sync (Phase 3 Task 3.5): `projectFiles` rows ride the existing
 * asset-byte channel (task-087b: `PUT/GET {url}/assets/{id}`, Bearer). The
 * Y.Doc of a files-truth project is NEVER synced — it is a session copy.
 *
 *  - blob per file: id `pf-{projectId}-{djb2(path)}`; a manifest blob
 *    `pf-{projectId}-manifest` = { [path]: updatedAt } is the index.
 *  - push: every row with pendingSync (after each write-through pull); the
 *    manifest is rewritten after the files land. Unacked → stays pending.
 *  - pull (at open, before the container mounts): remote entries newer than
 *    the local row (or missing locally) are fetched; last-writer-wins on
 *    updatedAt. ponytail: no remote deletes yet — a file deleted on A stays
 *    on B until B deletes it (upgrade: tombstones in the manifest).
 */
import { db } from '@/db';
import { putProjectFiles } from '@/db/projectFiles';
import type { SyncConfig } from './SyncClient';

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export const fileBlobId = (projectId: string, path: string): string => `pf-${projectId}-${djb2(path)}`;
export const manifestId = (projectId: string): string => `pf-${projectId}-manifest`;

type Manifest = Record<string, number>;

async function getBlob(cfg: SyncConfig, id: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${cfg.url}/assets/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

async function putBlob(cfg: SyncConfig, id: string, bytes: Uint8Array, type = 'application/octet-stream'): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.url}/assets/${encodeURIComponent(id)}`, {
      method: 'PUT', body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': type },
    });
    return res.ok;
  } catch { return false; }
}

async function readManifest(cfg: SyncConfig, projectId: string): Promise<Manifest> {
  const bytes = await getBlob(cfg, manifestId(projectId));
  if (!bytes) return {};
  try { return JSON.parse(new TextDecoder().decode(bytes)) as Manifest; } catch { return {}; }
}

/** Push every pending row, then the manifest. Returns the number acked. */
export async function pushProjectFiles(projectId: string, cfg: SyncConfig): Promise<number> {
  const rows = await db.projectFiles.where('projectId').equals(projectId).toArray();
  const pending = rows.filter((r) => r.pendingSync);
  if (pending.length === 0) return 0;
  let acked = 0;
  for (const r of pending) {
    if (await putBlob(cfg, fileBlobId(projectId, r.path), r.content)) {
      acked++;
      await db.projectFiles.update(r.id, { pendingSync: undefined });
    }
  }
  const remote = await readManifest(cfg, projectId);
  const manifest: Manifest = { ...remote };
  for (const r of rows) if (!r.pendingSync || acked) manifest[r.path] = Math.max(manifest[r.path] ?? 0, r.updatedAt ?? 0);
  await putBlob(cfg, manifestId(projectId), new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
  return acked;
}

/** Pull remote rows newer than local (or missing locally). Returns paths written. */
export async function pullProjectFiles(projectId: string, cfg: SyncConfig): Promise<string[]> {
  const remote = await readManifest(cfg, projectId);
  const local = new Map((await db.projectFiles.where('projectId').equals(projectId).toArray()).map((r) => [r.path, r]));
  const written: string[] = [];
  for (const [path, remoteAt] of Object.entries(remote)) {
    const row = local.get(path);
    if (row && (row.updatedAt ?? 0) >= remoteAt) continue;
    const bytes = await getBlob(cfg, fileBlobId(projectId, path));
    if (!bytes) continue;
    await putProjectFiles(projectId, [{ path, content: bytes, updatedAt: remoteAt }], { fromSync: true });
    written.push(path);
  }
  return written;
}
