import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';

const h = vi.hoisted(() => ({ path: '', doc: null as unknown as Y.Doc, empty: [], refresh() {} }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.path }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
vi.mock('@/store/hooks', () => ({ useYjsValue: () => h.empty, useDispatch: () => () => {}, useEditorDoc: () => h.doc }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ builtIn: h.empty, userProject: h.empty, isLoading: false, error: null, refresh: h.refresh }) }));
vi.mock('@/hooks/useLayoutLibrary', () => ({ useLayoutLibrary: () => ({ layouts: h.empty, isLoading: false, error: null, refresh: h.refresh }), layoutToScannedComponent: (value: unknown) => value }));
vi.mock('@/hooks/useComponentFileOps', () => ({ useComponentFileOps: () => ({}) }));
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

const file = '.starquix/folders.json';
const original = '{"version":1,"roots":[],"folders":{}}\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_assets_folders_${crypto.randomUUID()}`; h.path = `wc://${projectId}`;
  setActiveSaveProjectId(projectId); h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [file]: original });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup(); await flushDurableSourceWrites(projectId).catch(() => {});
  runtime.close(); h.doc.destroy(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function UndoButtons() {
  const undo = useUndoContext();
  return <><button disabled={!undo.canUndo} onClick={() => { void undo.undo(); }}>Undo folders</button>
    <button disabled={!undo.canRedo} onClick={() => { void undo.redo(); }}>Redo folders</button></>;
}
async function mount() {
  render(<UndoProvider><UndoButtons /><AssetsPanel activeComponentPath={null} onSelectComponent={() => {}} /></UndoProvider>);
  await waitFor(() => expect(screen.getByTitle('Add folder')).toBeEnabled());
}
it('makes Add folder undoable through accepted file inverses and restores it with Redo', async () => {
  await mount();
  await act(async () => { fireEvent.click(screen.getByTitle('Add folder')); });
  await waitFor(() => expect(screen.getByDisplayValue('Folder')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Undo folders' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo folders' })); });
  await waitFor(() => expect(screen.queryByDisplayValue('Folder')).not.toBeInTheDocument());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Redo folders' })); });
  await waitFor(() => expect(screen.getByDisplayValue('Folder')).toBeInTheDocument());
  await act(async () => { await flushDurableSourceWrites(projectId); });
  expect(Object.values(JSON.parse(runtime.read(file)).folders)).toEqual([{ name: 'Folder', children: [] }]);
  expect(await db.durableEdits.count()).toBe(3);
});
it('keeps rejected folder creation out of the tree and Undo while permitting another gesture', async () => {
  await mount();
  vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  await act(async () => { fireEvent.click(screen.getByTitle('Add folder')); });
  await waitFor(() => expect(screen.getByText('Folder changes could not be saved.')).toBeInTheDocument());
  expect(screen.queryByDisplayValue('Folder')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo folders' })).toBeDisabled();
  expect(screen.getByTitle('Add folder')).toBeEnabled();
  expect(runtime.read(file)).toBe(original);
});
it('keeps folder creation and dependent controls behind the pending local acceptance', async () => {
  await mount();
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accept = storage.acceptStoredEdit;
  vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await gate; return accept(input); });
  try {
    await act(async () => { fireEvent.click(screen.getByTitle('Add folder')); await started; });
    expect(screen.queryByDisplayValue('Folder')).not.toBeInTheDocument();
    expect(screen.getByTitle('Add folder')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo folders' })).toBeDisabled();
  } finally { await act(async () => { release(); }); }
  await waitFor(() => expect(screen.getByDisplayValue('Folder')).toBeInTheDocument());
  expect(screen.getByTitle('Add folder')).toBeEnabled();
});
