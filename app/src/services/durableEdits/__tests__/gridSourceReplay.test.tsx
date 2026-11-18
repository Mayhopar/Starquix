import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { acceptEditorCommands } from '@/store/commandGesture';
import type { EditorCommand } from '@/store/types';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { resetClassWriteBaselines, setClassWriteBaseline } from '@/services/classWriteBaseline';
import { flushDurableSourceWrites } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = 'src/pages/index.astro';
const key = `${file}:1:1`;
const original = '<main class="p-2"></main>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  await db.delete(); await db.open();
  projectId = `grid-source-${crypto.randomUUID()}`;
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [file]: original });
});
afterEach(() => { cleanup(); runtime.close(); h.doc.destroy(); resetClassWriteBaselines(); });

it.each(['GRID_PLACE_ELEMENT', 'SET_GRID_SPAN'] as const)('%s preserves source anchors through first undo, another gesture and reopen', async type => {
  const { result, unmount } = renderHook(() => useUndoContext(), {
    wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider>,
  });
  const edit = async (gridColumn: string) => {
    const actions: EditorCommand[] = [];
    if (!h.doc.getMap('sourceClasses').has(key)) actions.push({ type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key,
      classes: 'p-2', sourceLocation: { file, line: 1, column: 1 } });
    actions.push({ type, key, gridColumn, gridRow: '' });
    await act(async () => {
      result.current.takeSnapshot();
      await acceptEditorCommands(h.doc, actions, result.current.claimSnapshot());
    });
  };
  await edit('col-span-2');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('<main class="p-2 col-span-2"></main>\n');
  // The cache can still describe materialized bytes while undo is only accepted.
  setClassWriteBaseline(key, 'p-2 col-span-2');
  await act(async () => { await result.current.undo(); });
  expect(h.doc.getMap('sourceClasses').has(key)).toBe(false);
  expect(h.doc.getMap('acceptedSourceClassTargets').get(key)).toBe('p-2');
  await edit('col-span-3');
  expect((await db.durableEdits.where('projectId').equals(projectId).sortBy('revision')).at(-1)?.commands).toMatchObject([
    { kind: 'class-write', payload: { baseClasses: 'p-2', newClasses: 'p-2 col-span-3' } },
  ]);
  expect(h.doc.getMap('acceptedSourceClassTargets').get(key)).toBe('p-2 col-span-3');
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('edited')).toBe(true);
  await act(async () => { await result.current.undo(); });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 4 });
  expect((await db.durableEdits.where('projectId').equals(projectId).sortBy('revision')).at(-1)?.commands).toMatchObject([
    { kind: 'file-batch', payload: { files: [{ file,
      beforeSource: '<main class="p-2 col-span-3"></main>\n', afterSource: original }] } },
  ]);
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(original);
  // Reopen from the persisted journal, without retaining the live document/cache.
  unmount(); h.doc.destroy(); resetClassWriteBaselines();
  runtime.restart(); db.close(); await db.open();
  h.doc = new Y.Doc();
  for (const row of await db.durableEdits.where('projectId').equals(projectId).sortBy('revision')) {
    if (row.yjsUpdate) Y.applyUpdate(h.doc, row.yjsUpdate);
  }
  expect(h.doc.getMap('sourceClasses').has(key)).toBe(false);
  expect(h.doc.getMap('acceptedSourceClassTargets').get(key)).toBe('p-2');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(original);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 4, materializedRevision: 4 });
});
