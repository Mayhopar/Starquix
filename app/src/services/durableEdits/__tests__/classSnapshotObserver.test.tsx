import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { ClassStoreProvider, useClassStore } from '@/context/ClassStoreContext';
import { sourceVersion } from '../sourceIdentity';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
vi.mock('@/context/UndoContext', async importOriginal => ({ ...await importOriginal<typeof import('@/context/UndoContext')>(),
  useUndoContext: () => ({ isUndoingRef: { current: false }, takeSnapshot() {}, claimSnapshot: () => ({
    stage() {}, commit() {}, attachFiles() { throw new Error('inverse observer failed'); },
  }) }),
}));
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>;
const file = 'src/pages/index.astro', key = `${file}:1:1`, original = '<main class="before"></main>\n';
beforeEach(async () => {
  await db.delete(); await db.open(); projectId = `browser_snapshot_fault_${crypto.randomUUID()}`;
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [file]: original });
});
afterEach(async () => { await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision); cleanup(); runtime.close(); h.doc.destroy(); });

it('keeps an accepted class edit successful when its inverse attachment observer throws', async () => {
  const { result } = renderHook(() => useClassStore(), { wrapper: ClassStoreProvider });
  act(() => { result.current.registerElement(key, 'before', { file, line: 1, column: 1, sourceVersion: sourceVersion(original), sourceRevision: 0 }); });
  await act(async () => { expect(await result.current.setClasses(key, 'after')).toBe(true); });
  expect(result.current.storageIssue).toBeNull();
  expect(result.current.getClassesFromYjs(key)).toBe('after');
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1 });
  await act(async () => { await flushDurableSourceWritesThrough(projectId, 1); });
  expect(runtime.read(file)).toBe('<main class="after"></main>\n');
});
