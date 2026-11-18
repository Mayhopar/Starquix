import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import * as store from '../store';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { applyCommand } from '@/store/commands';
import { deleteLocalElementGroup } from '@/hooks/useKeyboardShortcuts';
import { setLocalPageFile, setLocalExpectedRoute, setLocalScannedRoute } from '@/utils/localPageSync';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPostPage } from '@/utils/createPostPage';
import { createDefaultCollection } from '@/core/collections/types';
import { addRootAt } from '@/store/pageTemplateInsert';
import { emptyClassData } from '@/store/types';
import { layoutAppendCommand } from '../layoutAppend';
import { flushDurableSourceWrites } from '../sourceMaterialization';
import { createLocalDocPage, deleteLocalDocPage } from '@/store/localPages';
import { renameLocalDocPage } from '@/utils/localPageSync';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
let projectId: string;
const file = 'src/pages/index.astro';
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_page_replay_${crypto.randomUUID()}`;
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [file]: '<main />\n' });
});
afterEach(() => { cleanup(); runtime.close(); h.doc.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); });
const mount = () => renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });

it('accepts create, rename and delete from projected pages while source ACK is blocked', async () => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: '<main />\n' }, { beforeCommand: () => gate });
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', children: [], rootElementIds: [] } });
  let accepted = false;
  const changing = (async () => {
    const created = await createLocalDocPage(h.doc, `wc://${projectId}`, 'About');
    const renamed = await renameLocalDocPage(h.doc, `wc://${projectId}`, created, 'Team');
    await deleteLocalDocPage(h.doc, `wc://${projectId}`, renamed);
    accepted = true;
  })();
  try {
    await vi.waitFor(() => expect(accepted).toBe(true));
    expect(h.doc.getMap('pages').size).toBe(1);
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
  } finally { release(); await changing; await flushDurableSourceWrites(projectId); }
  expect(runtime.read(file)).toBe('<main />\n');
});

it('undo accepts a mixed file/document snapshot while its source ACK is blocked', async () => {
  const original = '<main>\n  <p>Delete</p>\n</main>\n';
  runtime.close(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: () => gate });
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'page', name: '/', children: [], rootElementIds: [] } });
  applyCommand(h.doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-a', pageId: 'page', tag: 'div', classes: '', textContent: '', parentKey: null, insertIndex: 0 } });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const { result } = mount();
  let deleting: Promise<unknown> | undefined;
  try {
    let deleted = false;
    await act(async () => {
      deleting = deleteLocalElementGroup([{ key: 'drawn-a', elementId: 'drawn-a' }, { key: `${file}:2:3`, elementId: null }], {
        docDeps: { doc: h.doc, dispatch: action => applyCommand(h.doc, action), scannedElements: [], claimSnapshot: result.current.claimSnapshot },
        takeSnapshot: result.current.takeSnapshot, pushUndo: result.current.pushStructuralUndo, scannedByKey: new Map(), clearSelection() {},
      }).then(() => { deleted = true; });
      await vi.waitFor(() => expect(deleted).toBe(true));
    });
    expect(deleted).toBe(true); expect(result.current.canUndo).toBe(true);
    let undone = false;
    await act(async () => { void Promise.resolve(result.current.undo()).then(() => { undone = true; }); await vi.waitFor(() => expect(undone).toBe(true)); });
    expect(undone).toBe(true); expect(h.doc.getMap('elements').has('drawn-a')).toBe(true);
    expect(result.current.canRedo).toBe(true);
  } finally { release(); await deleting; await flushDurableSourceWrites(projectId); }
  expect(runtime.read(file)).toBe(original);
});

it('layout insertion is one snapshot/revision, recovers lost ACK and restarts, and undoes source plus placement', async () => {
  const layout = 'src/layouts/Host.astro';
  const source = '<Layout>\n  <slot />\n</Layout>\n';
  runtime.close(); let acknowledgements = 0;
  runtime = projectFsRuntime(projectId, { [layout]: source }, { loseAcknowledgement: () => ++acknowledgements === 1 });
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'page', name: 'Page', children: [], rootElementIds: [] } });
  const { result } = mount();
  await act(async () => {
    result.current.takeSnapshot();
    await addRootAt(h.doc, { type: 'ADD_THEME_INSTANCE', element: { id: 'el-card', pageId: 'page', parentId: null, index: 0,
      type: 'instance', themeId: 'card', componentPath: 'library/Card.astro', staticMarkup: '<section>Card</section>', classes: emptyClassData() } },
      'page', 'el-card', 0, result.current.claimSnapshot(), undefined, [layoutAppendCommand('layouts/Host.astro', 'Card', 'library/Card.astro', true)]);
  });
  expect(runtime.read(layout)).toBe(source);
  expect(await db.durableEdits.count()).toBe(1);
  await flushDurableSourceWrites(projectId);
  const inserted = "---\nimport Card from '../components/library/Card.astro';\n---\n<Layout>\n  <slot />\n  <Card />\n</Layout>\n";
  expect(runtime.read(layout)).toBe(inserted);
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWrites(projectId);
  expect(runtime.read(layout)).toBe(inserted); expect(acknowledgements).toBe(1);
  await act(async () => { await result.current.undo(); });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(layout)).toBe(source);
  expect(h.doc.getMap('elements').has('el-card')).toBe(false);
  expect(result.current.canUndo).toBe(false);
});

