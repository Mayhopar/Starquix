import { prepareSourceCommand, readSourceState, rebaseEdit } from './commandReceipts';
import type { DurableFileChange } from './types';
import { db } from '@/db';
import { laneMemo, listProjectRows } from './store';
import { pm } from '@/utils/probeMark';

// Used only by read-only owner planning in the serialized acceptance lane.
// The worker always reads real source and applies the original receipt CAS.
const planning = new Map<string, Map<string, DurableFileChange>>();
// Last accepted bytes of MATERIALIZED rows — a fallback for a runtime that
// cannot be read right now (offline undo keeps its baseline), never the
// baseline while the disk answers: files are truth.
// Built LAZILY (only when a read actually fails): it costs one receipt get per command of every materialized row.
const retained = new Map<string, () => Promise<Map<string, DurableFileChange>>>();
export function hasProjectedSource(projectId: string): boolean { return planning.has(projectId); }

export function projectedSourceFiles(projectId: string): DurableFileChange[] {
  return [...(planning.get(projectId)?.values() ?? [])];
}

export async function readProjectedSourceState(projectId: string, file: string, encoding?: 'base64'): Promise<string | null> {
  const files = planning.get(projectId);
  if (files?.has(file)) return files.get(file)!.afterSource;
  // One disk read per file per acceptance slot (laneMemo); outside a slot every call reads.
  return laneMemo(projectId, `disk:${file}:${encoding ?? ''}`, async () => {
    try { return await readSourceState(projectId, file, encoding); }
    catch (error) {
      const fallback = (await retained.get(projectId)?.())?.get(file);
      if (fallback) return fallback.afterSource;
      throw error;
    }
  });
}

/** Reconstruct the accepted prefix from immutable command receipts, without
 * dispatching or waiting for an ACK. Preparing a pending command binds its
 * original before/after evidence early; it never changes its accepted intent. */
export async function withProjectedSource<T>(projectId: string, through: number, run: () => Promise<T>): Promise<T> {
  if (planning.has(projectId)) throw new Error('Nested source planning is not allowed');
  const files = new Map<string, DurableFileChange>();
  // Files are truth: a MATERIALIZED row already lives on disk, so the DISK is
  // its baseline — its retained afterSource only stands in when the runtime
  // cannot be read (offline undo). Owner 2026-09-16: a Push wrote Feature.astro
  // outside this journal; seeding the baseline from the stale row failed every
  // later structural op on the file ('Source target version does not match
  // the projected source baseline'). Rows still waiting for the worker are
  // projected on top of the disk read.
  // Freeze the accepted rows once: the worker can materialize a pending row
  // while earlier receipts load, but that row must not fall between queries.
  pm('ps:start');
  const rows = await listProjectRows(projectId, through); // the slot's one journal read (memoized in a lane scope)
  pm('ps:rows', () => ({ n: rows.length, mat: rows.filter(r => r.materializedAt !== null).length }));
  let kept: Promise<Map<string, DurableFileChange>> | null = null;
  retained.set(projectId, () => kept ??= (async () => {
    pm('ps:mat', () => ({ rc: rows.reduce((n, r) => n + (r.materializedAt !== null ? r.commands.length : 0), 0) })); // one receipt get per command of every materialized row
    const map = new Map<string, DurableFileChange>();
    for (const row of rows.filter(row => row.materializedAt !== null)) for (const [index, command] of row.commands.entries()) {
      const changes = command.kind === 'file-batch' ? command.payload.files
        : (await db.durableCommandReceipts.get([projectId, JSON.stringify([row.operationId, index])]))?.prepared.files;
      for (const change of changes ?? []) map.set(change.file, change);
    }
    return map;
  })());
  const read = async (file: string, encoding?: 'base64') => files.has(file)
    ? files.get(file)!.afterSource : readProjectedSourceState(projectId, file, encoding);
  // Ledger C (agent multiplayer, 2026-11-08): an outside writer may have moved
  // a file under a row still waiting for the worker — project the row
  // re-applied onto those bytes, as the worker will write it (the disk is the
  // newer side here; a newer undo may still win at the worker and converges on
  // the next read). An unreadable runtime keeps the accepted bytes (C4).
  const land = async (changes: DurableFileChange[]) => {
    const found: Array<{ change: DurableFileChange; current: string | null; mtime: null }> = [];
    for (const change of changes) {
      try { found.push({ change, current: await read(change.file, change.encoding), mtime: null }); }
      catch { for (const kept of changes) files.set(kept.file, kept); return; }
    }
    for (const change of await rebaseEdit(projectId, '', found)) files.set(change.file, change);
  };
  for (const row of rows.filter(row => row.materializedAt === null)) {
    for (const [index, command] of row.commands.entries()) {
      // Accepted exact bytes are the editor's truth, re-applied onto whatever
      // an outside writer put under them. Reading this projection must not run
      // the worker's CAS or require a preparation receipt.
      const acceptedFiles = command.kind === 'file-batch' ? command.payload.files
        : 'preparedFiles' in command.payload ? command.payload.preparedFiles : undefined;
      if (acceptedFiles) {
        await land(acceptedFiles);
        continue;
      }
      switch (command.kind) {
        case 'class-write': case 'source-batch': case 'structural-write':
        case 'file-batch': case 'layout-append': case 'receipt-replay':
        case 'variables-css': case 'post-write': case 'folder-manifest': break;
        default: continue; // Other adapters do not implement source preparations.
      }
      const prepared = await prepareSourceCommand(projectId, JSON.stringify([row.operationId, index]), command, { read });
      await land(prepared.files ?? [{ file: prepared.file, beforeSource: prepared.beforeSource, afterSource: prepared.afterSource }]);
    }
  }
  pm('ps:unmat');
  planning.set(projectId, files);
  try { return await run(); } finally { pm('ps:run-end'); planning.delete(projectId); retained.delete(projectId); }
}
