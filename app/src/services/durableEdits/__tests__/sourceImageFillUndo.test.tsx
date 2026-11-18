import 'fake-indexeddb/auto';
import React from 'react';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { FillBlock } from '@/components/DesignBar/blocks/FillBlock';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { setLocalPageFile, setLocalExpectedRoute, setLocalScannedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { awaitAccepted } from '../acceptance';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { acceptStructuralOperations } from '../structuralAcceptance';
import type { DurableFileChange } from '../types';

const view = vi.hoisted(() => ({ projectId: '', file: 'src/pages/index.astro' }));
vi.mock('@/context/SelectionContext', () => ({
  useSelectedElement: () => ({ key: `${view.file}:2:3`, tagName: 'img', sourceLocation: { file: view.file, line: 2, column: 3 },
    imageSrc: '/original.png', imageAlt: 'Original', imagePreviewDataUrl: null }),
  useRectActions: () => ({ getSelectedRect: () => null }),
  useSelectionContext: () => ({ patchSelection: vi.fn() }),
}));
vi.mock('@/context/ClassStoreContext', () => ({ useClassStore: () => ({ registerElement: vi.fn() }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => `wc://${view.projectId}` }));
vi.mock('@/assets/icons', async orig => Object.fromEntries(Object.keys(await orig<Record<string, unknown>>()).map(key => [key, () => null])));

const initial = '<main>\n  <img data-src="/deferred.png" SRC="/original.png" alt="Original" />\n  <p>Prior structure</p>\n</main>\n';
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  view.projectId = `browser_fill_undo_${crypto.randomUUID()}`;
  markFilesTruth(view.projectId); setActiveSaveProjectId(view.projectId);
  setLocalPageFile(view.file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  runtime = projectFsRuntime(view.projectId, { [view.file]: initial });
});
afterEach(async () => {
  cleanup(); await flushDurableSourceWritesThrough(view.projectId, await awaitAccepted(view.projectId));
  runtime.close(); unmarkFilesTruth(view.projectId); setActiveSaveProjectId(null); _resetLocalPageSyncForTests();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const flush = async () => { await flushDurableSourceWritesThrough(view.projectId, await awaitAccepted(view.projectId)); };

it('native Fill src and alt edits own Undo/Redo ahead of the preceding structural edit', async () => {
  const { result } = await renderReadyEditorHook(() => ({ doc: useEditorDoc(), undo: useUndoContext() }), {
    wrapper: ({ children }) => <EditorProvider><UndoProvider>{children}<FillBlock classes="" onClassesChange={() => {}} /></UndoProvider></EditorProvider>,
  });
  act(() => { result.current.doc.getMap('meta').set('projectId', view.projectId); });
  await act(async () => {
    const [removed] = await acceptStructuralOperations([{ kind: 'remove', loc: { file: view.file, line: 3, column: 3 } }], { doc: result.current.doc });
    result.current.undo.pushStructuralUndo({ structuralOp: { forward: [], inverse: [], sourceFiles: removed.sourceFiles as DurableFileChange[] } });
    await flush();
  });
  const beforeMedia = runtime.read(view.file);
  expect(beforeMedia).not.toContain('Prior structure');
  fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
  for (const [label, value] of [['Image URL', '/uploads/replacement.png'], ['Image description', 'Updated description']]) {
    await act(async () => {
      const field = screen.getByRole('textbox', { name: label });
      fireEvent.change(field, { target: { value } }); fireEvent.keyDown(field, { key: 'Enter' }); fireEvent.blur(field);
      await flush();
    });
  }
  const replaced = beforeMedia.replace('/original.png', '/uploads/replacement.png');
  const described = replaced.replace('alt="Original"', 'alt="Updated description"');
  expect(runtime.read(view.file)).toBe(described);
  await act(async () => { await result.current.undo.undo(); await flush(); });
  expect(runtime.read(view.file)).toBe(replaced);
  await act(async () => { await result.current.undo.undo(); await flush(); });
  expect(runtime.read(view.file)).toBe(beforeMedia);
  await act(async () => { await result.current.undo.redo(); await flush(); });
  expect(runtime.read(view.file)).toBe(replaced);
  await act(async () => { await result.current.undo.redo(); await flush(); });
  expect(runtime.read(view.file)).toBe(described);
  await act(async () => { await result.current.undo.undo(); await flush(); });
  await act(async () => { await result.current.undo.undo(); await flush(); });
  await act(async () => { await result.current.undo.undo(); await flush(); });
  expect(runtime.read(view.file)).toBe(initial);
});
