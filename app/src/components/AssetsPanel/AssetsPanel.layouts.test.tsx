import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { markFilesTruth } from '@/utils/localMode';
import * as storage from '@/services/durableEdits/store';

const h = vi.hoisted(() => ({ path: '', doc: null as unknown as Y.Doc, empty: [], refresh() {}, clear: vi.fn() }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.path }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
vi.mock('@/store/hooks', () => ({ useYjsValue: () => h.empty, useDispatch: () => () => {}, useEditorDoc: () => h.doc }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ builtIn: h.empty, userProject: h.empty, isLoading: false, error: null, refresh: h.refresh }) }));
vi.mock('@/hooks/useFolderManifest', () => ({ useFolderManifest: () => ({ manifest: { version: 1, roots: [], folders: {} }, loaded: true, save() {}, reload() {} }) }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ activeCollectionId: null, setActiveCollectionId() {} }) }));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElements: () => ({ scannedByKey: new Map() }),
  useSelectionContext: () => ({ selectedKey: null, select() {} }),
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
  useSelectedElement: () => ({}),
}));
vi.mock('@/components/LayersPanel/ElementsTree', () => ({ ElementsTree: () => null }));
vi.mock('@/components/ui/SortableTree', () => ({
  SortableTreeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTreeNodeDnd: () => ({ setNodeRef() {}, attributes: {}, listeners: {}, isDragging: false, dropZone: null }),
  useTreePointerY: () => null, getDropZone: () => null, TreeDropIndicator: () => null, ROW_HEIGHT: 28,
}));
vi.mock('@/components/Editor/useLayersDrag', () => ({ useLayersDrag: () => ({ onDragStart() {}, onDragMove() {}, onDragEnd() {}, onDragCancel() {} }) }));
import { AssetsPanel } from './AssetsPanel';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';

const file = 'src/layouts/Foo.astro', pageFile = 'src/pages/index.astro';
const layout = '<main><slot /></main>\n';
const page = '---\nimport Foo from "../layouts/Foo.astro";\n---\n<Foo><p>Keep</p></Foo>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_assets_layouts_${crypto.randomUUID()}`; markFilesTruth(projectId); h.path = `wc://${projectId}`;
  setActiveSaveProjectId(projectId); h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  h.doc.getMap('databaseTables').set('retained', { id: 'retained', name: 'Keep this table' });
  runtime = projectFsRuntime(projectId, { [file]: layout, [pageFile]: page }, { loseAcknowledgement: () => true });
  h.clear.mockClear(); Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup(); await flushDurableSourceWrites(projectId).catch(() => {});
  runtime.close(); h.doc.destroy(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function UndoButtons() {
  const undo = useUndoContext();
  return <><button disabled={!undo.canUndo} onClick={() => { void undo.undo(); }}>Undo layout</button>
    <button disabled={!undo.canRedo} onClick={() => { void undo.redo(); }}>Redo layout</button></>;
}
async function mount() {
  const view = render(<UndoProvider><UndoButtons /><AssetsPanel activeComponentPath={file} onSelectComponent={() => {}} onClearComponent={h.clear} /></UndoProvider>);
  await waitFor(() => expect(screen.getByText('Foo')).toBeInTheDocument());
  return view;
}
async function deleteLayout() {
  await act(async () => { fireEvent.contextMenu(screen.getByText('Foo')); });
  await act(async () => { fireEvent.click(screen.getByText('Delete')); });
}

it('journals create/Undo/Redo with exact file inverses while preserving the current document', async () => {
  await mount();
  await act(async () => { fireEvent.click(screen.getByTitle('Add layout')); });
  await waitFor(() => expect(screen.getByText('Layout1')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Undo layout' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout' })); });
  await waitFor(() => expect(screen.queryByText('Layout1')).not.toBeInTheDocument());
  expect(h.doc.getMap('databaseTables').get('retained')).toEqual({ id: 'retained', name: 'Keep this table' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Redo layout' })); });
  await waitFor(() => expect(screen.getByText('Layout1')).toBeInTheDocument());
  expect(await db.durableEdits.count()).toBe(3);
});

it('clears a deleted active layout after acceptance and restores importer bytes with one Undo', async () => {
  await mount();
  await deleteLayout();
  await waitFor(() => expect(screen.queryByText('Foo')).not.toBeInTheDocument());
  expect(h.clear).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Undo layout' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo layout' })); });
  await waitFor(() => expect(screen.getByText('Foo')).toBeInTheDocument());
  await act(async () => { await flushDurableSourceWrites(projectId); });
  expect(runtime.read(file)).toBe(layout); expect(runtime.read(pageFile)).toBe(page);
  expect(await db.durableEdits.count()).toBe(2);
});

it('keeps the selected layout and Undo unchanged while acceptance is pending or rejected', async () => {
  await mount();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async () => { entered(); await gate; throw new Error('quota'); });
  try {
    await deleteLayout();
    await act(async () => { await started; });
    expect(screen.getByText('Foo')).toBeInTheDocument(); expect(h.clear).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo layout' })).toBeDisabled();
  } finally { await act(async () => { release(); }); }
  expect(await db.durableEdits.count()).toBe(0);
  expect(screen.getByText('Foo')).toBeInTheDocument(); expect(h.clear).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Undo layout' })).toBeDisabled();
  expect(runtime.read(file)).toBe(layout); expect(runtime.read(pageFile)).toBe(page);
});

it('keeps a different master selected while an earlier layout deletion finishes acceptance', async () => {
  const view = await mount();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accept = storage.acceptStoredEdit;
  vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await gate; return accept(input); });
  try {
    await deleteLayout();
    await act(async () => { await started; });
    view.rerender(<UndoProvider><UndoButtons /><AssetsPanel activeComponentPath="src/components/Card.astro"
      onSelectComponent={() => {}} onClearComponent={h.clear} /></UndoProvider>);
  } finally { await act(async () => { release(); }); }
  await waitFor(() => expect(screen.queryByText('Foo')).not.toBeInTheDocument());
  expect(await db.durableEdits.count()).toBe(1);
  expect(h.clear).not.toHaveBeenCalled();
});
