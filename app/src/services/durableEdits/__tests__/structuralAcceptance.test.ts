import 'fake-indexeddb/auto';
import React from 'react';
import * as Y from 'yjs';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { useDispatch } from '@/store/hooks';
import { applyCommand } from '@/store/commands';
import { emptyClassData, type EditorCommand } from '@/store/types';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import * as store from '../store';
import { acceptProjectEdit } from '../acceptance';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { isComponentInstanceContainerKey } from '@/store/keyKind';
import { insertLocalDrawnElement } from '@/components/Canvas/localDrawInsert';
import { deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { peekLocalPendingSelection, clearLocalPendingSelection } from '@/utils/localPendingSelection';
import { setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import * as localPageSync from '@/utils/localPageSync';
import { applyStructuralTransform } from '../structuralTransform';
import { acceptDocumentMutation } from '@/store/documentMutation';
import { dispatchDurableAction } from '@/store/durableDispatch';
import { projectFsRuntime } from '@/test/projectFsRuntime';

const page = (id: string) => ({ id, name: id, rootElementIds: [], children: [] });
const element = (id: string) => ({ id, pageId: 'page-a', parentId: null, index: 0, type: 'frame' as const, classes: emptyClassData() });
async function mount() {
  const hook = await renderReadyEditorHook(() => ({ doc: useEditorDoc(), dispatch: useDispatch(), undo: useUndoContext() }), {
    wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(EditorProvider, null, React.createElement(UndoProvider, null, children)),
  });
  const { doc } = hook.result.current;
  act(() => {
    doc.getMap('meta').set('projectId', 'structural-project');
    applyCommand(doc, { type: 'ADD_PAGE', page: page('page-a') });
    applyCommand(doc, { type: 'ADD_PAGE', page: page('page-b') });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: element('el-a') });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: element('el-b') });
  });
  return hook;
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); clearLocalPendingSelection(); });

