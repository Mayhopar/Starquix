import 'fake-indexeddb/auto';
import React from 'react';
import * as Y from 'yjs';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { PagesProvider, usePages } from '@/context/PagesContext';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { applyCommand } from '@/store/commands';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import * as storage from '../store';

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function mount() {
  const hook = await renderReadyEditorHook(() => ({ doc: useEditorDoc(), pages: usePages(), undo: useUndoContext() }), {
    wrapper: ({ children }) => <EditorProvider><UndoProvider><PagesProvider>{children}</PagesProvider></UndoProvider></EditorProvider>,
  });
  act(() => {
    hook.result.current.doc.getMap('meta').set('projectId', 'pages-owner');
    for (const id of ['page-a', 'page-b']) applyCommand(hook.result.current.doc, { type: 'ADD_PAGE', page: {
      id, name: id, rootElementIds: [], children: [],
    } });
  });
  return hook;
}
it.each(['create', 'delete', 'rename', 'move', 'home'] as const)('keeps %s unpublished and undo untouched on rejection', async kind => {
  const { result } = await mount();
  const before = Y.encodeStateAsUpdate(result.current.doc);
  vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  await act(async () => {
    const pages = result.current.pages;
    const pending = kind === 'create' ? pages.createPage('Child', 'page-a')
      : kind === 'delete' ? pages.deletePage('page-b')
      : kind === 'rename' ? pages.renamePage('page-b', 'New')
      : kind === 'move' ? pages.movePage('page-b', 'page-a', 0)
      : pages.setHomePage('page-b');
    expect(Y.encodeStateAsUpdate(result.current.doc)).toEqual(before);
    await Promise.resolve(pending).catch(() => {});
  });
  expect(Y.encodeStateAsUpdate(result.current.doc)).toEqual(before);
  expect(result.current.undo.canUndo).toBe(false);
  expect(await db.durableEdits.count()).toBe(0);
});
