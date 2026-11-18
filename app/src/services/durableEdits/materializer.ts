import * as durableStore from './store';
import { getDurableEditStatus, subscribeDurableEditStatus } from './status';
import { materializerRegistry, type createMaterializerRegistry, type MaterializerContext } from './registry';
import type { DurableProjectState, MaterializationReceipt, StoredDurableEdit } from './types';
import { pm } from '@/utils/probeMark';

export class MaterializationFailure extends Error {
  constructor(public readonly kind: 'transient' | 'deterministic' | 'unknown', message: string, public readonly file?: string) {
    super(message);
    this.name = 'MaterializationFailure';
  }
}

export interface MaterializationIssue {
  operationId: string;
  revision: number;
  kind: 'deterministic' | 'unknown';
  error: unknown;
}

export interface MaterializationStatus extends DurableProjectState {
  issue: MaterializationIssue | null;
}

interface Dependencies {
  store: Pick<typeof durableStore, 'getDurableProjectState' | 'listUnmaterialized' | 'recordMaterialization'>;
  registry: ReturnType<typeof createMaterializerRegistry>;
  scheduleRetry?: (callback: () => void, delay: number) => () => void;
}

interface Waiter {
  revision: number;
  refreshed: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
}
interface ProjectWorker {
  status: MaterializationStatus;
  owners: number;
  generation: number;
  running: Promise<void> | null;
  requested: boolean;
  retryAttempt: number;
  cancelRetry?: () => void;
  /** The blocked edit the user discarded: the next pass records it without writing. */
  discard?: string;
  unsubscribe?: () => void;
  waiters: Set<Waiter>;
}

