/** instant-edit P2: a stepper burst previews (paint + panel echo) without a row or an undo step, commits once, aborts clean;
 * every call writes the gesture stash first; a stash left by a dead session replays once. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: { isAvailable: () => false, writeClassUpdate: vi.fn(() => Promise.resolve(true)), setIframeRef: vi.fn() },
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', async importOriginal => {
  const actual = await importOriginal<typeof import('react-hot-toast')>();
  const toast = Object.assign((...a: unknown[]) => (actual.default as unknown as (...x: unknown[]) => unknown)(...a), actual.default, { error: toastError });
  return { ...actual, default: toast };
});

import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { db } from '@/db';
import * as store from '@/services/durableEdits/store';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { _resetClassIntentsForTests } from '@/services/classIntents';
import { _resetGestureStashForTests, stashEntries, stashPut } from '@/services/gestureStash';
import { UndoProvider, useUndoContext } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

const KEY = 'src/pages/index.astro:20:5';
const LOC = { file: 'src/pages/index.astro', line: 20, column: 5 };
const PAGE = [...Array.from({ length: 19 }, (_, i) => (i === 0 ? '<section>' : `  <!-- ${i} -->`)), '    <img class="w-full rounded" alt="x" />', '</section>', ''].join('\n');

type Sync = { key: string; classes: string; draft?: boolean; preview?: boolean; painted?: boolean; intent?: { epoch: string; seq: number; hold: boolean } };
let posted: Array<{ type: string; payload: Record<string, unknown> }>;
let docRef: Y.Doc;
let storeApi: ReturnType<typeof useClassStore>;
let undoApi: ReturnType<typeof useUndoContext>;
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;

function ProjectSeed({ children }: { children: React.ReactNode }) {
  const doc = useEditorDoc();
  React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', projectId); }, [doc]);
  return <>{children}</>;
}
function Harness() {
  docRef = useEditorDoc(); storeApi = useClassStore(); undoApi = useUndoContext();
  return useYjsValue(selectProjectId) === projectId ? <span data-testid="ready" /> : null;
}
async function mount() {
  await db.delete(); await db.open();
  resetClassWriteBaselines(); _resetLocalPageSyncForTests(); _resetClassIntentsForTests(); _resetGestureStashForTests();
  projectId = `browser_preview_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { [LOC.file]: PAGE });
  setActiveSaveProjectId(projectId);
  posted = [];
  render(<EditorProvider><ProjectSeed><UndoProvider><ClassStoreProvider><Harness /></ClassStoreProvider></UndoProvider></ProjectSeed></EditorProvider>);
  await screen.findByTestId('ready');
  act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
}
/** A reload: the old document is gone, a fresh provider tree opens the same project and registers the element from the scan. */
async function reopen() {
  cleanup();
  posted = [];
  render(<EditorProvider><ProjectSeed><UndoProvider><ClassStoreProvider><Harness /></ClassStoreProvider></UndoProvider></ProjectSeed></EditorProvider>);
  await screen.findByTestId('ready');
  act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
}
const all = () => posted.filter(m => m.type === 'SYNC_CLASSES_TO_IFRAME').map(m => m.payload as Sync);
const docClass = () => docRef.getMap<Y.Map<unknown>>('sourceClasses').get(KEY)?.get('classes');

beforeEach(() => {
  toastError.mockClear();
  vi.spyOn(window, 'postMessage').mockImplementation((msg: unknown) => {
    const m = msg as { type?: string; payload: Record<string, unknown> };
    if (m && typeof m.type === 'string') posted.push(m as { type: string; payload: Record<string, unknown> });
  });
});
afterEach(() => { vi.restoreAllMocks(); runtime?.close(); runtime = undefined; setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetClassIntentsForTests(); _resetGestureStashForTests(); });

