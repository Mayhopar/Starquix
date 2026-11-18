// Local-first persistence for the editor Y.Doc (cloud-tier Phase 1, task-086).
// Wraps y-indexeddb so the doc auto-persists locally and survives reloads
// offline. One IndexedDB database per project: `sq-doc:{projectId}`.
// Design: docs/plans/2026-06-21-cloud-tier-phase1-local-first-foundation.md
import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

export interface LocalPersistenceHandle {
  /** Resolves once the doc has loaded whatever was stored locally. */
  whenSynced: Promise<void>;
  destroy: () => void;
}

const DB_PREFIX = 'sq-doc:';

export function localDocName(projectId: string): string {
  return `${DB_PREFIX}${projectId}`;
}

export async function bindLocalPersistence(
  projectId: string,
  doc: Y.Doc
): Promise<LocalPersistenceHandle> {
  const provider = new IndexeddbPersistence(localDocName(projectId), doc);
  const whenSynced = new Promise<void>((resolve) =>
    provider.once('synced', () => resolve())
  );
  return { whenSynced, destroy: () => provider.destroy() };
}

/**
 * True if a y-indexeddb database already exists for this project (i.e. the
 * project has been migrated to doc persistence). Uses indexedDB.databases();
 * where unsupported (old Safari), falls back to false — the caller then runs
 * the legacy import, which is idempotent for an already-migrated doc only
 * because the migration flag inside the doc is checked again after sync.
 */
export async function hasLocalDoc(projectId: string): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return false;
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === localDocName(projectId));
}
