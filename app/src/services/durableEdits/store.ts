import Dexie from 'dexie';
import { db } from '@/db';
import type { DBDurableEditCheckpoint } from '@/db/types';
import type {
  AcceptedEdit,
  DurableProjectState,
  MaterializationReceipt,
  NewDurableEdit,
  StoredDurableEdit,
} from './types';

const initialProjectState = (projectId: string): DurableProjectState => ({
  projectId,
  acceptedRevision: 0,
  materializedRevision: 0,
});

export async function acceptStoredEdit(input: NewDurableEdit): Promise<AcceptedEdit> {
  return db.transaction(
    'rw',
    db.durableEdits,
    db.durableProjectState,
    db.durableEditCheckpoints,
    async () => {
      const id = `${input.projectId}:${input.operationId}`;
      const checkpoint = await db.durableEditCheckpoints.get(id);
      if (checkpoint) return { operationId: checkpoint.operationId, revision: checkpoint.revision };

      const existing = await db.durableEdits.get(id);
      if (existing) {
        await db.durableEditCheckpoints.put({
          id,
          projectId: existing.projectId,
          operationId: existing.operationId,
          revision: existing.revision,
        });
        return { operationId: existing.operationId, revision: existing.revision };
      }

      const state = await db.durableProjectState.get(input.projectId)
        ?? initialProjectState(input.projectId);
      const revision = state.acceptedRevision + 1;
      const row: StoredDurableEdit = {
        ...input,
        id,
        revision,
        materializedAt: null,
      };
      const accepted: DBDurableEditCheckpoint = {
        id,
        projectId: input.projectId,
        operationId: input.operationId,
        revision,
      };

      await db.durableProjectState.put({ ...state, acceptedRevision: revision });
      await db.durableEditCheckpoints.add(accepted);
      await db.durableEdits.add(row);
      return { operationId: input.operationId, revision };
    },
  );
}

export async function listUnmaterialized(
  projectId: string,
  afterRevision = 0,
): Promise<StoredDurableEdit[]> {
  return db.durableEdits
    .where('[projectId+revision]')
    .between([projectId, afterRevision], [projectId, Dexie.maxKey], false, true)
    .filter(row => row.materializedAt === null)
    .toArray();
}

/** The rows that can still be pending: everything after the contiguous
 * materialized prefix (recordMaterialization only advances `materializedRevision`
 * over rows with `materializedAt` set). Same answer as `listUnmaterialized(id)`,
 * but a live query over it does not re-read the whole journal on every accepted
 * edit and every materialization. */
export async function listPendingRows(projectId: string): Promise<StoredDurableEdit[]> {
  return listUnmaterialized(projectId, (await getDurableProjectState(projectId)).materializedRevision);
}

// ── Per-slot read memo ─────────────────────────────────────────────────────
// The acceptance lane is strictly sequential per project and is the only appender
// of journal rows (acceptStoredEdit has one caller). While a slot is preparing
// (its scope is open) the accepted rows, the evidence derived from them and the
// source bytes it reads cannot change in a way the slot depends on: rows are
// immutable except `materializedAt`, and a row materialized mid-slot is projected
// as pending and re-applied onto bytes that already contain it. So every reader
// shares ONE read per slot instead of repeating a journal scan per question.
// The scope closes BEFORE acceptStoredEdit appends; outside a scope nothing is memoized.
const laneScopes = new Map<string, Map<string, Promise<unknown>>>();

export function openLaneReadScope(projectId: string): void {
  laneScopes.set(projectId, new Map());
}
export function closeLaneReadScope(projectId: string): void {
  laneScopes.delete(projectId);
}

/** `make()` once per open lane scope and key; every call outside a scope runs `make()` itself. */
export function laneMemo<T>(projectId: string, key: string, make: () => Promise<T>): Promise<T> {
  const scope = laneScopes.get(projectId);
  if (!scope) return make();
  const known = scope.get(key) as Promise<T> | undefined;
  if (known) return known;
  const made = make();
  scope.set(key, made);
  // A failed read must not poison the rest of the slot.
  made.catch(() => { if (scope.get(key) === made) scope.delete(key); });
  return made;
}

