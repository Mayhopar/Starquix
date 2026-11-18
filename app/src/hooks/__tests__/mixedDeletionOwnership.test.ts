import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { deleteLocalElementGroup } from '../useKeyboardShortcuts';
import * as storage from '@/services/durableEdits/store';
import { getActiveSaveProjectId, setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalPageFile, setLocalExpectedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import React from 'react';
import { act, cleanup } from '@testing-library/react';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import {
  PAGE_FILE, armLocalPage, flushAccepted, freshLocalProjectId, startLocalDeleteRuntime, stopLocalDeleteRuntime,
} from './localDeleteRuntime';

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); });

// Since fdd2d12f the group plans every source member into ONE source gesture
// accepted durably (no per-member deleteLocal seam), so "the page changes
// during the await" now means: during durable acceptance of the gesture. The
// real route table + temp disk (projectFsRuntime) replaces the hand-rolled
// transport; undo runs through the real UndoProvider/journal.
it('keeps completed source deletion undoable in its provider when the page changes during the await', async () => {
  const projectId = freshLocalProjectId('owner_a');
  const original = '<main>\n  <p>Keep</p>\n  <p>Delete</p>\n</main>\n';
  const runtime = await startLocalDeleteRuntime(projectId, { [PAGE_FILE]: original });
  try {
    const { result } = await renderReadyEditorHook(() => ({ doc: useEditorDoc(), undo: useUndoContext() }), {
      wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(EditorProvider, null, React.createElement(UndoProvider, null, children)),
    });
    const { doc, undo } = result.current;
    act(() => {
      doc.getMap('meta').set('projectId', projectId);
      applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-a', name: 'Home', rootElementIds: [], children: [] } });
      applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-a', pageId: 'page-a', tag: 'div', classes: '', textContent: '', parentKey: null, insertIndex: 0 } });
    });
    setActiveSaveProjectId(projectId);
    let unblock!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const accept = storage.acceptStoredEdit;
    vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await blocked; return accept(input); });
    let selectionCleared = false;
    await act(async () => {
      const pending = deleteLocalElementGroup([
        { key: 'drawn-a', elementId: 'drawn-a' },
        { key: `${PAGE_FILE}:3:3`, elementId: null },
      ], {
        docDeps: { doc, dispatch: action => applyCommand(doc, action), scannedElements: [] },
        scannedByKey: new Map(), takeSnapshot: () => {}, pushUndo: undo.pushStructuralUndo,
        clearSelection: () => { selectionCleared = true; },
      });
      await started;
      setLocalExpectedRoute('/other'); setLocalPageFile('src/pages/other.astro');
      unblock();
      await pending;
    });
    await flushAccepted(projectId);
    expect(runtime.read(PAGE_FILE)).toBe('<main>\n  <p>Keep</p>\n</main>\n');
    expect(doc.getMap('elements').has('drawn-a')).toBe(false);
    expect(selectionCleared).toBe(false);
    expect(result.current.undo.canUndo).toBe(true);

    // The real UndoProvider/journal path restores the source byte-exact.
    armLocalPage();
    await act(async () => { await result.current.undo.undo(); });
    await flushAccepted(projectId);
    expect(runtime.read(PAGE_FILE)).toBe(original);
    expect(result.current.undo.canRedo).toBe(true);
  } finally {
    await stopLocalDeleteRuntime(runtime, projectId);
  }
});

it('does not publish an inverse from a source member that never confirms completion', async () => {
  const doc = createEditorDoc(); doc.getMap('meta').set('projectId', 'browser_owner-a');
  const published: StructuralUndoRecord[] = [];
  await deleteLocalElementGroup([{ key: 'src/pages/index.astro:3:1', elementId: null }], {
    docDeps: { doc, dispatch: action => applyCommand(doc, action), scannedElements: [] },
    scannedByKey: new Map(), takeSnapshot: () => {}, clearSelection: () => {},
    pushUndo: record => { published.push(record); },
    deleteLocal: async ({ pushUndo }) => {
      pushUndo?.({ structuralOp: { forward: [], inverse: [{ kind: 'restore', loc: { file: 'src/pages/index.astro', line: 3, column: 1 }, text: '<p>not deleted</p>' }] } });
      return false;
    },
  });
  expect(published).toEqual([]);
});

it.each(['project', 'project ABA', 'surface', 'surface ABA'] as const)('does not continue mixed deletion after %s changes during acceptance', async change => {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', 'browser_owner-a');
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-a', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-a', pageId: 'page-a', tag: 'div', classes: '', textContent: '', parentKey: null, insertIndex: 0 } });
  setActiveSaveProjectId('browser_owner-a');
  setLocalExpectedRoute('/');
  setLocalPageFile('src/pages/index.astro');
  let unblock!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const accept = storage.acceptStoredEdit;
  vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await blocked; return accept(input); });
  const writes: Array<string | null> = [];
  let cleared = false;
  const pending = deleteLocalElementGroup([
    { key: 'drawn-a', elementId: 'drawn-a' },
    { key: 'src/pages/index.astro:3:1', elementId: null },
  ], {
    docDeps: { doc, dispatch: action => applyCommand(doc, action), scannedElements: [] },
    scannedByKey: new Map(), takeSnapshot: () => {}, clearSelection: () => { cleared = true; },
    deleteLocal: async () => { writes.push(getActiveSaveProjectId()); return true; },
  });
  await started;
  if (change.startsWith('project')) {
    setActiveSaveProjectId('browser_owner-b');
    if (change.endsWith('ABA')) setActiveSaveProjectId('browser_owner-a');
  } else {
    setLocalExpectedRoute('/other');
    setLocalPageFile('src/pages/other.astro');
    if (change.endsWith('ABA')) { setLocalExpectedRoute('/'); setLocalPageFile('src/pages/index.astro'); }
  }
  unblock();
  await pending;
  expect(doc.getMap('elements').has('drawn-a')).toBe(false);
  expect(writes).toEqual([]);
  expect(cleared).toBe(false);
});
