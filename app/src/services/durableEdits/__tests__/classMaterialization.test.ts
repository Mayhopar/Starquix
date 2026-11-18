import 'fake-indexeddb/auto';
import React from 'react';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { applyCommand } from '@/store/commands';
import { ClassStoreProvider, useClassStore } from '@/context/ClassStoreContext';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { listUnmaterialized } from '../store';
import { pushOverridesToSource } from '@/utils/pushOverridesToSource';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc,
  undo: { takeSnapshot: vi.fn(), isUndoingRef: { current: false } } }));
vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (selector: (doc: Y.Doc) => unknown) => selector(h.doc),
  useDispatch: () => (command: Parameters<typeof applyCommand>[1]) => applyCommand(h.doc, command),
}));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => h.undo }));
let projectId: string;
let projectSequence = 0;
const key = 'src/pages/index.astro:1:1';
let requests: string[];
beforeEach(async () => {
  projectId = `browser_class_durability_${++projectSequence}`;
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  requests = [];
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async url => {
    requests.push(url); return new Response('<main class="p-2"></main>');
  } });
});
afterEach(() => { cleanup(); h.doc.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount() {
  const hook = renderHook(useClassStore, { wrapper: ({ children }) => React.createElement(ClassStoreProvider, null, children) });
  act(() => hook.result.current.registerElement(key, 'p-2', { file: 'src/pages/index.astro', line: 1, column: 1 }));
  return hook;
}

it('commits a class edit and its replayable Yjs update before the five-second source debounce', async () => {
  const { result } = mount();
  const fresh = new Y.Doc(); Y.applyUpdate(fresh, Y.encodeStateAsUpdate(h.doc));
  await act(async () => { await result.current.setClasses(key, 'p-4'); });
  const rows = await listUnmaterialized(projectId);
  expect(rows).toHaveLength(1);
  expect(rows[0].commands).toMatchObject([{ kind: 'class-write', payload: { newClasses: 'p-4' } }]);
  Y.applyUpdate(fresh, rows[0].yjsUpdate!);
  expect(fresh.getMap<Y.Map<string>>('sourceClasses').get(key)?.get('classes')).toBe('p-4');
  expect(requests).toEqual([]);
  fresh.destroy();
});

it('rolls back the speculative control value and reports the storage issue without dispatching source on rejection', async () => {
  const { result } = mount();
  const reject = () => { throw new Error('IndexedDB quota exceeded'); };
  db.durableEdits.hook('creating', reject);
  try { await act(async () => { await result.current.setClasses(key, 'p-8'); }); }
  finally { db.durableEdits.hook('creating').unsubscribe(reject); }
  expect(result.current.getClasses(key)).toBe('p-2');
  expect(result.current.getClassesFromYjs(key)).toBe('p-2');
  expect(result.current).toMatchObject({ storageIssue: { key, message: expect.stringMatching(/quota/i) } });
  expect(await db.durableEdits.count()).toBe(0);
  expect(requests).toEqual([]);
});
it('protects an accepted placement-suffixed edit from stale iframe registration while its source command is pending', async () => {
  const { result } = mount();
  const placement = `${key}~p0123456789abcdef#2`;
  const location = { file: 'src/pages/index.astro', line: 1, column: 1 };
  act(() => result.current.registerElement(placement, 'p-2', location));
  await act(async () => { await result.current.setClasses(placement, 'p-4'); });
  await waitFor(() => expect(result.current.dirtyKeys.size).toBe(1));
  act(() => result.current.registerElement(placement, 'p-2', location));
  expect(result.current.getClassesFromYjs(placement)).toBe('p-4');
  expect(requests).toEqual([]);
});
it('accepts tokenized instance classes as an overlay and restores that committed control value after rejection', async () => {
  const instance = new Y.Map<unknown>(); instance.set('id', 'el-1');
  instance.set('staticMarkup', '<main class="p-2">Title</main>');
  instance.set('astroSource', 'Card.astro'); h.doc.getMap('elements').set('el-1', instance);
  const { result } = mount();
  await act(async () => { await result.current.setClasses('el-1:main-0', 'p-4 flex'); });
  const overrides = instance.get('classOverrides') as Y.Map<Y.Map<Y.Array<string>>>;
  expect(overrides.get('main-0')?.get('base')?.toArray()).toEqual(['p-4', 'flex']);
  expect((await db.durableEdits.toArray())[0].commands).toEqual([]);
  const reject = () => { throw new Error('quota'); }; db.durableEdits.hook('creating', reject);
  try { await act(async () => { await result.current.setClasses('el-1:main-0', 'p-8'); }); }
  finally { db.durableEdits.hook('creating').unsubscribe(reject); }
  expect(result.current.getClassesFromYjs('el-1:main-0')).toBe('p-4 flex');
  expect(result.current.getClasses('el-1:main-0')).toBe('p-4 flex');
  expect(requests).toEqual([]);
});
it('reports applied category operations, not file count, from the durable source preparation', async () => {
  let source = '<main class="p-2"><h1>Old</h1></main>';
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (_url, init) => {
    if (init?.method === 'POST') source = JSON.parse(String(init.body)).afterSource;
    return new Response(source);
  } });
  const instance = new Y.Map<unknown>(); instance.set('astroSource', 'Card.astro');
  instance.set('staticMarkup', '<main data-key="el-1:main-0"><h1 data-key="el-1:h1-0">Old</h1></main>');
  const classes = new Y.Map<Y.Map<Y.Array<string>>>();
  const base = new Y.Map<Y.Array<string>>(); const tokens = new Y.Array<string>(); tokens.push(['p-4']);
  base.set('base', tokens); classes.set('main-0', base); instance.set('classOverrides', classes);
  const text = new Y.Map<unknown>(); text.set('textContent', 'New');
  h.doc.getMap('sourceText').set('el-1:h1-0', text);
  h.doc.getMap('elements').set('el-1', instance);
  const result = await pushOverridesToSource(h.doc, 'el-1');
  expect(result?.appliedTotal).toBe(2);
  expect(source).toContain('p-4'); expect(source).toContain('>New<');
  expect((await db.durableCommandReceipts.where('projectId').equals(projectId).toArray())[0].prepared).toMatchObject({ appliedTotal: 2 });
});
