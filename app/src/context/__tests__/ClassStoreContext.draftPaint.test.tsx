/** instant-edit P1: rejection puts the canvas back (the accepted Y value, a fresh seq, an earlier unlanded write holds
 * again), a tracked edit in flight is undone BY an undo pressed meanwhile, and rapid edits of one key skip the queue. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: { isAvailable: () => false, writeClassUpdate: vi.fn(() => Promise.resolve(true)), setIframeRef: vi.fn() },
}));

import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { db } from '@/db';
import * as store from '@/services/durableEdits/store';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { _resetClassIntentsForTests, unlandedIntents } from '@/services/classIntents';
import { stashEntries } from '@/services/gestureStash';
import { UndoProvider, useUndoContext } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

const KEY = 'src/pages/index.astro:20:5';
const LOC = { file: 'src/pages/index.astro', line: 20, column: 5 };
const KEY2 = 'src/pages/index.astro:21:5';   // the group-edit tests' second member (dev's setClassesMany)
const LOC2 = { file: 'src/pages/index.astro', line: 21, column: 5 };
const PAGE = [...Array.from({ length: 19 }, (_, i) => (i === 0 ? '<section>' : `  <!-- ${i} -->`)), '    <img class="w-full rounded" alt="x" />', '    <img class="w-full rounded" alt="y" />', '</section>', ''].join('\n');

type Sync = { key: string; classes: string; draft?: boolean; painted?: boolean; intent?: { epoch: string; seq: number; hold: boolean } };
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
  resetClassWriteBaselines(); _resetLocalPageSyncForTests(); _resetClassIntentsForTests();
  projectId = `browser_paint_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { [LOC.file]: PAGE });
  setActiveSaveProjectId(projectId);
  posted = [];
  render(<EditorProvider><ProjectSeed><UndoProvider><ClassStoreProvider><Harness /></ClassStoreProvider></UndoProvider></ProjectSeed></EditorProvider>);
  await screen.findByTestId('ready');
  act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); storeApi.registerElement(KEY2, 'w-full rounded', LOC2); });
}
const all = () => posted.filter(m => m.type === 'SYNC_CLASSES_TO_IFRAME').map(m => m.payload as Sync);
const docClass = (key = KEY) => docRef.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('classes');
const set = async (classes: string) => { let ok = false; await act(async () => { ok = await storeApi.setClasses(KEY, classes); }); return ok; };

beforeEach(() => {
  vi.spyOn(window, 'postMessage').mockImplementation((msg: unknown) => {
    const m = msg as { type?: string; payload: Record<string, unknown> };
    if (m && typeof m.type === 'string') posted.push(m as { type: string; payload: Record<string, unknown> });
  });
});
afterEach(() => { vi.restoreAllMocks(); runtime?.close(); runtime = undefined; setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetClassIntentsForTests(); });

describe('rejection', () => {
  it('puts the canvas back to the ACCEPTED value with a fresh seq and forgets the rejected paint', async () => {
    await mount();
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    expect(await set('w-[3px] rounded')).toBe(false);
    const drafts = all().filter(p => p.draft);
    expect(drafts.map(p => p.classes)).toEqual(['w-[3px] rounded', 'w-full rounded']);
    expect(drafts[1].intent!.seq).toBeGreaterThan(drafts[0].intent!.seq);
    expect(drafts[1].intent!.hold).toBe(false);            // nothing earlier is waiting to land
    expect(unlandedIntents(projectId, 0)).toEqual([]);
    expect(docClass()).toBe('w-full rounded');
  });

  it('an earlier accepted write that has not landed holds again, under the restore\'s seq', async () => {
    await mount();
    expect(await set('w-[3px] rounded')).toBe(true);
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    expect(await set('w-[30px] rounded')).toBe(false);
    const drafts = all().filter(p => p.draft);
    const restore = drafts[drafts.length - 1];
    expect(restore.classes).toBe('w-[3px] rounded');
    expect(restore.intent!.hold).toBe(true);
    const kept = unlandedIntents(projectId, 0);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ key: KEY, classes: 'w-[3px] rounded', seq: restore.intent!.seq });
  });
});

describe('undo while an edit is in flight', () => {
  it('waits for the edit and then undoes IT (without the barrier the undo found nothing and the edit stayed)', async () => {
    await mount();
    let edit!: Promise<boolean>; let undone!: Promise<void>;
    await act(async () => {
      edit = storeApi.setClasses(KEY, 'w-[3px] rounded');
      undone = undoApi.undo();          // pressed while the edit is still in flight
      await edit;                       // (React renders the edit's undo step when act exits; the press starts then)
    });
    await act(async () => { await undone; });
    expect(await edit).toBe(true);
    expect(docClass()).toBe('w-full rounded');
  });
});

describe('rapid edits of one key', () => {
  it('queued older edits are skipped: the call paints every value, the lane accepts the first and the last', async () => {
    await mount();
    let calls: Array<Promise<boolean>> = [];
    await act(async () => {
      calls.push(storeApi.setClasses(KEY, 'w-[3px] rounded'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();   // the first slot is in flight
      calls.push(storeApi.setClasses(KEY, 'w-[30px] rounded'));
      calls.push(storeApi.setClasses(KEY, 'w-[300px] rounded'));
      expect(all().filter(p => p.draft).map(p => p.classes)).toEqual(['w-[3px] rounded', 'w-[30px] rounded', 'w-[300px] rounded']);
      expect(await Promise.all(calls)).toEqual([true, true, true]);
    });
    expect(docClass()).toBe('w-[300px] rounded');
    const rows = await db.durableEdits.where('projectId').equals(projectId).toArray();
    expect(rows.length).toBeLessThan(3 + 1);
    const seqs = all().filter(p => p.draft).map(p => p.intent!.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

/** dev's setClassesMany is the one writer (setClasses = a batch of one): the paint, the stash, the seq and the rejection restore
 * cover EVERY member, and only a single-key edit is ever superseded. */
