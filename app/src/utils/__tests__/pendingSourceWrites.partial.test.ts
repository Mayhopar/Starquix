// @vitest-environment node
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { db } from '@/db';
import { queueSourceWrites, flushPendingSourceWrites } from '../pendingSourceWrites';
import { setLocalTransport } from '../sqLocalBase';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { listUnmaterialized } from '@/services/durableEdits/store';
let projectId: string;
let projectSequence = 0;
let doc: Y.Doc;
let writes: number;
let source: string;
const skipped = { source: 'Hero.astro', category: 'classes' as const, selector: 'h1-9', reason: 'unresolved' as const };
beforeEach(async () => {
  projectId = `browser_partial_${++projectSequence}`;
  await db.delete(); await db.open(); doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  writes = 0; source = '<main class="p-2">Title</main>';
  setActiveSaveProjectId(projectId);
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (url, init) => {
    if (url.split('?')[0] !== '/__sq/local/source-command') return new Response(source);
    writes++; source = JSON.parse(init!.body as string).afterSource; return new Response('{}');
  } });
});
afterEach(() => { doc.destroy(); setActiveSaveProjectId(null); vi.restoreAllMocks(); });
it('retains the exact partial command and skipped selectors across restart without replay', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const payload = { astroSource: 'Hero.astro', overrides: { classOverrides: { 'main-0': 'p-4', 'h1-9': 'text-lg' } } };
  const accepted = await queueSourceWrites([payload], [], { doc });
  const commandId = JSON.stringify([accepted.operationId, 0]);
  await expect(flushPendingSourceWrites()).rejects.toMatchObject({ projectId, commandId, skipped: [skipped] });
  expect(writes).toBe(1); expect(source).toContain('p-4');
  const row = (await listUnmaterialized(projectId))[0];
  await db.close(); await db.open();
  payload.overrides.classOverrides['h1-9'] = 'caller mutation';
  await queueSourceWrites([{ astroSource: 'Hero.astro', overrides: { classOverrides: { 'h1-9': 'newer' } } }], [], { doc });
  await expect(flushPendingSourceWrites()).rejects.toMatchObject({ commandId, skipped: [skipped] });
  expect((await listUnmaterialized(projectId))[0]).toEqual(row);
  expect((await db.durableCommandReceipts.get([projectId, commandId]))?.outcome).toEqual({ status: 'partial', skipped: [skipped] });
  expect(await listUnmaterialized(projectId)).toHaveLength(2); expect(writes).toBe(1);
});
it('client-side skipped work alone is durable and never silently drains or writes', async () => {
  const accepted = await queueSourceWrites([], [skipped], { doc });
  expect(await listUnmaterialized(projectId)).toHaveLength(1);
  await expect(flushPendingSourceWrites()).rejects.toMatchObject({ commandId: JSON.stringify([accepted.operationId, 0]), skipped: [skipped] });
  expect(await listUnmaterialized(projectId)).toHaveLength(1); expect(writes).toBe(0);
});
