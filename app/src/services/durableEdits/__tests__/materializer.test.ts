import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/db';
import * as store from '../store';
import { publishDurableEditStatus } from '../status';
import { createMaterializer, MaterializationFailure } from '../materializer';
import { createMaterializerRegistry, type MaterializerAdapter } from '../registry';
import type { MaterializationCommand, MaterializationReceipt } from '../types';

const PROJECT = 'materializer-project';
type Command = Extract<MaterializationCommand, { kind: 'layout-append' }>;
const command: Command = { kind: 'layout-append', payload: { pageFile: 'index.astro', markup: '<Card />' } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function accept(operationId = 'op-1', commands: MaterializationCommand[] = [command], projectId = PROJECT) {
  return store.acceptStoredEdit({ projectId, operationId, commands, yjsUpdate: null, acceptedAt: 1 });
}

const cleanups: Array<() => void> = [];
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); });

function setup(overrides: Partial<typeof store> = {}) {
  const registry = createMaterializerRegistry();
  const written = new Map<string, MaterializationReceipt>();
  const writes: string[] = [];
  const adapter: MaterializerAdapter<Command> = {
    reconcile: vi.fn(async (_command, id) => written.has(id)
      ? { status: 'written' as const, receipt: written.get(id)! }
      : { status: 'not-written' as const }),
    dispatch: vi.fn(async (_command, id, context) => {
      writes.push(id);
      const receipt = { projectId: context.projectId, operationId: id, materializedAt: 10 };
      written.set(id, receipt);
      return receipt;
    }),
  };
  registry.registerMaterializer('layout-append', adapter);
  const retries: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  const worker = createMaterializer({
    store: { ...store, ...overrides }, registry,
    scheduleRetry: (callback, delay) => {
      const retry = { callback, delay, cancelled: false };
      retries.push(retry);
      return () => { retry.cancelled = true; };
    },
  });
  return { worker, adapter, registry, writes, written, retries };
}

