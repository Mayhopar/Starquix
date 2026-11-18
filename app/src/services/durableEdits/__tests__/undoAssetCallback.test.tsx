import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { db } from '@/db';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { useDispatch } from '@/store/hooks';
import { applyCommand } from '@/store/commands';
import { resetLocalTransportForTests, setLocalTransport } from '@/utils/sqLocalBase';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const key = 'src/pages/index.astro:1:1';
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  h.doc = new Y.Doc();
  h.doc.getMap('meta').set('projectId', `asset-callback-${crypto.randomUUID()}`);
  applyCommand(h.doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key, classes: 'p-2',
    sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 } });
});
afterEach(() => {
  cleanup(); h.doc.destroy(); resetLocalTransportForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['undo', 'redo'] as const)('keeps accepted %s saved and flushes source when its asset callback throws', async direction => {
  const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
  let source = '<main class="p-4"></main>';
  setLocalTransport({ projectPath: `wc://${h.doc.getMap('meta').get('projectId')}`, fetch: async (_url, init) => {
    if (init?.method === 'POST') {
      const prepared = JSON.parse(String(init.body));
      if (source === prepared.beforeSource) source = prepared.afterSource;
      return new Response('{}');
    }
    return new Response(source);
  } });
  const { result } = renderHook(() => ({ undo: useUndoContext(), dispatch: useDispatch() }), {
    wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider>,
  });
  await act(async () => {
    result.current.undo.takeSnapshot({
      reverse: () => { if (direction === 'undo') throw new Error('asset reverse failed'); },
      forward: () => { if (direction === 'redo') throw new Error('asset forward failed'); },
    });
    await result.current.dispatch({ type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes: 'p-4', originalClasses: 'p-2' });
  });
  await act(async () => { await result.current.undo.undo(); });
  if (direction === 'redo') {
    await waitFor(() => { expect(source).toBe('<main class="p-2"></main>'); });
    await act(async () => { await result.current.undo.redo(); });
  }
  const restored = direction === 'undo' ? 'p-2' : 'p-4';
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('classes')).toBe(restored);
  expect(result.current.undo.canRedo).toBe(direction === 'undo');
  expect(result.current.undo.canUndo).toBe(direction === 'redo');
  expect(errors.mock.calls.map(([message]) => String(message))).toEqual([]);
  await waitFor(() => { expect(source).toBe(`<main class="${restored}"></main>`); });
  expect(await db.durableEdits.count()).toBe(direction === 'undo' ? 2 : 3);
});