/** Each instance owns one serialized worker per project; production uses the singleton below. */
export function createMaterializer({ store, registry, scheduleRetry = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
} }: Dependencies) {
  const projects = new Map<string, ProjectWorker>();
  const listeners = new Set<() => void>();

  function project(projectId: string): ProjectWorker {
    let state = projects.get(projectId);
    if (!state) {
      state = {
        status: { projectId, acceptedRevision: 0, materializedRevision: 0, issue: null },
        owners: 0, generation: 0, running: null, requested: false, retryAttempt: 0,
        waiters: new Set(),
      };
      projects.set(projectId, state);
    }
    return state;
  }

  function settle(state: ProjectWorker) {
    for (const waiter of state.waiters) {
      if (state.status.materializedRevision >= waiter.revision) {
        state.waiters.delete(waiter);
        waiter.resolve();
      } else if (waiter.refreshed && state.status.issue?.kind === 'deterministic' && state.status.issue.revision <= waiter.revision) {
        state.waiters.delete(waiter);
        waiter.reject(state.status.issue.error);
      }
    }
  }

  function publish(state: ProjectWorker, next: MaterializationStatus) {
    state.status = Object.freeze(next);
    // Resolve durable progress before any fallible presentation observer runs.
    settle(state);
    for (const listener of listeners) {
      try { listener(); } catch (error) { console.error('[materializer status]', error); }
    }
  }

  async function refresh(state: ProjectWorker) {
    // A read already in flight when a barrier was created cannot validate that
    // barrier's cached conflict. Failed reads leave it pending until recovery.
    const waitingAtRead = [...state.waiters];
    const stored = await store.getDurableProjectState(state.status.projectId);
    for (const waiter of waitingAtRead) waiter.refreshed = true;
    const materializedRevision = Math.max(state.status.materializedRevision, stored.materializedRevision);
    publish(state, {
      ...stored,
      acceptedRevision: Math.max(state.status.acceptedRevision, stored.acceptedRevision),
      materializedRevision,
      issue: state.status.issue && state.status.issue.revision > materializedRevision ? state.status.issue : null,
    });
  }

  function retry(state: ProjectWorker) {
    if (!state.owners || state.cancelRetry) return;
    const delay = Math.min(250 * 2 ** Math.min(state.retryAttempt++, 7), 30_000);
    state.cancelRetry = scheduleRetry(() => {
      state.cancelRetry = undefined;
      requestMaterialization(state.status.projectId);
    }, delay);
  }

  function fail(state: ProjectWorker, row: StoredDurableEdit, error: unknown, unknownOutcome = false) {
    if (!unknownOutcome && error instanceof MaterializationFailure && error.kind === 'transient') {
      retry(state);
      return;
    }
    publish(state, { ...state.status, issue: {
      operationId: row.operationId, revision: row.revision,
      kind: !unknownOutcome && error instanceof MaterializationFailure && error.kind === 'deterministic' ? 'deterministic' : 'unknown',
      error,
    } });
    // Recovery is internal. Every retry still reconciles before dispatch;
    // unknown/conflicting bytes never authorize a blind repeated write.
    retry(state);
  }

  function verifyReceipt(receipt: MaterializationReceipt, id: string, context: MaterializerContext) {
    if (!receipt || receipt.projectId !== context.projectId || receipt.operationId !== id
      || !Number.isFinite(receipt.materializedAt)) {
      throw new MaterializationFailure('unknown', 'Writer receipt does not identify the materialized command');
    }
  }

  async function process(state: ProjectWorker, generation: number) {
    const projectId = state.status.projectId;
    const stillCurrent = () => state.generation === generation;
    let rows: StoredDurableEdit[];
    try {
      await refresh(state);
      rows = await store.listUnmaterialized(projectId, state.status.materializedRevision);
    } catch {
      retry(state);
      return;
    }
    pm('mat:pass', { rows: rows.length });
    for (const row of rows) {
      if (!stillCurrent()) return;
      if (row.revision <= state.status.materializedRevision) continue;
      pm('mat:row', { rev: row.revision });
      if (row.revision !== state.status.materializedRevision + 1) {
        fail(state, row, new MaterializationFailure('unknown', 'Journal materialization prefix is not contiguous'));
        return;
      }
      let materializedAt = Date.now();
      const commands = row.operationId === state.discard ? [] : row.commands;
      for (const [commandIndex, command] of commands.entries()) {
        if (!stillCurrent()) return;
        const adapter = registry.get(command.kind);
        // Adapter lifetime is transport lifetime. Its absence cannot reject a durable edit.
        if (!adapter) return;
        const commandId = JSON.stringify([row.operationId, commandIndex]);
        const context = { projectId, operationId: row.operationId, revision: row.revision, commandIndex };
        try {
          let result = await adapter.reconcile(command, commandId, context);
          pm('mat:reconciled', { rev: row.revision, status: result.status });
          if (!stillCurrent() || registry.get(command.kind) !== adapter) return;
          if (result.status === 'unknown' || result.status === 'partial') {
            fail(state, row, result.error, result.status === 'unknown'); return;
          }
          let receipt: MaterializationReceipt;
          if (result.status === 'written') {
            receipt = result.receipt;
          } else {
            try {
              receipt = await adapter.dispatch(command, commandId, context);
              pm('mat:dispatched', { rev: row.revision });
            } catch (dispatchError) {
              // A rejection is not evidence of no write (including observer failures).
              if (!stillCurrent()) return;
              try {
                result = await adapter.reconcile(command, commandId, context);
              } catch (reconcileError) {
                if (!stillCurrent()) return;
                const transient = reconcileError instanceof MaterializationFailure && reconcileError.kind === 'transient';
                fail(state, row, reconcileError, !transient);
                return;
              }
              if (!stillCurrent() || registry.get(command.kind) !== adapter) return;
              if (result.status === 'written') receipt = result.receipt;
              else {
                fail(state, row, result.status === 'unknown' || result.status === 'partial' ? result.error : dispatchError, result.status === 'unknown');
                return;
              }
            }
          }
          verifyReceipt(receipt, commandId, context);
          materializedAt = Math.max(materializedAt, receipt.materializedAt);
        } catch (error) {
          if (!stillCurrent()) return;
          fail(state, row, error);
          return;
        }
      }
      if (!stillCurrent()) return;
      try {
        await store.recordMaterialization({ projectId, operationId: row.operationId, materializedAt });
        pm('mat:recorded', { rev: row.revision });
        if (state.discard === row.operationId) state.discard = undefined;
        // Once committed, transport/subscriber errors cannot downgrade this receipt.
        publish(state, { ...state.status, materializedRevision: row.revision, issue: null });
        await refresh(state);
        state.retryAttempt = 0;
      } catch {
        // An ambiguous storage acknowledgement is reconciled from the store on the next pass.
        retry(state);
        return;
      }
    }
  }

  /** Run one ordered pass, sharing any pass already in flight. Also useful for explicit recovery. */
  function runOnce(projectId: string): Promise<void> {
    const state = project(projectId);
    if (state.running) return state.running;
    state.requested = false;
    state.cancelRetry?.();
    state.cancelRetry = undefined;
    const generation = state.generation;
    const running = Promise.resolve().then(() => process(state, generation));
    state.running = running;
    const finished = () => {
      state.running = null;
      if (state.requested && state.owners && !state.cancelRetry) requestMaterialization(projectId);
    };
    void running.then(finished, finished);
    return running;
  }

  function requestMaterialization(projectId: string): void {
    const state = project(projectId);
    state.requested = true;
    if (!state.owners || state.running) return;
    void runOnce(projectId).catch(error => {
      console.error('[materializer worker]', error);
      retry(state);
    });
  }

  /** Explicit recovery rechecks the same retained journal payload. Clearing
   * a presentation issue never clears preparation, receipts or advances state. */
  function retryMaterialization(projectId: string): void {
    const state = project(projectId);
    publish(state, { ...state.status, issue: null });
    requestMaterialization(projectId);
  }

  /** The user's way past a refused write: the next pass records the blocked
   * edit as materialized without writing it — its file keeps the bytes on disk
   * — and every later edit can land. The worker does it, so no other pass can
   * process that row in between. */
  async function discardBlockedEdit(projectId: string): Promise<void> {
    const state = project(projectId);
    const issue = state.status.issue;
    if (!issue) return;
    state.discard = issue.operationId;
    state.generation++; // a pass still on the blocked row stops at its next check
    state.cancelRetry?.(); state.cancelRetry = undefined;
    state.retryAttempt = 0;
    await state.running?.catch(() => {});
    await runOnce(projectId);
  }

  function startMaterializer(projectId: string): () => void {
    const state = project(projectId);
    if (state.owners++ === 0) {
      const unsubscribeRegistry = registry.subscribe(() => requestMaterialization(projectId));
      let observedAcceptance = getDurableEditStatus(projectId).acceptedRevision;
      const unsubscribeAcceptance = subscribeDurableEditStatus(() => {
        const status = getDurableEditStatus(projectId);
        // The durable cursor read may see a commit before its live publication.
        // Deduplicate notifications against notifications, not against that cursor.
        if (status.phase === 'accepted' && status.acceptedRevision > observedAcceptance) {
          observedAcceptance = status.acceptedRevision;
          requestMaterialization(projectId);
        }
      });
      state.unsubscribe = () => { unsubscribeRegistry(); unsubscribeAcceptance(); };
    }
    requestMaterialization(projectId);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--state.owners !== 0) return;
      state.generation++;
      state.unsubscribe?.(); state.unsubscribe = undefined;
      state.cancelRetry?.(); state.cancelRetry = undefined;
      // In-flight acknowledgements may finish, but journal rows and barriers outlive transport.
    };
  }

  function materializeThrough(projectId: string, revision: number, signal?: AbortSignal): Promise<void> {
    const state = project(projectId);
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const abort = () => { state.waiters.delete(waiter); waiter.reject(signal?.reason); };
      const waiter: Waiter = { revision, refreshed: false,
        resolve: () => { signal?.removeEventListener('abort', abort); resolve(); },
        reject: error => { signal?.removeEventListener('abort', abort); reject(error); },
      };
      signal?.addEventListener('abort', abort, { once: true });
      state.waiters.add(waiter);
      settle(state);
      // One durable read handles already-completed revisions, without a polling loop.
      void refresh(state).catch(() => { retry(state); });
      requestMaterialization(projectId);
    });
  }

  return {
    startMaterializer, requestMaterialization, retryMaterialization, materializeThrough, runOnce, discardBlockedEdit,
    getStatus: (projectId: string): MaterializationStatus => project(projectId).status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const materializer = createMaterializer({ store: durableStore, registry: materializerRegistry });
export const { startMaterializer, requestMaterialization, retryMaterialization, materializeThrough, discardBlockedEdit } = materializer;
export const getMaterializationStatus = materializer.getStatus;
export const subscribeMaterializationStatus = materializer.subscribe;