describe('resumable ordered materialization', () => {
  it('reconciles retained unknown outcomes on bounded background retry without redispatch', async () => {
    await accept();
    const { worker, adapter, retries, written, writes } = setup();
    let readable = false;
    vi.mocked(adapter.reconcile).mockImplementation(async (_command, id) => readable
      ? { status: 'written', receipt: written.get(id)! } : { status: 'unknown', error: new Error('ACK unavailable') });
    cleanups.push(worker.startMaterializer(PROJECT)); await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT).issue?.kind).toBe('unknown');
    expect(retries).toHaveLength(1);
    expect(retries[0].delay).toBeLessThanOrEqual(30_000);
    written.set('["op-1",0]', { projectId: PROJECT, operationId: '["op-1",0]', materializedAt: 10 }); readable = true;
    retries[0].callback(); await worker.runOnce(PROJECT);
    expect(writes).toEqual([]);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });
  it('reconciles before dispatch and commits the revision only after the writer receipt', async () => {
    await accept();
    const { worker, adapter, writes } = setup();
    const acknowledged = deferred<MaterializationReceipt>();
    const dispatched = deferred<void>();
    vi.mocked(adapter.dispatch).mockImplementationOnce(async (_command, id, context) => {
      writes.push(id); dispatched.resolve();
      return acknowledged.promise;
    });
    const running = worker.runOnce(PROJECT);
    await dispatched.promise;
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(0);
    expect(adapter.reconcile).toHaveBeenCalledWith(command, '["op-1",0]', expect.objectContaining({ operationId: 'op-1', revision: 1 }));
    acknowledged.resolve({ projectId: PROJECT, operationId: '["op-1",0]', materializedAt: 10 });
    await running;
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });

  it('reconciles an acknowledged command after restart without dispatching twice', async () => {
    await accept();
    const { worker, written, writes } = setup();
    written.set('["op-1",0]', { projectId: PROJECT, operationId: '["op-1",0]', materializedAt: 10 });
    await worker.runOnce(PROJECT);
    expect(writes).toEqual([]);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });

  it('retains an acknowledged write after receipt storage fails and reconciles the retry', async () => {
    await accept();
    const recordMaterialization = vi.fn(store.recordMaterialization).mockRejectedValueOnce(new Error('storage unavailable'));
    const { worker, writes } = setup({ recordMaterialization });
    await worker.runOnce(PROJECT);
    expect((await store.listUnmaterialized(PROJECT)).length).toBe(1);
    await worker.runOnce(PROJECT);
    expect(writes).toEqual(['["op-1",0]']);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });

  it('reconciles a lost acknowledgement and records success even when dispatch throws', async () => {
    await accept();
    const { worker, adapter, written } = setup();
    vi.mocked(adapter.dispatch).mockImplementation(async (_command, id, context) => {
      written.set(id, { projectId: context.projectId, operationId: id, materializedAt: 10 });
      throw new MaterializationFailure('deterministic', 'observer threw after writing');
    });
    await worker.runOnce(PROJECT);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
    expect(worker.getStatus(PROJECT).issue).toBeNull();
  });

  it('retries verified no-write transient rejection with bounded backoff', async () => {
    await accept();
    const { worker, adapter, retries, writes } = setup();
    vi.mocked(adapter.dispatch).mockRejectedValueOnce(new MaterializationFailure('transient', 'offline'));
    cleanups.push(worker.startMaterializer(PROJECT));
    await worker.runOnce(PROJECT);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(0);
    expect(retries).toHaveLength(1);
    expect(retries[0].delay).toBeGreaterThan(0);
    expect(retries[0].delay).toBeLessThanOrEqual(30_000);
    retries[0].callback();
    await worker.runOnce(PROJECT);
    expect(writes).toEqual(['["op-1",0]']);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });

  it('retains an unknown predecessor and never dispatches its later ordered edit', async () => {
    await accept(); await accept('op-2');
    const { worker, adapter, writes } = setup();
    vi.mocked(adapter.reconcile).mockResolvedValue({ status: 'unknown', error: new Error('cannot verify') });
    await worker.runOnce(PROJECT);
    expect(writes).toEqual([]);
    expect((await store.listUnmaterialized(PROJECT)).map(row => row.revision)).toEqual([1, 2]);
    expect(worker.getStatus(PROJECT).issue).toMatchObject({ revision: 1, kind: 'unknown' });
    let settled = false;
    void worker.materializeThrough(PROJECT, 2).then(() => { settled = true; }, () => { settled = true; });
    await worker.runOnce(PROJECT);
    expect(settled).toBe(false);
  });

  // Audit 2026-10-18: a deterministic refusal used to hold back every later edit forever.
  it('discards a blocked edit in the worker: no write, no racing retry, and the next edit lands', async () => {
    await accept(); await accept('op-2');
    const { worker, adapter, retries, writes } = setup();
    const conflict = new MaterializationFailure('deterministic', 'file changed outside', 'src/pages/index.astro');
    vi.mocked(adapter.reconcile).mockImplementation(async (_command, id) => {
      if (id.startsWith('["op-1"')) throw conflict;
      return { status: 'not-written' as const };
    });
    cleanups.push(worker.startMaterializer(PROJECT)); await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT).issue).toMatchObject({ operationId: 'op-1', kind: 'deterministic', error: conflict });
    const pendingRetry = retries.at(-1)!;
    await worker.discardBlockedEdit(PROJECT);
    expect(pendingRetry.cancelled).toBe(true);
    expect(writes).toEqual(['["op-2",0]']);
    expect(await store.getDurableProjectState(PROJECT)).toMatchObject({ materializedRevision: 2 });
    expect(worker.getStatus(PROJECT).issue).toBeNull();
  });

  it('rejects barriers only at or after the retained deterministic issue', async () => {
    await accept('empty', []); await accept();
    const { worker, adapter } = setup();
    const conflict = new MaterializationFailure('deterministic', 'source conflict');
    vi.mocked(adapter.reconcile).mockRejectedValue(conflict);
    await worker.runOnce(PROJECT);
    await expect(worker.materializeThrough(PROJECT, 1)).resolves.toBeUndefined();
    await expect(worker.materializeThrough(PROJECT, 2)).rejects.toBe(conflict);
    expect(worker.getStatus(PROJECT).issue).toMatchObject({ revision: 2, error: conflict });
  });

  it('stops before dispatch when runtime ownership ends during reconciliation, preserving the barrier for restart', async () => {
    await accept();
    const { worker, adapter, writes } = setup();
    const started = deferred<void>();
    const result = deferred<{ status: 'not-written' }>();
    vi.mocked(adapter.reconcile).mockImplementationOnce(async () => { started.resolve(); return result.promise; });
    const stop = worker.startMaterializer(PROJECT);
    const running = worker.runOnce(PROJECT);
    const barrier = worker.materializeThrough(PROJECT, 1);
    await started.promise;
    stop();
    result.resolve({ status: 'not-written' });
    await running;
    expect(writes).toEqual([]);
    expect((await store.listUnmaterialized(PROJECT))).toHaveLength(1);
    cleanups.push(worker.startMaterializer(PROJECT));
    await worker.runOnce(PROJECT);
    await expect(barrier).resolves.toBeUndefined();
  });

  it('does not dispatch a scheduled pass after an immediate stop', async () => {
    await accept();
    const { worker, writes } = setup();
    const stop = worker.startMaterializer(PROJECT);
    const scheduled = worker.runOnce(PROJECT);
    stop();
    await scheduled;
    expect(writes).toEqual([]);
    expect((await store.listUnmaterialized(PROJECT))).toHaveLength(1);
  });

  it('does not dispatch a detached adapter after reconciliation finishes', async () => {
    await accept();
    const { worker, adapter, registry, writes } = setup();
    const unregister = registry.registerMaterializer('layout-append', adapter);
    const started = deferred<void>();
    const result = deferred<{ status: 'not-written' }>();
    vi.mocked(adapter.reconcile).mockImplementationOnce(async () => { started.resolve(); return result.promise; });
    const running = worker.runOnce(PROJECT);
    await started.promise;
    unregister();
    result.resolve({ status: 'not-written' });
    await running;
    expect(writes).toEqual([]);
    expect((await store.listUnmaterialized(PROJECT))).toHaveLength(1);
  });

  it('keeps an explicitly unknown writer outcome pending even if its nested error looks deterministic', async () => {
    await accept();
    const { worker, adapter } = setup();
    vi.mocked(adapter.reconcile).mockResolvedValue({
      status: 'unknown', error: new MaterializationFailure('deterministic', 'unverified source conflict'),
    });
    await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT).issue?.kind).toBe('unknown');
  });

  it('does not treat failed post-dispatch reconciliation as proof of a deterministic no-write', async () => {
    await accept();
    const { worker, adapter } = setup();
    vi.mocked(adapter.dispatch).mockRejectedValue(new Error('ack lost'));
    vi.mocked(adapter.reconcile)
      .mockResolvedValueOnce({ status: 'not-written' })
      .mockRejectedValue(new MaterializationFailure('deterministic', 'cannot inspect malformed source'));
    await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT).issue?.kind).toBe('unknown');
    expect((await store.listUnmaterialized(PROJECT))).toHaveLength(1);
  });

  it('retains barriers when transport stops during post-dispatch reconciliation', async () => {
    await accept();
    const { worker, adapter } = setup();
    const reconciling = deferred<void>();
    const result = deferred<{ status: 'not-written' }>();
    vi.mocked(adapter.dispatch).mockRejectedValueOnce(new MaterializationFailure('deterministic', 'write rejected'));
    vi.mocked(adapter.reconcile)
      .mockResolvedValueOnce({ status: 'not-written' })
      .mockImplementationOnce(async () => { reconciling.resolve(); return result.promise; });
    const stop = worker.startMaterializer(PROJECT);
    const running = worker.runOnce(PROJECT);
    const barrier = worker.materializeThrough(PROJECT, 1);
    let rejection: unknown;
    void barrier.catch(error => { rejection = error; });
    await reconciling.promise;
    stop();
    result.resolve({ status: 'not-written' });
    await running;
    expect(rejection).toBeUndefined();
    expect(worker.getStatus(PROJECT).issue).toBeNull();
    cleanups.push(worker.startMaterializer(PROJECT));
    await worker.runOnce(PROJECT);
    await expect(barrier).resolves.toBeUndefined();
  });

  it('never records a receipt belonging to a different project or command', async () => {
    await accept();
    const { worker, adapter } = setup();
    vi.mocked(adapter.dispatch).mockResolvedValue({ projectId: 'wrong-project', operationId: '["op-1",0]', materializedAt: 10 });
    await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT).issue?.kind).toBe('unknown');
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(0);
  });

  it('uses durable progress for a barrier when storage commits and then loses its acknowledgement', async () => {
    await accept();
    const { worker, writes } = setup({ recordMaterialization: async receipt => {
      await store.recordMaterialization(receipt);
      throw new Error('storage acknowledgement lost');
    } });
    await worker.runOnce(PROJECT);
    await expect(worker.materializeThrough(PROJECT, 1)).resolves.toBeUndefined();
    expect(writes).toEqual(['["op-1",0]']);
    expect(worker.getStatus(PROJECT)).toMatchObject({ materializedRevision: 1, issue: null });
  });

  it('refreshes durable progress before rejecting a new barrier with a stale cached conflict', async () => {
    await accept();
    const { worker, adapter } = setup({ recordMaterialization: async receipt => {
      await store.recordMaterialization(receipt);
      throw new Error('storage acknowledgement lost');
    } });
    const conflict = new MaterializationFailure('deterministic', 'previous source conflict');
    vi.mocked(adapter.reconcile).mockRejectedValueOnce(conflict);
    await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT)).toMatchObject({ materializedRevision: 0, issue: { error: conflict } });

    await worker.runOnce(PROJECT);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
    expect(worker.getStatus(PROJECT)).toMatchObject({ materializedRevision: 0, issue: { error: conflict } });

    await expect(worker.materializeThrough(PROJECT, 1)).resolves.toBeUndefined();
    expect(worker.getStatus(PROJECT)).toMatchObject({ materializedRevision: 1, issue: null });
  });

  it('does not let an older registration cleanup remove a newer registration of the same adapter', async () => {
    await accept();
    const { worker, registry, adapter, writes } = setup();
    const removeOld = registry.registerMaterializer('layout-append', adapter);
    registry.registerMaterializer('layout-append', adapter);
    removeOld();
    await worker.runOnce(PROJECT);
    expect(writes).toEqual(['["op-1",0]']);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });

  it('reconciles completed commands after stopping between commands without redispatching them', async () => {
    await accept('op-1', [command, { ...command, payload: { ...command.payload, markup: '<Other />' } }]);
    const { worker, adapter, registry, writes, written } = setup();
    const dispatch = vi.mocked(adapter.dispatch).getMockImplementation()!;
    let stop = () => {};
    vi.mocked(adapter.dispatch).mockImplementationOnce(async (...args) => {
      const receipt = await dispatch(...args);
      stop();
      return receipt;
    });
    stop = worker.startMaterializer(PROJECT);
    await worker.runOnce(PROJECT);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(0);
    expect(written.has('["op-1",0]')).toBe(true);
    const restarted = createMaterializer({ store, registry });
    await restarted.runOnce(PROJECT);
    expect(writes).toEqual(['["op-1",0]', '["op-1",1]']);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(1);
  });

  it('coalesces duplicate starts and wakeups into one project worker', async () => {
    await accept();
    const { worker, adapter, writes } = setup();
    const original = adapter.dispatch;
    const started = deferred<void>(); const release = deferred<void>();
    adapter.dispatch = async (...args) => { started.resolve(); await release.promise; return original(...args); };
    cleanups.push(worker.startMaterializer(PROJECT), worker.startMaterializer(PROJECT));
    const running = worker.runOnce(PROJECT);
    await started.promise;
    worker.requestMaterialization(PROJECT); worker.requestMaterialization(PROJECT);
    const duplicate = worker.runOnce(PROJECT);
    release.resolve();
    await Promise.all([running, duplicate]);
    expect(writes).toEqual(['["op-1",0]']);
  });

  it('wakes for acceptance published after a cursor refresh already saw its committed revision', async () => {
    await accept();
    publishDurableEditStatus(PROJECT, { phase: 'accepted', operationId: 'op-1', acceptedRevision: 1 });
    const { worker, adapter, writes } = setup();
    const secondDispatch = deferred<void>();
    const dispatch = vi.mocked(adapter.dispatch).getMockImplementation()!;
    adapter.dispatch = async (...args) => {
      const receipt = await dispatch(...args);
      if (args[2].operationId === 'op-1') await accept('op-2');
      else secondDispatch.resolve();
      return receipt;
    };
    cleanups.push(worker.startMaterializer(PROJECT));
    await worker.runOnce(PROJECT);
    expect(worker.getStatus(PROJECT)).toMatchObject({ acceptedRevision: 2, materializedRevision: 1 });
    publishDurableEditStatus(PROJECT, { phase: 'accepted', operationId: 'op-2', acceptedRevision: 2 });
    await secondDispatch.promise;
    await worker.runOnce(PROJECT);
    expect(writes).toEqual(['["op-1",0]', '["op-2",0]']);
    expect((await store.getDurableProjectState(PROJECT)).materializedRevision).toBe(2);
  });

  it('resolves event-driven barriers despite throwing status subscribers', async () => {
    await accept();
    const { worker } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    worker.subscribe(() => { throw new Error('bad listener'); });
    const barrier = worker.materializeThrough(PROJECT, 1);
    cleanups.push(worker.startMaterializer(PROJECT));
    await worker.runOnce(PROJECT);
    await expect(barrier).resolves.toBeUndefined();
    expect(worker.getStatus(PROJECT)).toMatchObject({ materializedRevision: 1, issue: null });
  });

  it('waits for an adapter registration and never conflates project barriers', async () => {
    await accept(); await accept('op-1', [command], 'other-project');
    const { worker, registry, adapter } = setup();
    const unregister = registry.registerMaterializer('layout-append', adapter);
    unregister();
    cleanups.push(worker.startMaterializer(PROJECT));
    await worker.runOnce(PROJECT);
    const barrier = worker.materializeThrough(PROJECT, 1);
    registry.registerMaterializer('layout-append', adapter);
    await worker.runOnce(PROJECT);
    await expect(barrier).resolves.toBeUndefined();
    expect((await store.getDurableProjectState('other-project')).materializedRevision).toBe(0);
  });
});

it('aborts only one recovery waiter while retaining the journal and another live waiter', async () => {
  await accept();
  const { worker, adapter, writes } = setup();
  vi.mocked(adapter.reconcile).mockResolvedValue({ status: 'unknown', error: new Error('temporarily unreadable') });
  const stop = worker.startMaterializer(PROJECT); cleanups.push(stop);
  await worker.runOnce(PROJECT);
  const cancelled = new AbortController();
  let outcome = 'pending';
  const first = worker.materializeThrough(PROJECT, 1, cancelled.signal).then(() => { outcome = 'done'; }, () => { outcome = 'aborted'; });
  const second = worker.materializeThrough(PROJECT, 1);
  cancelled.abort(new Error('project closed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(outcome).toBe('aborted');
  expect(await db.durableEdits.count()).toBe(1);
  expect(await store.getDurableProjectState(PROJECT)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
  vi.mocked(adapter.reconcile).mockResolvedValue({ status: 'not-written' });
  await worker.runOnce(PROJECT); await first; await second;
  expect(writes).toHaveLength(1);
  expect(await db.durableEdits.count()).toBe(1);
});
