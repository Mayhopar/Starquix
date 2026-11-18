import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { db } from '@/db';
import { useClassPersistenceQueue, CLASS_WRITE_JOURNAL_KEY } from '../useClassPersistenceQueue';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { classCommands } from '@/services/durableEdits/classCommands';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
let projectId: string;
let sequence = 0;
let doc: Y.Doc;
let source: string;
let writes: number;
const file = 'src/pages/index.astro';
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_journal_${++sequence}`; doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  source = '<main class="p-2">Title</main>'; writes = 0; localStorage.clear(); setActiveSaveProjectId(projectId);
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (url, init) => {
    if (url.split('?')[0] !== '/__sq/local/source-command') return new Response(source);
    writes++; source = JSON.parse(init!.body as string).afterSource;
    throw new Error('ACK lost after CAS');
  } });
});
afterEach(async () => { await act(async () => { cleanup(); }); doc.destroy(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });
async function accept() {
  return acceptProjectEdit(doc, { projectId, operationId: 'journal-edit', commands: classCommands({ file, line: 1, column: 1 }, 'p-4', 'p-2'),
    mutate: staged => staged.getMap('source-values').set(file, 'p-4') });
}
it('the accepted update replays after database reopen before any pagehide or source timer', async () => {
  const fresh = new Y.Doc(); Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc));
  await accept(); await db.close(); await db.open();
  const rows = await listUnmaterialized(projectId); expect(rows).toHaveLength(1);
  Y.applyUpdate(fresh, rows[0].yjsUpdate!);
  expect(fresh.getMap('source-values').get(file)).toBe('p-4'); expect(writes).toBe(0); fresh.destroy();
});
it('pagehide expedites the durable command without creating a second localStorage journal', async () => {
  const { result } = renderHook(() => useClassPersistenceQueue(projectId));
  await act(async () => { await accept(); window.dispatchEvent(new Event('pagehide')); await result.current.saveAll(); });
  expect(writes).toBe(1); expect(source).toContain('p-4');
  expect(localStorage.getItem(CLASS_WRITE_JOURNAL_KEY)).toBeNull();
  expect(await listUnmaterialized(projectId)).toEqual([]);
});
it('a lost ACK is recovered from the durable prepared bytes and is not replayed on reopen', async () => {
  const { result } = renderHook(() => useClassPersistenceQueue(projectId));
  await act(async () => { await accept(); await result.current.saveAll(); });
  await db.close(); await db.open();
  await act(async () => { await result.current.saveAll(); });
  expect(writes).toBe(1);
  expect((await db.durableCommandReceipts.toArray())[0].outcome?.status).toBe('written');
});
