import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { useFolderManifest } from '../useFolderManifest';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';
import type { FolderManifest } from '@/store/folderManifest';
import type { MutationSnapshot } from '@/store/documentMutation';

const h = vi.hoisted(() => ({ path: '', doc: null as unknown as Y.Doc }));
vi.mock('../useLocalProjectPath', () => ({ useLocalProjectPath: () => h.path }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = '.starquix/folders.json';
const manifest = (name: string): FolderManifest => ({ version: 1, roots: ['f_one'], folders: { f_one: { name, children: [] } } });
const bytes = (name: string) => JSON.stringify(manifest(name), null, 2) + '\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let release: (() => void) | undefined;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_folder_acceptance_${crypto.randomUUID()}`;
  h.path = `wc://${projectId}`; setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  const page = new Y.Map(); page.set('name', 'Keep this page');
  h.doc.getMap('pages').set('page', page);
  runtime = projectFsRuntime(projectId, { [file]: bytes('Original') });
});
afterEach(async () => {
  release?.(); release = undefined;
  cleanup();
  await flushDurableSourceWrites(projectId).catch(() => {});
  runtime.close(); h.doc.destroy(); setActiveSaveProjectId(null);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount() {
  const hook = renderHook(() => ({ folders: useFolderManifest(), undo: useUndoContext() }), {
    wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider>,
  });
  await waitFor(() => expect(hook.result.current.folders.loaded).toBe(true));
  return hook;
}
function saveWithSnapshot(hook: Awaited<ReturnType<typeof mount>>, name: string) {
  hook.result.current.undo.takeSnapshot();
  const snapshot = hook.result.current.undo.claimSnapshot();
  return (hook.result.current.folders.save as (next: FolderManifest, snapshot?: MutationSnapshot) => Promise<void>)(manifest(name), snapshot);
}

it('keeps shared folders, source, and Undo unchanged when durable storage rejects', async () => {
  const hook = await mount();
  vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  await act(async () => { await expect(saveWithSnapshot(hook, 'Rejected')).rejects.toThrow(); });
  expect(hook.result.current.folders.manifest).toEqual(manifest('Original'));
  expect(hook.result.current.undo.canUndo).toBe(false);
  expect(runtime.read(file)).toBe(bytes('Original'));
  expect(await db.durableEdits.count()).toBe(0);
});

it('publishes a folder revision only after its acceptance transaction commits', async () => {
  const hook = await mount();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accept = storage.acceptStoredEdit;
  vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await gate; return accept(input); });
  let saving!: Promise<void>;
  act(() => { saving = saveWithSnapshot(hook, 'Accepted'); });
  await started;
  expect(hook.result.current.folders.manifest).toEqual(manifest('Original'));
  expect(hook.result.current.undo.canUndo).toBe(false);
  expect(runtime.read(file)).toBe(bytes('Original'));
  await act(async () => { release!(); await saving; });
  expect(hook.result.current.folders.manifest).toEqual(manifest('Accepted'));
  expect(hook.result.current.undo.canUndo).toBe(true);
});

it('accepts another folder edit while the earlier source acknowledgement is pending', async () => {
  runtime.close();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: bytes('Original') }, { beforeCommand: async () => {
    expect(await db.durableEdits.count()).toBeGreaterThan(0); entered(); await gate;
  } });
  const hook = await mount();
  await act(async () => { await hook.result.current.folders.save(manifest('First')); });
  await started;
  await act(async () => { await hook.result.current.folders.save(manifest('Second')); });
  expect(hook.result.current.folders.manifest).toEqual(manifest('Second'));
  expect(await db.durableEdits.count()).toBe(2);
  expect(runtime.read(file)).toBe(bytes('Original'));
  hook.unmount();
  const remounted = await mount();
  expect(remounted.result.current.folders.manifest).toEqual(manifest('Second'));
  await act(async () => { release!(); await flushDurableSourceWrites(projectId); });
  expect(runtime.read(file)).toBe(bytes('Second'));
});