/** Every accepted row of the project in revision order (callers must not mutate it). */
export function listProjectRows(projectId: string, through = Infinity): Promise<StoredDurableEdit[]> {
  const rows = laneMemo(projectId, 'rows', () => db.durableEdits.where('projectId').equals(projectId).sortBy('revision'));
  return through === Infinity ? rows : rows.then(all => all.filter(row => row.revision <= through));
}

export async function recordMaterialization(receipt: MaterializationReceipt): Promise<void> {
  await db.transaction('rw', db.durableEdits, db.durableProjectState, async () => {
    const id = `${receipt.projectId}:${receipt.operationId}`;
    const row = await db.durableEdits.get(id);
    if (!row) throw new Error(`Durable edit not found: ${id}`);

    if (row.materializedAt === null) {
      // Preserve the immutable binary payload verbatim. Dexie's modify/update
      // path deep-clones cross-realm typed arrays into plain numeric objects.
      await db.durableEdits.put({ ...row, materializedAt: receipt.materializedAt });
    }

    const state = await db.durableProjectState.get(receipt.projectId)
      ?? initialProjectState(receipt.projectId);
    let materializedRevision = state.materializedRevision;
    while (materializedRevision < state.acceptedRevision) {
      const next = await db.durableEdits
        .where('[projectId+revision]')
        .equals([receipt.projectId, materializedRevision + 1])
        .first();
      if (!next || next.materializedAt === null) break;
      materializedRevision = next.revision;
    }

    if (materializedRevision !== state.materializedRevision) {
      await db.durableProjectState.put({ ...state, materializedRevision });
    }
  });
}

export async function getDurableProjectState(projectId: string): Promise<DurableProjectState> {
  return await db.durableProjectState.get(projectId) ?? initialProjectState(projectId);
}

export async function compactDurableEdits(
  projectId: string,
  throughRevision: number,
): Promise<void> {
  await db.transaction(
    'rw',
    db.durableEdits,
    db.durableProjectState,
    db.durableEditCheckpoints,
    async () => {
      const state = await db.durableProjectState.get(projectId) ?? initialProjectState(projectId);
      if (throughRevision > state.materializedRevision) {
        throw new Error(
          `Cannot compact durable edits past materialized revision ${state.materializedRevision}`,
        );
      }

      const rows = await db.durableEdits
        .where('[projectId+revision]')
        .between([projectId, Dexie.minKey], [projectId, throughRevision], true, true)
        .toArray();
      // Source identity, selector baselines, scan restoration and Undo still
      // discover their evidence through these rows, even after materialization.
      // The operation-ID checkpoint below preserves deduplication only. Until
      // source ownership has its own durable checkpoint, fail closed rather
      // than silently deleting that evidence (including receipt-backed rows).
      if (rows.some(row => row.commands.some(command => command.kind !== 'asset-write'))) {
        throw new Error('Cannot compact source edits without a source identity checkpoint');
      }
      // No source command does not mean no accepted document state. Only a
      // missing update or Yjs's canonical empty update can be retired without
      // first verifying a durable document checkpoint covers this revision.
      if (rows.some(({ yjsUpdate }) => yjsUpdate != null
        && !(yjsUpdate.byteLength === 2 && yjsUpdate[0] === 0 && yjsUpdate[1] === 0))) {
        throw new Error('Cannot compact document edits without a durable document checkpoint');
      }
      await db.durableEditCheckpoints.bulkPut(rows.map(row => ({
        id: row.id,
        projectId: row.projectId,
        operationId: row.operationId,
        revision: row.revision,
      })));
      await db.durableEdits.bulkDelete(rows.map(row => row.id));
    },
  );
}