describe('a group edit (setClassesMany)', () => {
  const group = (a: string, b: string) => [{ key: KEY, classes: a }, { key: KEY2, classes: b }];

  it('paints every member at call time under ONE seq and stashes each until the lane accepts', async () => {
    await mount();
    let pending!: Promise<boolean>;
    act(() => { pending = storeApi.setClassesMany(group('w-[3px] rounded', 'w-[4px] rounded')); });
    const drafts = all().filter(p => p.draft);
    expect(drafts.map(p => [p.key, p.classes])).toEqual([[KEY, 'w-[3px] rounded'], [KEY2, 'w-[4px] rounded']]);
    expect(drafts[0].intent!.seq).toBe(drafts[1].intent!.seq);
    expect(drafts.every(p => p.intent!.hold)).toBe(true);
    expect(stashEntries(projectId).map(e => e.key).sort()).toEqual([KEY, KEY2]);
    await act(async () => { expect(await pending).toBe(true); });
    expect(docClass(KEY)).toBe('w-[3px] rounded');
    expect(docClass(KEY2)).toBe('w-[4px] rounded');
    expect(stashEntries(projectId)).toEqual([]);
  });

  it('a rejected group puts EVERY painted member back to its accepted value and clears the stash', async () => {
    await mount();
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    let ok = true;
    await act(async () => { ok = await storeApi.setClassesMany(group('w-[3px] rounded', 'w-[4px] rounded')); });
    expect(ok).toBe(false);
    expect(all().filter(p => p.draft).map(p => [p.key, p.classes])).toEqual([
      [KEY, 'w-[3px] rounded'], [KEY2, 'w-[4px] rounded'], [KEY, 'w-full rounded'], [KEY2, 'w-full rounded']]);
    expect(unlandedIntents(projectId, 0)).toEqual([]);
    expect(stashEntries(projectId)).toEqual([]);
    expect(docClass(KEY)).toBe('w-full rounded');
    expect(docClass(KEY2)).toBe('w-full rounded');
  });

  it('a newer single edit of a member never skips a QUEUED group (a group has no supersede key)', async () => {
    await mount();
    const calls: Array<Promise<boolean>> = [];
    await act(async () => {
      calls.push(storeApi.setClasses(KEY, 'w-[3px] rounded'));                                      // in flight
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      calls.push(storeApi.setClassesMany(group('w-[30px] rounded', 'w-[4px] rounded')));            // queued behind it
      calls.push(storeApi.setClasses(KEY, 'w-[300px] rounded'));                                    // same key as a group member
      expect(await Promise.all(calls)).toEqual([true, true, true]);
    });
    expect(docClass(KEY)).toBe('w-[300px] rounded');
    expect(docClass(KEY2)).toBe('w-[4px] rounded');                                                  // the skipped-group failure left this at w-full
  });
});
