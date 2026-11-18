import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { db } from '@/db';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { ClassStoreProvider, useClassStore } from '@/context/ClassStoreContext';
import { setClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { listUnmaterialized } from '../store';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { pushInstanceToSource } from '@/store/instanceLifecycle';
import { applyCommand } from '@/store/commands';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { flushDurableSourceWrites } from '../sourceMaterialization';
const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const key = 'src/pages/index.astro:1:1';
let projectId: string;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_class_undo_${crypto.randomUUID()}`; resetClassWriteBaselines();
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async () => new Response('offline', { status: 503 }) });
});
afterEach(() => { cleanup(); h.doc.destroy(); vi.unstubAllGlobals(); });
function mount() {
  return renderHook(() => ({ classes: useClassStore(), undo: useUndoContext() }), {
    wrapper: ({ children }) => <UndoProvider><ClassStoreProvider>{children}</ClassStoreProvider></UndoProvider>,
  });
}
function instancePushArgs(takeSnapshot: ReturnType<typeof useUndoContext>['takeSnapshot']) {
  const instance = new Y.Map<unknown>();
  instance.set('id', 'el-1'); instance.set('astroSource', 'Card.astro');
  instance.set('staticMarkup', '<main><span>First</span><span>Second</span></main>');
  const deleted = new Y.Array<string>(); deleted.push(['span-0']); instance.set('deletedSelectors', deleted);
  h.doc.getMap('elements').set('el-1', instance);
  return { doc: h.doc, dispatch: (command: Parameters<typeof applyCommand>[1]) => applyCommand(h.doc, command),
    takeSnapshot, instanceId: 'el-1', astroSource: 'Card.astro', currentPageId: null };
}
it('accepts a concurrently pushed positional deletion only once', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = projectFsRuntime(projectId, { 'src/components/Card.astro': '<main><span>First</span><span>Second</span></main>' }, { beforeCommand: () => gate });
  try {
  const { result } = mount();
  const args = instancePushArgs(result.current.undo.takeSnapshot);
  let outcomes!: Awaited<ReturnType<typeof pushInstanceToSource>>[];
  await act(async () => { outcomes = await Promise.all([pushInstanceToSource(args), pushInstanceToSource(args)]); });
  expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(1);
  const rows = await listUnmaterialized(projectId);
  expect(rows).toHaveLength(1);
  expect(rows[0].commands).toMatchObject([{ kind: 'source-batch', payload: {
    payloads: [{ overrides: { deletedSelectors: ['span-0'] } }],
  } }]);
  release(); await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/components/Card.astro')).toBe('<main><span>Second</span></main>');
  } finally { release(); runtime.close(); }
});
it('a rejected production instance Push preserves both undo stacks and its deletion override', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main class="p-2"></main>',
    'src/components/Card.astro': '<main><span>First</span><span>Second</span></main>' }, { beforeCommand: () => gate });
  try {
  const { result } = mount(); setClassWriteBaseline(key, 'p-2');
  await act(async () => { await result.current.classes.setClasses(key, 'p-4'); });
  await act(async () => { await result.current.undo.undo(); });
  const args = instancePushArgs(result.current.undo.takeSnapshot);
  const reject = () => { throw new Error('push quota'); }; db.durableEdits.hook('creating', reject);
  try { await act(async () => { expect((await pushInstanceToSource(args)).ok).toBe(false); }); }
  finally { db.durableEdits.hook('creating').unsubscribe(reject); }
  expect(result.current.undo.canRedo).toBe(true);
  expect(result.current.undo.canUndo).toBe(false);
  expect(h.doc.getMap<Y.Map<unknown>>('elements').get('el-1')?.get('deletedSelectors')).toBeInstanceOf(Y.Array);
  expect(h.doc.getMap('masters').size).toBe(0);
  release(); await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/components/Card.astro')).toBe('<main><span>First</span><span>Second</span></main>');
  } finally { release(); runtime.close(); }
});
it('accepts first-edit class undo and redo before publishing, with immediate source commands', async () => {
  const { result } = mount(); setClassWriteBaseline(key, 'p-2');
  await act(async () => { await result.current.classes.setClasses(key, 'p-4'); });
  await act(async () => { await result.current.undo.undo(); });
  let rows = await listUnmaterialized(projectId);
  expect(rows).toHaveLength(2);
  expect(rows[1].commands).toMatchObject([{ kind: 'class-write', payload: { newClasses: 'p-2', baseClasses: 'p-4' } }]);
  expect(h.doc.getMap('sourceClasses').has(key)).toBe(false);
  await act(async () => { await result.current.undo.redo(); });
  rows = await listUnmaterialized(projectId);
  expect(rows).toHaveLength(3);
  expect(rows[2].commands).toMatchObject([{ kind: 'class-write', payload: { newClasses: 'p-4', baseClasses: 'p-2' } }]);
});
it('rejected class undo leaves the live value and undo stack unchanged', async () => {
  const { result } = mount(); setClassWriteBaseline(key, 'p-2');
  await act(async () => { await result.current.classes.setClasses(key, 'p-4'); });
  const reject = () => { throw new Error('undo quota'); }; db.durableEdits.hook('creating', reject);
  try { await act(async () => { await result.current.undo.undo(); }); }
  finally { db.durableEdits.hook('creating').unsubscribe(reject); }
  expect(result.current.classes.getClassesFromYjs(key)).toBe('p-4');
  expect(result.current.undo.canUndo).toBe(true);
  expect(result.current.undo.canRedo).toBe(false);
  expect(await db.durableEdits.count()).toBe(1);
});
it('a rejected new class edit preserves the previous redo stack', async () => {
  const { result } = mount(); setClassWriteBaseline(key, 'p-2');
  await act(async () => { await result.current.classes.setClasses(key, 'p-4'); });
  await act(async () => { await result.current.undo.undo(); });
  expect(result.current.undo.canRedo).toBe(true);
  const reject = () => { throw new Error('edit quota'); }; db.durableEdits.hook('creating', reject);
  try { await act(async () => { await result.current.classes.setClasses(key, 'p-8'); }); }
  finally { db.durableEdits.hook('creating').unsubscribe(reject); }
  expect(result.current.undo.canRedo).toBe(true);
  expect(result.current.undo.canUndo).toBe(false);
});
it('uses the accepted restoration as the next edit baseline and second undo anchor after the overlay was removed', async () => {
  let source = '<main class="p-2"></main>';
  let offline = false;
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (_url, init) => {
    if (offline) return new Response('offline', { status: 503 });
    if (init?.method === 'POST') {
      const prepared = JSON.parse(String(init.body));
      if (source === prepared.beforeSource) source = prepared.afterSource;
      return new Response('{}');
    }
    return new Response(source);
  } });
  const { result } = mount(); setClassWriteBaseline(key, 'p-2');
  await act(async () => { await result.current.classes.setClasses(key, 'p-4'); });
  await act(async () => { await result.current.classes.saveAll(); });
  expect(source).toContain('p-4');
  offline = true;
  await act(async () => { await result.current.undo.undo(); });
  expect(h.doc.getMap('sourceClasses').has(key)).toBe(false);
  await act(async () => { await result.current.classes.setClasses(key, 'p-8'); });
  const rows = await listUnmaterialized(projectId);
  expect(rows.at(-1)?.commands).toMatchObject([{ kind: 'class-write', payload: { newClasses: 'p-8', baseClasses: 'p-2' } }]);
  await act(async () => { await result.current.undo.undo(); });
  expect((await listUnmaterialized(projectId)).at(-1)?.commands).toMatchObject([
    { kind: 'file-batch', payload: { files: [{ file: 'src/pages/index.astro',
      beforeSource: '<main class="p-8"></main>', afterSource: '<main class="p-2"></main>',
    }] } },
  ]);
  offline = false;
  await act(async () => { await result.current.classes.saveAll(); });
  expect(source).toBe('<main class="p-2"></main>');
});
it('still refuses first-edit undo when no original class baseline is known', async () => {
  const unknownKey = 'src/pages/unknown.astro:1:1';
  const { result } = mount();
  await act(async () => { await result.current.classes.setClasses(unknownKey, 'p-4'); });
  await act(async () => { await result.current.undo.undo(); });
  expect(result.current.classes.getClassesFromYjs(unknownKey)).toBe('p-4');
  expect(result.current.undo.canUndo).toBe(true);
  expect(result.current.undo.canRedo).toBe(false);
  expect(await db.durableEdits.count()).toBe(1);
});