it('undo and redo a mixed source/page gesture through one receipt-backed revision each', async () => {
  const { result } = mount();
  const moved = 'src/pages/archive/index.astro';
  act(() => result.current.pushStructuralUndo({ structuralOp: {
    inverse: [
      { kind: 'restore-region', loc: { file, line: 1, column: 1 }, lineCount: 1, segment: '<Card />\n<main />\n' },
      { kind: 'page-move', folder: `wc://${projectId}`, from: file, to: moved },
    ],
    forward: [
      { kind: 'page-move', folder: `wc://${projectId}`, from: moved, to: file },
      { kind: 'restore-region', loc: { file, line: 1, column: 1 }, lineCount: 2, segment: '<main />\n' },
    ],
  } }));
  await act(async () => { await result.current.undo(); });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(moved)).toBe('<Card />\n<main />\n');
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
  expect(result.current.canRedo).toBe(true);
  await act(async () => { await result.current.redo(); });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('<main />\n');
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 2 });
  expect((await db.durableCommandReceipts.toArray()).every(row => row.outcome?.status === 'written')).toBe(true);
});

it('undo restores a mixed deleted source span and document element in one step', async () => {
  const original = '<main>\n  <p>Delete</p>\n</main>\n'; writeFileSync(join(runtime.root, file), original);
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'page', name: '/', children: [], rootElementIds: [] } });
  applyCommand(h.doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-a', pageId: 'page', tag: 'div', classes: '', textContent: '', parentKey: null, insertIndex: 0 } });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const { result } = mount();
  await act(async () => {
    await deleteLocalElementGroup([{ key: 'drawn-a', elementId: 'drawn-a' }, { key: `${file}:2:3`, elementId: null }], {
      docDeps: { doc: h.doc, dispatch: action => applyCommand(h.doc, action), scannedElements: [], claimSnapshot: result.current.claimSnapshot },
      takeSnapshot: result.current.takeSnapshot, pushUndo: result.current.pushStructuralUndo, scannedByKey: new Map(), clearSelection: () => {},
    });
  });
  expect(h.doc.getMap('elements').has('drawn-a')).toBe(false);
  await act(async () => { await result.current.undo(); });
  expect(h.doc.getMap('elements').has('drawn-a')).toBe(true);
  expect(runtime.read(file)).toBe(original);
  expect(await db.durableEdits.count()).toBe(2);
  expect(result.current.canUndo).toBe(false);
});

it('one collection undo removes both the collection and its new detail page', async () => {
  const { result } = mount(); const collection = createDefaultCollection('blog');
  await act(async () => {
    result.current.takeSnapshot();
    await createPostPage(h.doc, collection.id, collection.name, null, result.current.claimSnapshot(), [{ type: 'ADD_CONTENT_COLLECTION', collection }]);
  });
  await act(async () => { await result.current.undo(); });
  expect(h.doc.getMap('pages').size).toBe(0);
  expect(h.doc.getMap('contentCollections').size).toBe(0);
});

it('flushes an accepted replay even when an intervening edit invalidates stack transfer', async () => {
  const { result } = mount();
  const original = store.acceptStoredEdit;
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await gate; return original(input); });
  act(() => result.current.pushStructuralUndo({ structuralOp: { forward: [], inverse: [
    { kind: 'restore-region', loc: { file, line: 1, column: 1 }, lineCount: 1, segment: '<main>Restored</main>\n' },
  ] } }));
  let undo!: Promise<void>;
  act(() => { undo = result.current.undo() as Promise<void>; });
  await started;
  act(() => result.current.pushStructuralUndo({ structuralOp: { forward: [], inverse: [] } }));
  await act(async () => { release(); await undo; });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('<main>Restored</main>\n');
  expect(result.current.canRedo).toBe(false);
  expect(result.current.canUndo).toBe(true);
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
});
