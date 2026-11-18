import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { db } from '@/db';
import { useClassPersistenceQueue } from '../useClassPersistenceQueue';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { classCommands } from '@/services/durableEdits/classCommands';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { flushPendingSourceWrites } from '@/utils/pendingSourceWrites';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalComponentViewFile } from '@/services/localComponentView';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { getClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { materializerRegistry } from '@/services/durableEdits/registry';
import { registerSourceMaterializers } from '@/services/durableEdits/sourceMaterialization';
const file = 'src/pages/index.astro';
const key = `${file}:1:1`;
let projectId: string;
let sequence = 0;
let doc: Y.Doc;
let source: string;
let writes: number;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_class_queue_${++sequence}`; doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  source = '<main class="p-2">Title</main>'; writes = 0;
  resetClassWriteBaselines(); setActiveSaveProjectId(projectId);
  setLocalComponentViewFile(null);
  setLocalExpectedRoute('/'); setLocalPageFile(file);
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (url, init) => {
    if (url.split('?')[0] !== '/__sq/local/source-command') return new Response(source);
    writes++;
    const prepared = JSON.parse(init!.body as string);
    if (source !== prepared.beforeSource && source !== prepared.afterSource) return new Response('conflict', { status: 409 });
    source = prepared.afterSource; return new Response('{}');
  } });
});
afterEach(async () => {
  await act(async () => { cleanup(); });
  doc.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); _resetLocalPageSyncForTests(); setActiveSaveProjectId(null);
});
async function edit(classes = 'p-4', baseline = 'p-2') {
  await act(async () => { await acceptProjectEdit(doc, { projectId, operationId: crypto.randomUUID(),
    mutate: staged => staged.getMap('test-classes').set(key, classes),
    commands: classCommands({ file, line: 1, column: 1 }, classes, baseline),
  }); });
}
it('projects accepted journal commands as dirty without dispatching before the five-second debounce', async () => {
  const { result } = renderHook(() => useClassPersistenceQueue(projectId));
  await edit();
  await waitFor(() => expect(result.current.dirtyKeys.has(key)).toBe(true));
  expect(await listUnmaterialized(projectId)).toHaveLength(1); expect(writes).toBe(0);
  await act(async () => { await result.current.saveAll(); });
  await waitFor(() => expect(result.current.dirtyKeys.size).toBe(0));
  expect(writes).toBe(1); expect(source).toContain('p-4'); expect(getClassWriteBaseline(key)).toBe('p-4');
});
it('debounces only materialization and extends the source deadline when another accepted edit arrives', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  renderHook(() => useClassPersistenceQueue(projectId));
  await edit();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  await edit('p-8', 'p-4');
  expect(await listUnmaterialized(projectId)).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
  expect(writes).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.waitFor(() => expect(writes).toBe(2)); });
  expect(source).toContain('p-8');
});
it('an explicit page/tab boundary materializes accepted work under its captured original surface', async () => {
  renderHook(() => useClassPersistenceQueue(projectId)); await edit();
  setLocalPageFile('src/pages/other.astro');
  await act(async () => { await flushPendingSourceWrites(); });
  expect(source).toContain('p-4'); expect(writes).toBe(1);
});
it('a component-view boundary expedites accepted commands', async () => {
  renderHook(() => useClassPersistenceQueue(projectId)); await edit();
  await act(async () => { setLocalComponentViewFile('src/components/Card.astro'); await vi.waitFor(() => expect(writes).toBe(1)); });
  expect(source).toContain('p-4');
});
it('unmount needs no last-chance write: remount discovers and flushes the durable row', async () => {
  const first = renderHook(() => useClassPersistenceQueue(projectId)); await edit();
  first.unmount(); expect(writes).toBe(0); expect(await listUnmaterialized(projectId)).toHaveLength(1);
  await db.close(); await db.open();
  const next = renderHook(() => useClassPersistenceQueue(projectId));
  await act(async () => { await next.result.current.saveAll(); });
  expect(source).toContain('p-4'); expect(writes).toBe(1);
});
it('partial literal classes use the preceding accepted baseline instead of a stale in-memory baseline', async () => {
  source = "<main class={'p-2 ' + variant}>Title</main>";
  const { result } = renderHook(() => useClassPersistenceQueue(projectId));
  await edit('p-4 flex', 'p-2 flex'); await edit('p-8 flex', 'p-4 flex');
  await act(async () => { await result.current.saveAll(); });
  expect(source).toBe("<main class={'p-8 ' + variant}>Title</main>");
  expect(writes).toBe(2);
});
it('a deterministic source-transform refusal is reported without dispatching or retrying it as transport downtime', async () => {
  source = '<main class={variant}>Title</main>'; registerSourceMaterializers();
  const command = classCommands({ file, line: 1, column: 1 }, 'p-4', 'p-2', undefined, 0)[0];
  await expect(materializerRegistry.get('class-write')!.reconcile(command, 'refused:0', {
    projectId, operationId: 'refused', revision: 1, commandIndex: 0,
  })).rejects.toMatchObject({ kind: 'deterministic' });
  expect(writes).toBe(0); expect(await db.durableCommandReceipts.count()).toBe(0);
});
