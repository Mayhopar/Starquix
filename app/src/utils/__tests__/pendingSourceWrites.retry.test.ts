// @vitest-environment node
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { expect, it, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/db';
import { queueSourceWrites, flushPendingSourceWrites } from '../pendingSourceWrites';
import { setLocalTransport } from '../sqLocalBase';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { listUnmaterialized } from '@/services/durableEdits/store';
const projectId = 'browser_source_retry';
let doc: Y.Doc;
let source: string;
let writes: number;
let offline: boolean;
beforeEach(async () => {
  await db.delete(); await db.open(); doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  source = '<main class="p-2">Title</main>'; writes = 0; offline = true;
  setActiveSaveProjectId(projectId);
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (url, init) => {
    if (url.split('?')[0] !== '/__sq/local/source-command') return new Response(source);
    writes++; if (offline) return new Response('offline', { status: 503 });
    const prepared = JSON.parse(init!.body as string);
    if (source !== prepared.beforeSource && source !== prepared.afterSource) return new Response('conflict', { status: 409 });
    source = prepared.afterSource; return new Response('{}');
  } });
});
afterEach(() => { doc.destroy(); setActiveSaveProjectId(null); });
it('retains immutable accepted commands across a failed dispatch and a newer revision', async () => {
  const original = { astroSource: 'src/pages/index.astro', overrides: { classOverrides: { 'main-0': 'p-4' } } };
  const accepting = queueSourceWrites([original], [], { doc });
  original.overrides.classOverrides['main-0'] = 'caller mutation before acceptance';
  const accepted = await accepting;
  expect(await listUnmaterialized(projectId)).toHaveLength(1);
  expect((await listUnmaterialized(projectId))[0].commands).toMatchObject([{ payload: {
    payloads: [{ overrides: { classOverrides: { 'main-0': 'p-4' } } }],
  } }]);
  original.overrides.classOverrides['main-0'] = 'caller mutation';
  const saving = flushPendingSourceWrites();
  await vi.waitFor(() => expect(writes).toBe(1));
  const first = await db.durableCommandReceipts.get([projectId, JSON.stringify([accepted.operationId, 0])]);
  expect(first?.prepared.afterSource).toContain('p-4');
  await queueSourceWrites([{ astroSource: 'src/pages/index.astro', overrides: { classOverrides: { 'main-0': 'p-8' } } }], [], { doc });
  offline = false;
  await saving; await flushPendingSourceWrites();
  expect(source).toContain('p-8');
  expect((await db.durableCommandReceipts.get([projectId, first!.commandId]))?.prepared).toEqual(first!.prepared);
  expect(await listUnmaterialized(projectId)).toEqual([]);
});
it('rejects storage before publishing the staged source edit or dispatching', async () => {
  const reject = () => { throw new Error('quota'); }; db.durableEdits.hook('creating', reject);
  try {
    await expect(queueSourceWrites([{ astroSource: 'src/pages/index.astro', overrides: {} }], [], {
      doc, mutate: staged => staged.getMap('meta').set('test', 'must not publish'),
    })).rejects.toThrow('quota');
  } finally { db.durableEdits.hook('creating').unsubscribe(reject); }
  expect(doc.getMap('meta').has('test')).toBe(false); expect(writes).toBe(0);
});
