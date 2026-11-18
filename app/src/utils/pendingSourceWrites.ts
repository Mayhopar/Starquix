/**
 * Deferred source work is accepted immediately. This module exposes navigation
 * boundaries and a read-only count projection; the journal/command receipts own
 * intent, retries and partial results across reloads.
 */
import * as Y from 'yjs';
import { liveQuery } from 'dexie';
import { db } from '@/db';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { listPendingRows } from '@/services/durableEdits/store';
import { flushDurableSourceWrites, registerSourceMaterializers, PartialSourceMaterialization } from '@/services/durableEdits/sourceMaterialization';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import type { MaterializationCommand, AcceptedEdit } from '@/services/durableEdits/types';
import type { SourceWritePayload, SkippedEntry } from './pushOverridesToSource';
import { listenFlushOnHide } from './listenFlushOnHide';

const counts = new Map<string, number>();
const observed = new Set<string>();
const flushBoundaryListeners = new Set<() => void | Promise<void>>();
let hideListenerArmed = false;
function observe(projectId: string) {
  if (observed.has(projectId)) return;
  observed.add(projectId);
  liveQuery(() => listPendingRows(projectId)).subscribe(rows => {
    counts.set(projectId, rows.reduce((n, row) => n + row.commands.filter(command => command.kind === 'source-batch').length, 0));
  });
}

/** Split before acceptance: never aggregate independently receipted files into
 * one command, and never replace an older command with a newer retry payload. */
export function sourceCommands(payloads: SourceWritePayload[], skipped: SkippedEntry[]): MaterializationCommand[] {
  const inputs = structuredClone(payloads);
  const skippedSources = [...new Set(skipped.map(entry => entry.source))];
  for (const source of skippedSources) if (!inputs.some(payload => payload.astroSource === source)) {
    inputs.push({ astroSource: source, overrides: {} });
  }
  return inputs.map(payload => ({ kind: 'source-batch', payload: {
    payloads: [payload], skipped: structuredClone(skipped.filter(entry => entry.source === payload.astroSource)),
    deferUntil: Date.now() + 5000,
  } }));
}

export async function queueSourceWrites(payloads: SourceWritePayload[], skipped: SkippedEntry[], options?: {
  doc: Y.Doc;
  mutate?: (staged: Y.Doc) => void;
  /** Collect destructive positional intent from the same serialized document
   * that is baked/cleared, never from an earlier live-document read. */
  stage?: (staged: Y.Doc) => { payloads: SourceWritePayload[]; skipped: SkippedEntry[] };
}): Promise<AcceptedEdit> {
  const projectId = (options?.doc.getMap('meta').get('projectId') as string | undefined) ?? getActiveSaveProjectId();
  if (!projectId) throw new Error('Project storage is not ready');
  const doc = options?.doc ?? new Y.Doc();
  const captured = structuredClone({ payloads, skipped });
  const commands: MaterializationCommand[] = [];
  observe(projectId); registerSourceMaterializers();
  if (!hideListenerArmed && typeof window !== 'undefined') {
    hideListenerArmed = true;
    listenFlushOnHide(() => { void flushPendingSourceWrites().catch(() => {}); });
  }
  try {
    return await acceptProjectEdit(doc, { projectId, operationId: `source-batch:${crypto.randomUUID()}`,
      commands, mutate: staged => {
        const collected = options?.stage?.(staged) ?? captured;
        options?.mutate?.(staged);
        commands.push(...sourceCommands(collected.payloads, collected.skipped));
      } });
  } finally { if (!options?.doc) doc.destroy(); }
}

export function pendingSourceWriteCount(projectId = getActiveSaveProjectId()): number {
  if (!projectId) return 0;
  observe(projectId);
  return counts.get(projectId) ?? 0;
}

export async function assertNoIncompleteSourceWrites(projectId = getActiveSaveProjectId()): Promise<void> {
  if (!projectId) return;
  const rows = await db.durableCommandReceipts.where('projectId').equals(projectId).toArray();
  for (const row of rows) if (row.outcome?.status === 'partial') {
    throw new PartialSourceMaterialization(projectId, row.commandId, row.outcome.skipped);
  }
}

export function subscribeFlushBoundary(listener: () => void | Promise<void>): () => void {
  flushBoundaryListeners.add(listener);
  return () => { flushBoundaryListeners.delete(listener); };
}
export function armPageSwitchFlushBoundary(
  doc: { on(event: 'update', handler: () => void): void; off(event: 'update', handler: () => void): void },
  getPageId: () => string | null,
): () => void {
  let last = getPageId();
  const onUpdate = () => {
    const now = getPageId(); if (now === last) return; last = now;
    void flushPendingSourceWrites().catch(() => {});
  };
  doc.on('update', onUpdate);
  return () => doc.off('update', onUpdate);
}

/** @deprecated Accepted work cannot be cleared from a module. Tests reset their database. */
export function clearPendingSourceWrites(): void {}

export function flushPendingSourceWrites(opts?: { keepalive?: boolean; projectId?: string }): Promise<void> {
  const projectId = opts?.projectId ?? getActiveSaveProjectId();
  const boundaries = [...flushBoundaryListeners].map(listener => {
    try { return Promise.resolve(listener()); } catch (error) { return Promise.reject(error); }
  });
  if (projectId) boundaries.push(flushDurableSourceWrites(projectId));
  return Promise.all(boundaries).then(() => {});
}
