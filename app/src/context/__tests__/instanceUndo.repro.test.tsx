/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md): undo of
 * INSTANCE edits (a component element edited from a page). Ported from the investigation's
 * scratch tests (tmp/investigation/editor-class-store/classStoreUi.scratch.test.ts D, E, H).
 *
 * Undo snapshots the whole `sourceClasses` map and restores ALL of it, so one ⌘Z also rewinds
 * entries that no undoable gesture wrote (click adoption, scan seeds) — in the user's journal
 * undo row rev 1401 re-created 16 entries for a one-entry edit (21:17:24Z) and the user pressed
 * redo 2.3 s later. Undo also judges the write scope at UNDO time, so ⌘Z pressed in the master
 * (component) view replays a page-instance step as a class write into the component file.
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 * Harness: EditorProvider > UndoProvider > ClassStoreProvider, real acceptance lane on
 * fake-indexeddb, real project-fs runtime (as ClassStoreContext.layersFirstEditUndoWrite.test.tsx).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn() });
  return { default: toast };
});
import toast from 'react-hot-toast';

import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests, admitLocalSourceScan, setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';
import { _resetClassIntentsForTests } from '@/services/classIntents';
import { sourceVersion } from '@/services/durableEdits/sourceIdentity';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { UndoProvider, useUndoContext } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

const PAGE = 'src/pages/blog/index.astro';
const CARD = 'src/components/BlogCard.astro';
const P = 's73bb06627ed37e6c';
/** Line 26, column 3 = the card's text <div>, as in the user's file. */
const CARD_SRC = ['---', 'const { post } = Astro.props;', '---', ...Array.from({ length: 22 }, (_, i) => `<!-- ${i} -->`),
  '  <div class={Astro.props.textClass ?? "flex flex-col justify-between"}>x</div>', ''].join('\n');
const PAGE_SRC = ['---', "import BlogCard from '../../components/BlogCard.astro';", '---',
  '<h1 class="m-0 text-center">Blog</h1>', '{posts.map((post) => <BlogCard post={post} />)}', ''].join('\n');
const V1 = sourceVersion(CARD_SRC);
const H1_KEY = `${PAGE}:4:1`;
const K = (copy: number) => `${CARD}:26:3~${P}${copy ? `#${copy}` : ''}`;
const LOC = { file: CARD, line: 26, column: 3, sourceVersion: V1 };
const scan4 = (classes: string) => [0, 1, 2, 3].map(copy => ({ key: K(copy), classes, sourceLocation: LOC,
  usageLocation: { file: PAGE, line: 5, column: 22 } }));

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
  localStorage.clear();
  projectId = `browser_repro_${crypto.randomUUID()}`;
  runtime = projectFsRuntime(projectId, { [PAGE]: PAGE_SRC, [CARD]: CARD_SRC });
  setActiveSaveProjectId(projectId);
  render(<EditorProvider><ProjectSeed><UndoProvider><ClassStoreProvider><Harness /></ClassStoreProvider></UndoProvider></ProjectSeed></EditorProvider>);
  await screen.findByTestId('ready');
  // The blog page is the surface: a BlogCard element is cross-file from here — an INSTANCE edit.
  act(() => { setLocalExpectedRoute('/blog'); setLocalPageFile(PAGE); });
}
const admit = (elements: ReturnType<typeof scan4>) => act(() => { admitLocalSourceScan(projectId, '/blog', elements); });
const docClass = (key: string) => docRef.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('classes');
const set = async (key: string, classes: string) => { let ok = false; await act(async () => { ok = await storeApi.setClasses(key, classes); }); return ok; };
const undo = () => act(async () => { await undoApi.undo(); });

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'postMessage').mockImplementation(() => {}); });
afterEach(() => {
  vi.restoreAllMocks(); runtime?.close(); runtime = undefined; setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetClassIntentsForTests(); resetClassWriteBaselines();
});

describe('REPRO: undo of instance edits', () => {
  it.fails('one ⌘Z reverts exactly the last gesture, not every entry of the map', async () => {
    await mount();
    admit(scan4('flex flex-col'));
    act(() => { storeApi.registerElement(K(0), 'flex flex-col', LOC); storeApi.registerElement(K(1), 'flex flex-col', LOC); });
    expect(await set(K(0), 'grid')).toBe(true);
    expect(await set(K(0), 'grid gap-2')).toBe(true);
    expect(await set(K(0), 'grid gap-2 p-4')).toBe(true);
    // Every paint lands on all copies; the user clicks copy #1 and its painted class is adopted (no undo step).
    act(() => { storeApi.registerElement(K(1), 'grid gap-2 p-4', LOC); });
    await undo();
    expect(docClass(K(0))).toBe('grid gap-2');
    // DESIRED: one instance, one step back — every copy shows the same value. Today copy #1 goes three steps back.
    expect(docClass(K(1))).toBe('grid gap-2');
  });

  it.fails('undo of an instance edit is not refused because an unrelated page element was clicked', async () => {
    await mount();
    admit(scan4('flex flex-col'));
    act(() => { storeApi.registerElement(K(0), 'flex flex-col', LOC); });
    expect(await set(K(0), 'grid')).toBe(true);
    // The user clicks the page's own <h1> for the first time (a registration-only entry, not in the undo snapshot).
    act(() => { storeApi.registerElement(H1_KEY, 'm-0 text-center', { file: PAGE, line: 4, column: 1 }); });
    await undo();
    expect(toast.error).not.toHaveBeenCalled(); // Today: "original file value is unknown", and the step stays on top forever.
    expect(docClass(K(0))).toBe('flex flex-col');
  });

  it.fails('undo pressed in the master view never writes an instance value into the component file', async () => {
    await mount();
    const PAGE_VALUE = 'flex flex-col justify-start items-stretch'; // what the page passes as textClass
    admit(scan4(PAGE_VALUE));
    act(() => { storeApi.registerElement(K(0), PAGE_VALUE, LOC); });
    expect(await set(K(0), 'grid gap-3')).toBe(true);
    // The user opens the component (master view), then presses ⌘Z.
    act(() => { setLocalExpectedRoute('/__sq_component_view/src/components/BlogCard.astro'); setLocalPageFile(CARD); });
    await undo();
    await flushDurableSourceWrites(projectId).catch(() => {});
    // DESIRED: the master keeps its literal. Today: `?? "flex flex-col justify-start items-stretch"` — the page's value baked into the master.
    expect(runtime!.read(CARD)).toBe(CARD_SRC);
  });
});