describe('structural dispatch acceptance', () => {
  it.each(['mutation', 'dispatch'] as const)('isolates a throwing %s snapshot observer after acceptance', async kind => {
    const { result } = await mount();
    const snapshot = { stage: () => {}, commit: () => { throw new Error('snapshot observer'); } };
    const action = { type: 'ADD_PAGE', page: page('page-c') } as const;
    const pending = kind === 'mutation' ? acceptDocumentMutation(result.current.doc, staged => { applyCommand(staged, action); }, snapshot)
      : dispatchDurableAction(result.current.doc, action, [], undefined, snapshot);
    await act(async () => { await expect(pending).resolves.toMatchObject({ revision: 1 }); });
    expect(result.current.doc.getMap('pages').has('page-c')).toBe(true);
    expect(await db.durableEdits.count()).toBe(1);
  });
  it('refuses an unscoped legacy page replay before writing any source and retains its entry', async () => {
    const { result } = await mount();
    let source = '<main />\n';
    vi.spyOn(viteStructuralWriter, 'writeRestoreRegion').mockImplementation(async (loc, lineCount, segment) => {
      source = applyStructuralTransform(source, { kind: 'restore-region', loc, lineCount, segment }).content;
      return { success: true, restoredLine: loc.line, file: loc.file };
    });
    vi.spyOn(localPageSync, 'moveLocalPageFile').mockRejectedValue(new Error('rename refused'));
    act(() => result.current.undo.pushStructuralUndo({ structuralOp: {
      forward: [],
      inverse: [
        { kind: 'restore-region', loc: { file: 'src/pages/index.astro', line: 1, column: 1 }, lineCount: 1, segment: '<Card />\n<main />\n' },
        { kind: 'page-move', folder: '/project', from: 'index.astro', to: 'home.astro' },
      ],
    } }));
    await act(async () => { await result.current.undo.undo(); });
    await act(async () => { await result.current.undo.undo(); });
    expect(source).toBe('<main />\n');
    expect(viteStructuralWriter.writeRestoreRegion).not.toHaveBeenCalled();
    expect(localPageSync.moveLocalPageFile).not.toHaveBeenCalled();
    expect(result.current.undo.canUndo).toBe(true);
    expect(result.current.undo.canRedo).toBe(false);
  });

  it('persists pre-generated default child IDs with the component container prefix', async () => {
    const { result } = await mount();
    const child = { componentType: 'Card' };
    const baseline = Y.encodeStateAsUpdate(result.current.doc);
    await act(async () => {
      await result.current.dispatch({ type: 'ADD_ELEMENT', element: {
        ...element('el-parent'), defaultChildren: [child, { componentType: 'Card', id: 'el-existing' }],
      } });
    });
    const elements = result.current.doc.getMap<Y.Map<unknown>>('elements');
    const ids = [...elements.entries()].filter(([, value]) => value.get('parentId') === 'el-parent').map(([id]) => id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('el-existing');
    expect(ids.every(isComponentInstanceContainerKey)).toBe(true);
    expect(child).not.toHaveProperty('id');
    const reload = new Y.Doc();
    Y.applyUpdate(reload, baseline);
    for (const row of await store.listUnmaterialized('structural-project')) Y.applyUpdate(reload, row.yjsUpdate!);
    expect([...reload.getMap('elements').keys()]).toEqual(expect.arrayContaining(ids));
    reload.destroy();
  });

  // Catch the live reducer bypass: every representative must leave all maps,
  // observer notifications and the journal unchanged on rejected storage.
  const actions: EditorCommand[] = [
    { type: 'ADD_PAGE', page: page('page-c') },
    { type: 'DELETE_PAGE', pageId: 'page-b' },
    { type: 'MOVE_PAGE', pageId: 'page-b', newParentId: null, index: 0 },
    { type: 'ADD_ELEMENT', element: element('el-c') },
    { type: 'REMOVE_ELEMENT', elementId: 'el-a' },
    { type: 'REORDER_PAGE_ELEMENTS', pageId: 'page-a', elementIds: ['el-a', 'el-b'] },
    { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-c', tag: 'div', classes: '', textContent: '', parentKey: null, insertIndex: 0, pageId: 'page-a' } },
  ];
  it.each(actions)('does not publish $type when IndexedDB rejects', async action => {
    const { result } = await mount();
    const { doc, dispatch } = result.current;
    const before = Y.encodeStateAsUpdate(doc);
    const updates: Uint8Array[] = [];
    doc.on('update', update => updates.push(update));
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await act(async () => {
      const pending = dispatch(action);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
      await expect(Promise.resolve(pending)).rejects.toThrow('quota');
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(updates).toEqual([]);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('shares acceptance ordering with non-dispatch edits and persists the created ID', async () => {
    const { result } = await mount();
    const { doc, dispatch } = result.current;
    const first = acceptProjectEdit(doc, { projectId: 'structural-project', operationId: 'first', commands: [],
      mutate: staged => { applyCommand(staged, { type: 'ADD_PAGE', page: page('page-c') }); },
    });
    await act(async () => {
      const second = dispatch({ type: 'ADD_ELEMENT', element: { ...element('el-c'), pageId: 'page-c' } });
      await first;
      expect(await second).toMatchObject({ revision: 2 });
    });
    expect(doc.getMap<Y.Map<unknown>>('elements').get('el-c')?.get('pageId')).toBe('page-c');
    const rows = await store.listUnmaterialized('structural-project');
    const reload = new Y.Doc();
    for (const row of rows) Y.applyUpdate(reload, row.yjsUpdate!);
    expect(reload.getMap<Y.Map<unknown>>('elements').get('el-c')?.get('pageId')).toBe('page-c');
  });

  it('keeps navigation synchronous without accepting a project revision', async () => {
    const { result } = await mount();
    act(() => { result.current.dispatch({ type: 'SET_CURRENT_PAGE', pageId: 'page-b' }); });
    expect(result.current.doc.getMap('meta').get('currentPageId')).toBe('page-b');
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('does not create an undo step or clear redo for a rejected gesture', async () => {
    const { result } = await mount();
    await act(async () => {
      result.current.undo.takeSnapshot();
      await result.current.dispatch({ type: 'ADD_PAGE', page: page('page-c') });
    });
    await act(async () => { await result.current.undo.undo(); });
    expect(result.current.undo.canRedo).toBe(true);
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await act(async () => {
      result.current.undo.takeSnapshot();
      await expect(Promise.resolve(result.current.dispatch({ type: 'ADD_PAGE', page: page('page-d') }))).rejects.toThrow('quota');
    });
    expect(result.current.undo.canUndo).toBe(false);
    expect(result.current.undo.canRedo).toBe(true);
  });

  it('preserves live state and the undo entry when undo acceptance rejects', async () => {
    const { result } = await mount();
    await act(async () => {
      result.current.undo.takeSnapshot();
      await result.current.dispatch({ type: 'ADD_PAGE', page: page('page-c') });
    });
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await act(async () => { await result.current.undo.undo(); });
    expect(result.current.doc.getMap('pages').has('page-c')).toBe(true);
    expect(result.current.undo.canUndo).toBe(true);
    expect(result.current.undo.canRedo).toBe(false);
  });

  it('rejects structural source writes without mutating source when storage rejects', async () => {
    setActiveSaveProjectId('structural-project');
    const runtime = projectFsRuntime('structural-project', { 'src/pages/index.astro': '<main />' });
    try {
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await expect(viteStructuralWriter.writeRemove({ file: 'src/pages/index.astro', line: 1, column: 1 }, true)).rejects.toThrow('quota');
    expect(await db.durableEdits.count()).toBe(0);
    expect(await db.durableCommandReceipts.count()).toBe(0);
    expect(runtime.read('src/pages/index.astro')).toBe('<main />');
    } finally { runtime.close(); }
  });

  it('keeps a structural undo entry when its grouped acceptance rejects', async () => {
    const { result } = await mount();
    const before = Y.encodeStateAsUpdate(result.current.doc);
    act(() => result.current.undo.pushStructuralUndo({ structuralOp: {
      forward: [{ kind: 'append-page', pageFile: 'src/pages/index.astro', markup: '<aside />' }],
      inverse: [
        { kind: 'restore-region', loc: { file: 'src/pages/index.astro', line: 1, column: 1 }, lineCount: 1, segment: '<main />' },
        { kind: 'import', pageFile: 'src/pages/index.astro', name: 'Card', importPath: './Card.astro', remove: true },
      ],
    } }));
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await act(async () => { await result.current.undo.undo(); });
    expect(result.current.undo.canUndo).toBe(true);
    expect(result.current.undo.canRedo).toBe(false);
    expect(Y.encodeStateAsUpdate(result.current.doc)).toEqual(before);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('keeps local draw selection and source untouched through the real writer when storage rejects', async () => {
    setActiveSaveProjectId('structural-project');
    const runtime = projectFsRuntime('structural-project', { 'src/pages/index.astro': '<main />' });
    try {
    setLocalPageFile('src/pages/index.astro');
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const result = await insertLocalDrawnElement({
      draw: { tag: 'div', classes: '', textContent: '', parentKey: null }, isSlotDraw: false,
      scannedElements: [], pageFile: 'src/pages/index.astro',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/quota/);
    expect(peekLocalPendingSelection()).toBeNull();
    expect(await db.durableEdits.count()).toBe(0);
    expect(await db.durableCommandReceipts.count()).toBe(0);
    expect(runtime.read('src/pages/index.astro')).toBe('<main />');
    } finally { runtime.close(); }
  });
});
