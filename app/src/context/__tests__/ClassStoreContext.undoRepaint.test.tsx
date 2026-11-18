/**
 * task-149 / task-151 — ⌘Z and ⇧⌘Z must repaint the canvas IN PLACE.
 *
 * The predecessor fix re-navigated the whole preview whenever an undo added or
 * removed an overlay key. Two live measurements retired it: the reload costs
 * 100 % of the scroll position (1087 px → 0 in 1036 ms at the editor's 375×667
 * geometry), and it raced — the ⇧⌘Z after the ⌘Z that follows a Reset left the
 * canvas byte-identical (`e1d75e83…`) at +1/+6/+20 s *even though* the frame
 * reloaded, 2 runs of 2.
 *
 * The observers already carry a VALUE change to the iframe with no reload and
 * no race. An ADD is a value change to the restored override; a REMOVE is a
 * value change back to the source baseline (which only the bridge saw — see
 * bridge/parts/__tests__/undo-restore-baselines.test.ts). Both belong here.
 *
 * This file is also the regression test for **task-150**. `isUndoingOrRedoing()`
 * used to be derived from `doc.on('update')`, and Yjs emits type observers
 * BEFORE the update event (probe: `observer | update:sync | observer |
 * update:undo`), so the flag was stale by one transaction and every one of these
 * branches was skipped on the FIRST ⌘Z after any user/sync transaction — which
 * is the only ⌘Z that matters. The signal is now `UndoContext.isUndoingRef`,
 * the same authoritative ref ViewportFrame's sourceText observer already reads.
 *
 * Contract migration: setClasses / undo / redo are durable acceptances
 * (7932857b) — the doc needs a project id, the class edit's source command
 * needs a project-fs runtime to prepare against, and every call is awaited.
 * "Reset to master" now calls the REAL clearLocalOverrides.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import React from 'react';
import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: {
    isAvailable: () => false,
    writeClassUpdate: vi.fn(() => Promise.resolve(true)),
    setIframeRef: vi.fn(),
  },
}));

import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines, setClassWriteBaseline } from '@/services/classWriteBaseline';
import { clearLocalOverrides } from '@/store/localMasterOverrides';
import { setLocalExpectedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { UndoProvider, useUndoContext } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

const KEY = 'src/components/Feature.astro:20:5~p4317f4b4863ead18';
const LOC = { file: 'src/components/Feature.astro', line: 20, column: 5 };

type Msg = { type: string; payload: Record<string, unknown> };
let posted: Msg[];
let spy: ReturnType<typeof vi.spyOn>;

const ofType = (type: string) => posted.filter((m) => m.type === type);

let docRef: Y.Doc;
let undoApi: ReturnType<typeof useUndoContext>;
let storeApi: ReturnType<typeof useClassStore>;

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;
/** Feature.astro with the element at line 20, column 5. */
const FEATURE = [
  ...Array.from({ length: 19 }, (_, i) => (i === 0 ? '<section>' : `  <!-- ${i} -->`)),
  '    <h2 class="text-2xl font-bold">Feature</h2>',
  '</section>', '',
].join('\n');

function ProjectSeed({ children }: { children: React.ReactNode }) {
  const doc = useEditorDoc();
  React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', projectId); }, [doc]);
  return <>{children}</>;
}

function Harness() {
  docRef = useEditorDoc();
  undoApi = useUndoContext();
  storeApi = useClassStore();
  // Ready = the providers have rendered WITH the project. The meta id lands in
  // a layout effect, so the first commit's store still has no project — under
  // full-suite load a test could call it then ("Project storage is not ready").
  const ready = useYjsValue(selectProjectId) === projectId;
  return ready ? <span data-testid="ready" /> : null;
}