it('hydrates an accepted folder edit from IndexedDB after reopen and resumes source materialization', async () => {
  await storage.acceptStoredEdit({ projectId, operationId: 'interrupted-folder', yjsUpdate: null, acceptedAt: Date.now(),
    commands: [{ kind: 'folder-manifest', payload: { localPath: h.path, manifest: manifest('Recovered'),
      preparedFiles: [{ file, beforeSource: bytes('Original'), afterSource: bytes('Recovered') }],
    } } as never] });
  db.close(); await db.open(); runtime.restart();
  const hook = await mount();
  expect(hook.result.current.folders.manifest).toEqual(manifest('Recovered'));
  hook.unmount();
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(bytes('Recovered'));
  const again = await mount();
  expect(again.result.current.folders.manifest).toEqual(manifest('Recovered'));
});

it('journals exact folder Undo and Redo before publishing either inverse without changing document content', async () => {
  const hook = await mount();
  await act(async () => { await saveWithSnapshot(hook, 'Changed'); });
  await act(async () => { await hook.result.current.undo.undo(); });
  await waitFor(() => expect(hook.result.current.folders.manifest).toEqual(manifest('Original')));
  expect(h.doc.getMap<Y.Map<string>>('pages').get('page')!.get('name')).toBe('Keep this page');
  expect(hook.result.current.undo.canRedo).toBe(true);
  const rows = await db.durableEdits.where('projectId').equals(projectId).sortBy('revision');
  expect(rows).toHaveLength(2);
  expect(rows[1].commands).toContainEqual({ kind: 'file-batch', payload: { files: [expect.objectContaining({
    file, beforeSource: bytes('Changed'), afterSource: bytes('Original'),
  })] } });
  await act(async () => { await hook.result.current.undo.redo(); });
  await waitFor(() => expect(hook.result.current.folders.manifest).toEqual(manifest('Changed')));
  await act(async () => { await flushDurableSourceWrites(projectId); });
  expect(runtime.read(file)).toBe(bytes('Changed'));
});

it('does not move folder Undo or shared state when inverse acceptance is rejected', async () => {
  const hook = await mount();
  await act(async () => { await saveWithSnapshot(hook, 'Changed'); });
  vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  await act(async () => { await hook.result.current.undo.undo(); });
  expect(hook.result.current.folders.manifest).toEqual(manifest('Changed'));
  expect(hook.result.current.undo.canUndo).toBe(true);
  expect(hook.result.current.undo.canRedo).toBe(false);
  expect(await db.durableEdits.count()).toBe(1);
});

it('freezes caller-owned manifest bytes before acceptance can wait', async () => {
  const hook = await mount();
  const next = manifest('Captured');
  await act(async () => {
    const saving = hook.result.current.folders.save(next);
    next.folders.f_one.name = 'Mutated elsewhere';
    await saving;
  });
  expect(hook.result.current.folders.manifest).toEqual(manifest('Captured'));
  await act(async () => { await flushDurableSourceWrites(projectId); });
  expect(runtime.read(file)).toBe(bytes('Captured'));
});

it('publishes a late old-project acceptance only to its own folder owner', async () => {
  const hook = await mount();
  const oldId = projectId;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const accept = storage.acceptStoredEdit;
  vi.spyOn(storage, 'acceptStoredEdit').mockImplementationOnce(async input => { entered(); await gate; return accept(input); });
  let saving!: Promise<void>;
  await act(async () => { saving = hook.result.current.folders.save(manifest('Old accepted')); await started; });
  runtime.close();
  projectId = `browser_folder_replacement_${crypto.randomUUID()}`;
  h.path = `wc://${projectId}`; setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [file]: bytes('Replacement') });
  hook.rerender();
  await waitFor(() => expect(hook.result.current.folders.manifest).toEqual(manifest('Replacement')));
  await act(async () => { release!(); await saving; });
  expect(hook.result.current.folders.manifest).toEqual(manifest('Replacement'));
  expect(runtime.read(file)).toBe(bytes('Replacement'));
  expect(await db.durableEdits.where('projectId').equals(oldId).count()).toBe(1);
  expect(await db.durableEdits.where('projectId').equals(projectId).count()).toBe(0);
});
