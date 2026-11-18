import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { acceptProjectEdit } from '../durableEdits/acceptance';
import { flushLayoutAppends, useDrainLayoutAppendsOnUnmount } from '../pendingLayoutAppends';
let runtime: ReturnType<typeof projectFsRuntime>;
let projectId: string;
let doc: Y.Doc;
let writes: number;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open(); projectId = crypto.randomUUID(); setActiveSaveProjectId(projectId); writes = 0;
  runtime = projectFsRuntime(projectId, { 'src/layouts/Base.astro': '<main>One</main>\n' }, { beforeCommand: async () => { writes++; } }); doc = new Y.Doc();
});
afterEach(() => { runtime.close(); doc.destroy(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });
it.each([false, true])('unmount expedites the captured durable owner (already flushed: %s)', async alreadyFlushed => {
  const view = renderHook(() => useDrainLayoutAppendsOnUnmount());
  await acceptProjectEdit(doc, { projectId, operationId: 'append', mutate: () => {}, commands: [{ kind: 'layout-append', payload: {
    pageFile: 'src/layouts/Base.astro', markup: '  <Card />', deferUntil: Date.now() + 86400000,
  } }] });
  if (alreadyFlushed) await flushLayoutAppends(projectId);
  setActiveSaveProjectId('another-project');
  view.unmount();
  await act(async () => { await flushLayoutAppends(projectId); });
  expect(runtime.read('src/layouts/Base.astro').match(/<Card/g)).toHaveLength(1); expect(writes).toBe(1);
});