async function mount() {
  await db.delete(); await db.open();
  resetClassWriteBaselines();
  projectId = `browser_undo_repaint_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { [LOC.file]: FEATURE });
  setActiveSaveProjectId(projectId);
  posted = [];
  spy = vi.spyOn(window, 'postMessage').mockImplementation((msg: unknown) => {
    const m = msg as Msg;
    if (m && typeof m.type === 'string') posted.push(m);
  });
  render(
    <EditorProvider>
      <ProjectSeed>
        <UndoProvider>
          <ClassStoreProvider>
            <Harness />
          </ClassStoreProvider>
        </UndoProvider>
      </ProjectSeed>
    </EditorProvider>,
  );
  return screen.findByTestId('ready');
}

/** Seed an override entry the way `restoreSourceClasses` / a scan re-apply does. */
function seed(doc: Y.Doc, key: string, classes: string) {
  doc.transact(() => {
    const entry = new Y.Map();
    entry.set('classes', classes);
    entry.set('edited', true);
    const loc = new Y.Map();
    loc.set('file', LOC.file);
    loc.set('line', LOC.line);
    loc.set('column', LOC.column);
    entry.set('sourceLocation', loc);
    doc.getMap('sourceClasses').set(key, entry);
  }, 'sync');
}

/** Local mode's "Reset to master" (DesignBar): the REAL clearLocalOverrides.
 *  Reset only exists on a PAGE surface, where the component file is cross-file
 *  (the override is a doc-only overlay) — arm that surface like the editor does. */
function clearOverrides(doc: Y.Doc) {
  setLocalExpectedRoute('/');
  clearLocalOverrides(doc, [{ kind: 'classes', key: KEY, sourceLocation: LOC, value: 'text-2xl text-red-500' }], 'user');
}

const undo = async () => { await act(async () => { await undoApi.undo(); }); };
const redo = async () => { await act(async () => { await undoApi.redo(); }); };
const setClasses = async (classes: string) => {
  let ok = false;
  await act(async () => { ok = await storeApi.setClasses(KEY, classes); });
  expect(ok).toBe(true);
};

beforeEach(() => { posted = []; });
afterEach(() => {
  spy?.mockRestore(); vi.restoreAllMocks();
  runtime?.close(); runtime = undefined;
  setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests();
});

describe('an overlay key RESTORED by undo repaints in place', () => {
  it('⌘Z after Reset to master syncs the restored classes to the iframe', async () => {
    await mount();
    seed(docRef, KEY, 'text-2xl text-red-500');

    act(() => undoApi.takeSnapshot());
    act(() => clearOverrides(docRef));
    expect(undoApi.canUndo).toBe(true); // Reset is an undoable step
    posted = [];

    await undo();

    expect(docRef.getMap('sourceClasses').has(KEY)).toBe(true);
    // The undo is a durable edit like any other: its SYNC carries the call-order intent (instant-edit P0b).
    expect(ofType('SYNC_CLASSES_TO_IFRAME').map((m) => m.payload)).toEqual([
      { key: KEY, classes: 'text-2xl text-red-500', sourceLocation: LOC, intent: { epoch: expect.any(String), seq: expect.any(Number), hold: expect.any(Boolean) } },
    ]);
  });

  it('and never asks for a preview reload — that was the scroll-destroying instrument', async () => {
    const reloads: number[] = [];
    const onReload = () => reloads.push(1);
    window.addEventListener('sq:reload-preview', onReload);
    try {
      await mount();
      seed(docRef, KEY, 'text-2xl text-red-500');
      act(() => undoApi.takeSnapshot());
      act(() => clearOverrides(docRef));
      await undo();
      await redo();
      expect(reloads).toEqual([]);
    } finally {
      window.removeEventListener('sq:reload-preview', onReload);
    }
  });

  it('CONTROL: registering an element is not an undo — it must NOT sync', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'text-2xl font-bold', LOC); });
    expect(ofType('SYNC_CLASSES_TO_IFRAME')).toEqual([]);
  });
});

describe('an overlay key REMOVED by undo restores the source baseline in place', () => {
  it('the FIRST ⌘Z after an edit asks the iframe for its pre-override baseline (task-150)', async () => {
    await mount();
    // No registerElement: a Layers-panel / restored selection, so the edit
    // itself CREATES the tier entry and undoing it REMOVES the key.
    // The scan recorded what the FILE renders before any edit (task-166);
    // without it the durable undo refuses to invent one (7932857b).
    setClassWriteBaseline(KEY, 'text-2xl font-bold');
    await setClasses('text-2xl text-red-500');
    posted = [];

    // ONE undo — no warm-up transaction to hide a stale origin flag behind.
    // Under the old `doc.on('update')` flag the preceding 'user' transaction
    // was still the "last origin" during the observer run, so this branch was
    // skipped on exactly the ⌘Z that matters.
    await undo();

    expect(docRef.getMap('sourceClasses').has(KEY)).toBe(false);
    expect(ofType('RESTORE_CLASSES_TO_IFRAME').map((m) => (m.payload as { key: string }).key))
      .toEqual([KEY]);
  });

  it('⇧⌘Z of a Reset removes the keys again and restores the baseline (the measured race)', async () => {
    await mount();
    seed(docRef, KEY, 'text-2xl text-red-500');
    act(() => undoApi.takeSnapshot());
    act(() => clearOverrides(docRef));
    expect(undoApi.canUndo).toBe(true); // Reset is an undoable step
    await undo();
    expect(docRef.getMap('sourceClasses').has(KEY)).toBe(true);
    posted = [];

    await redo();

    expect(docRef.getMap('sourceClasses').has(KEY)).toBe(false);
    expect(ofType('RESTORE_CLASSES_TO_IFRAME').map((m) => (m.payload as { key: string }).key))
      .toEqual([KEY]);
  });
});

describe('unchanged paths', () => {
  it('a value-only undo still syncs the value, and asks for no restore', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'text-2xl font-bold', LOC); });
    await setClasses('a');
    await setClasses('b');
    posted = [];

    await undo();

    expect(ofType('SYNC_CLASSES_TO_IFRAME').map((m) => m.payload.classes)).toEqual(['a']);
    expect(ofType('RESTORE_CLASSES_TO_IFRAME')).toEqual([]);
  });
});
