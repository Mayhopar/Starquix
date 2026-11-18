import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { acceptProjectEdit } from '../durableEdits/acceptance';
import { flushLayoutAppends, pendingLayoutAppendCount } from '../pendingLayoutAppends';
let runtime: ReturnType<typeof projectFsRuntime>;
let projectId: string;
let doc: Y.Doc;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open(); projectId = crypto.randomUUID(); setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { 'src/layouts/Base.astro': '<main>One</main>\n' }); doc = new Y.Doc();
});
afterEach(() => { runtime.close(); doc.destroy(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });
it('discovers deferred appends after database reopen without a memory queue', async () => {
  await acceptProjectEdit(doc, { projectId, operationId: 'append', mutate: () => {}, commands: [{ kind: 'layout-append', payload: {
    pageFile: 'src/layouts/Base.astro', markup: '  <Card />', deferUntil: Date.now() + 86400000,
  } }] });
  expect(pendingLayoutAppendCount()).toBe(0);
  db.close(); await db.open(); runtime.restart();
  expect(await flushLayoutAppends()).toBe(1);
  expect(runtime.read('src/layouts/Base.astro')).toBe('<main>One</main>\n  <Card />\n');
  expect(await flushLayoutAppends()).toBe(0);
});