describe('previewClasses', () => {
  it('paints each tick (draft + preview, newer seq each) and echoes it to the panel, with no journal row and no undo step', async () => {
    await mount();
    act(() => { storeApi.previewClasses(KEY, 'w-[101px] rounded'); storeApi.previewClasses(KEY, 'w-[102px] rounded'); storeApi.previewClasses(KEY, 'w-[103px] rounded'); });
    const out = all().filter(p => p.draft);
    expect(out.map(p => p.classes)).toEqual(['w-[101px] rounded', 'w-[102px] rounded', 'w-[103px] rounded']);
    expect(out.every(p => p.preview && p.intent!.hold)).toBe(true);
    expect(out[0].intent!.seq).toBeLessThan(out[1].intent!.seq); expect(out[1].intent!.seq).toBeLessThan(out[2].intent!.seq);
    expect(storeApi.getClasses(KEY)).toBe('w-[103px] rounded');                 // the panel reads the previewed value
    expect(storeApi.getClassesFromYjs(KEY)).toBe('w-[103px] rounded');          // so does the next tick's merge base
    expect(await db.durableEdits.count()).toBe(0);
    expect(undoApi.canUndo).toBe(false);
    expect(docClass()).toBe('w-full rounded');                                  // the document is untouched
  });

  it('the burst commits ONCE: one row, one undo step, the value on the document', async () => {
    await mount();
    act(() => { storeApi.previewClasses(KEY, 'w-[101px] rounded'); storeApi.previewClasses(KEY, 'w-[102px] rounded'); });
    await act(async () => { await storeApi.setClasses(KEY, 'w-[102px] rounded'); });
    expect(await db.durableEdits.count()).toBe(1);
    expect(docClass()).toBe('w-[102px] rounded');
    expect(undoApi.canUndo).toBe(true);
  });

  it('abort puts the panel and the canvas back to the accepted value (a fresh seq, no hold) and writes nothing', async () => {
    await mount();
    act(() => { storeApi.previewClasses(KEY, 'w-[101px] rounded'); storeApi.previewClasses(KEY, 'w-[102px] rounded'); });
    act(() => { storeApi.abortClassesPreview(KEY); });
    const drafts = all().filter(p => p.draft);
    const restore = drafts[drafts.length - 1];
    expect(restore.classes).toBe('w-full rounded');
    expect(restore.intent!.hold).toBe(false);
    expect(restore.intent!.seq).toBeGreaterThan(drafts[1].intent!.seq);
    expect(storeApi.getClasses(KEY)).toBe('w-full rounded');
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('abort after the commit started changes nothing (the commit replaced the preview draft)', async () => {
    await mount();
    act(() => { storeApi.previewClasses(KEY, 'w-[101px] rounded'); });
    let pending!: Promise<boolean>;
    act(() => { pending = storeApi.setClasses(KEY, 'w-[101px] rounded'); });
    const before = all().length;
    act(() => { storeApi.abortClassesPreview(KEY); });
    expect(all().length).toBe(before);
    await act(async () => { await pending; });
    expect(docClass()).toBe('w-[101px] rounded');
  });
});

describe('gesture stash', () => {
  it('every setClasses call is stashed synchronously (with its op and the committed baseline) and cleared when accepted', async () => {
    await mount();
    let pending!: Promise<boolean>;
    act(() => { pending = storeApi.setClasses(KEY, 'w-[3px] rounded'); });
    expect(stashEntries(projectId)).toEqual([expect.objectContaining({ key: KEY, classes: 'w-[3px] rounded', baseline: 'w-full rounded', opId: expect.stringMatching(/^class-edit:/) })]);
    await act(async () => { await pending; });
    expect(stashEntries(projectId)).toEqual([]);
  });

  it('a rejected edit is cleared from the stash too (the toast and the rollback own it)', async () => {
    await mount();
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await act(async () => { await storeApi.setClasses(KEY, 'w-[3px] rounded'); });
    expect(stashEntries(projectId)).toEqual([]);
  });
});

describe('stash replay at the next open', () => {
  it('re-issues an intent whose key still has the baseline class: ONE normal edit', async () => {
    await mount();
    // the "previous session" left an unaccepted intent for this project
    stashPut({ projectId, key: KEY, classes: 'w-[300px] rounded', baseline: 'w-full rounded', origin: { armed: false, pageFile: LOC.file }, opId: null });
    await reopen();             // a new provider instance (a reload) replays it once the key is registered
    await waitFor(() => expect(docClass()).toBe('w-[300px] rounded'), { timeout: 4000 });
    expect(await db.durableEdits.count()).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(stashEntries(projectId)).toEqual([]), { timeout: 4000 });
  });

  it('drops an intent that already landed, silently', async () => {
    await mount();
    stashPut({ projectId, key: KEY, classes: 'w-full rounded', baseline: 'w-[5px]', origin: { armed: false, pageFile: LOC.file }, opId: null });
    await reopen();
    await waitFor(() => expect(stashEntries(projectId)).toEqual([]), { timeout: 4000 });
    expect(toastError).not.toHaveBeenCalled();
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('drops an intent whose element changed under it, with the existing toast (newest wins, never a blind splice)', async () => {
    await mount();
    stashPut({ projectId, key: KEY, classes: 'w-[300px] rounded', baseline: 'w-[5px] rounded', origin: { armed: false, pageFile: LOC.file }, opId: null });
    await reopen();
    await waitFor(() => expect(toastError).toHaveBeenCalled(), { timeout: 4000 });
    expect(stashEntries(projectId)).toEqual([]);
    expect(docClass()).toBe('w-full rounded');
  });
});
