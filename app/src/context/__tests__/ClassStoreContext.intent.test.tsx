/** instant-edit P0b: the doc observer tags every class SYNC with the intent of the durable edit it came from
 * (call-order seq + whether its file carries the value) and registers the key until its row lands. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: { isAvailable: () => false, writeClassUpdate: vi.fn(() => Promise.resolve(true)), setIframeRef: vi.fn() },
}));

import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { _resetClassIntentsForTests, settledIntents, unlandedIntents } from '@/services/classIntents';
import { UndoProvider } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

const KEY = 'src/pages/index.astro:20:5';
const LOC = { file: 'src/pages/index.astro', line: 20, column: 5 };
const PAGE = [...Array.from({ length: 19 }, (_, i) => (i === 0 ? '<section>' : `  <!-- ${i} -->`)), '    <img class="w-full rounded" alt="x" />', '</section>', ''].join('\n');

let posted: Array<{ type: string; payload: Record<string, unknown> }>;
let storeApi: ReturnType<typeof useClassStore>;
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;

function ProjectSeed({ children }: { children: React.ReactNode }) {
  const doc = useEditorDoc();
  React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', projectId); }, [doc]);
  return <>{children}</>;
}
function Harness() {
  storeApi = useClassStore();
  return useYjsValue(selectProjectId) === projectId ? <span data-testid="ready" /> : null;
}
async function mount() {
  await db.delete(); await db.open();
  resetClassWriteBaselines(); _resetLocalPageSyncForTests(); _resetClassIntentsForTests();
  projectId = `browser_intent_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { [LOC.file]: PAGE });
  setActiveSaveProjectId(projectId);
  posted = [];
  render(<EditorProvider><ProjectSeed><UndoProvider><ClassStoreProvider><Harness /></ClassStoreProvider></UndoProvider></ProjectSeed></EditorProvider>);
  await screen.findByTestId('ready');
}
const setClasses = async (classes: string) => { let ok = false; await act(async () => { ok = await storeApi.setClasses(KEY, classes); }); expect(ok).toBe(true); };
type Sync = { key: string; classes: string; draft?: boolean; painted?: boolean; intent?: { epoch: string; seq: number; hold: boolean } };
const allSyncs = () => posted.filter(m => m.type === 'SYNC_CLASSES_TO_IFRAME').map(m => m.payload as Sync);
const syncs = () => allSyncs().filter(p => p.draft);              // what paints the canvas
const bookkeeping = () => allSyncs().filter(p => p.painted);      // the observer's message for an already painted value

beforeEach(() => {
  vi.spyOn(window, 'postMessage').mockImplementation((msg: unknown) => {
    const m = msg as { type?: string; payload: Record<string, unknown> };
    if (m && typeof m.type === 'string') posted.push(m as { type: string; payload: Record<string, unknown> });
  });
});
afterEach(() => { vi.restoreAllMocks(); runtime?.close(); runtime = undefined; setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetClassIntentsForTests(); });

describe('ClassStore observer: class intents', () => {
  it('paints at call time (a draft SYNC) and the observer\'s message for the same op is bookkeeping with the SAME seq', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
    await setClasses('w-[3px] rounded');
    expect(syncs()).toHaveLength(1);
    expect(bookkeeping()).toHaveLength(1);
    expect(bookkeeping()[0].intent!.seq).toBe(syncs()[0].intent!.seq);
    expect(posted.findIndex(m => (m.payload as Sync).draft)).toBeLessThan(posted.findIndex(m => (m.payload as Sync).painted));
  });

  it('a call paints BEFORE the lane has accepted it', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
    posted.length = 0;
    let pending!: Promise<boolean>;
    act(() => { pending = storeApi.setClasses(KEY, 'w-[3px] rounded'); });
    expect(syncs().map(p => p.classes)).toEqual(['w-[3px] rounded']);   // synchronously, nothing awaited
    expect(bookkeeping()).toHaveLength(0);                              // not accepted yet
    await act(async () => { await pending; });
    expect(bookkeeping()).toHaveLength(1);
  });

  it('tags each class SYNC with a call-order seq and hold:true for an edit its file will carry', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
    await setClasses('w-[3px] rounded');
    await setClasses('w-[30px] rounded');
    await setClasses('w-[300px] rounded');
    const out = syncs();
    expect(out.map(p => p.classes)).toEqual(['w-[3px] rounded', 'w-[30px] rounded', 'w-[300px] rounded']);
    expect(out.every(p => p.intent && p.intent.hold === true)).toBe(true);
    const seqs = out.map(p => p.intent!.seq);
    expect(seqs[0]).toBeLessThan(seqs[1]); expect(seqs[1]).toBeLessThan(seqs[2]);
    expect(new Set(out.map(p => p.intent!.epoch)).size).toBe(1);
  });

  it('registers the key until its row lands: the newest intent per key, with its accepted revision', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
    await setClasses('w-[3px] rounded');
    await setClasses('w-[30px] rounded');
    const pending = unlandedIntents(projectId, 0);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ key: KEY, classes: 'w-[30px] rounded', seq: syncs()[1].intent!.seq });
    expect(settledIntents(projectId, pending[0].rev - 1, 1)).toHaveLength(0);
    expect(settledIntents(projectId, pending[0].rev, 1).map(e => e.key)).toEqual([KEY]);
  });
});
