import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { UndoProvider } from '@/context/UndoContext';
import { useReorderElements } from '@/hooks/useReorderElements';
import { useLayersDrag } from '@/components/Editor/useLayersDrag';
import { applyCommand } from '@/store/commands';
import { DRAG_TYPES } from '@/types/drag';
import * as store from '../store';
import { awaitAccepted } from '../acceptance';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, scanned: [] as never[] }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElements: () => ({ scannedElements: h.scanned }),
  useScannedElementsRef: () => ({ scannedElementsRef: { current: h.scanned }, scannedByKeyRef: { current: new Map() } }),
}));
beforeEach(async () => {
  await db.delete(); await db.open(); h.doc = new Y.Doc();
  h.doc.getMap('meta').set('projectId', `reorder-hook-${crypto.randomUUID()}`);
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'page', name: 'Page', rootElementIds: [], children: [] } });
  applyCommand(h.doc, { type: 'SET_CURRENT_PAGE', pageId: 'page' });
  for (const key of ['drawn-a', 'drawn-b', 'drawn-parent']) applyCommand(h.doc, { type: 'ADD_DRAWN_ELEMENT',
    element: { key, pageId: 'page', tag: 'div', classes: 'grid', textContent: '', parentKey: null, insertIndex: 0 } });
  h.scanned = ['drawn-a', 'drawn-b', 'drawn-parent'].map(key => ({ key, parentKey: null, tagName: 'div', hasSourceTracking: true })) as never[];
});
afterEach(async () => { await awaitAccepted(h.doc.getMap('meta').get('projectId') as string).catch(() => {}); cleanup(); h.doc.destroy(); vi.restoreAllMocks(); });
const wrapper = ({ children }: { children: React.ReactNode }) => <UndoProvider>{children}</UndoProvider>;

it('root reorder returns its pending acceptance and exposes storage rejection', async () => {
  const { result } = renderHook(() => useReorderElements(), { wrapper });
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('root quota'));
  await act(async () => {
    await expect(Promise.resolve(result.current.reorderRootElements(0, 1))).rejects.toThrow('root quota');
  });
});

it('a Layers group reparent and final order accept as one revision', async () => {
  const { result } = renderHook(() => useLayersDrag(), { wrapper });
  await act(async () => {
    await result.current.onDragEnd({
      active: { id: 'drawn-a', data: { current: { type: DRAG_TYPES.LAYERS_PANEL, groupKeys: ['drawn-a', 'drawn-b'] } } },
      over: { id: 'drawn-parent', data: { current: { node: { key: 'drawn-parent', tagName: 'div', children: [] } } } },
    } as never);
  });
  expect(await db.durableEdits.count()).toBe(1);
  const elements = h.doc.getMap<Y.Map<unknown>>('elements');
  expect(elements.get('drawn-a')?.get('parentId')).toBe('drawn-parent');
  expect(elements.get('drawn-b')?.get('parentId')).toBe('drawn-parent');
});
