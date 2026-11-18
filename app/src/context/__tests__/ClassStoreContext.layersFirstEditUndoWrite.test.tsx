/**
 * Layout-element paradigm (2026-08-24) — the undo of a FIRST edit must write
 * the PRE-EDIT file value back to disk.
 *
 * A Layers-panel selection never calls registerElement (that is the canvas
 * click path), so the first setClasses CREATES the sourceClasses key and the
 * observer's new-key branch froze `initialClassesRef[key]` at the EDITED
 * value. Undo then removed the key and "restored" that edited value — a
 * byte-identical write the plugin skips under a success reply, leaving the
 * user's file permanently edited after ⌘Z (live-caught on the layout <body>,
 * which can ONLY be selected via Layers).
 *
 * The scan already records what the file renders (classWriteBaseline,
 * task-166) before any edit — the new-key seed must prefer it.
 *
 * Contract migration (7932857b): class edits and their undo are durable
 * acceptances carrying `class-write` commands; the materializer writes the
 * bytes. So "undo writes X" is pinned by the accepted undo command and the real
 * file after a flush on a project-fs runtime, not by a writer mock.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});
import toast from 'react-hot-toast';

import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { UndoProvider, useUndoContext } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';
import { setClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';

const FILE = 'src/layouts/Main.astro';
const KEY = `${FILE}:37:2`;
const FILE_CLASSES = "font-['SuisseIntl']";
const EDITED = "font-['SuisseIntl'] md:pt-[120px]";
/** Main.astro with the layout <body> at line 37, column 2. */
const MAIN = [
  '<html>', ...Array.from({ length: 35 }, (_, i) => ` <!-- ${i} -->`),
  ` <body class="${FILE_CLASSES}">`, ' </body>', '</html>', '',
].join('\n');
const bodyLine = (classes: string) => ` <body class="${classes}">`;

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;

function ProjectSeed({ children }: { children: React.ReactNode }) {
  const doc = useEditorDoc();
  React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', projectId); }, [doc]);
  return <>{children}</>;
}

/** Accepted class-write commands after `fromRevision` (the durable "writes"). */
async function classWritesAfter(fromRevision: number) {
  const rows = await listUnmaterialized(projectId);
  return rows.filter(row => row.revision > fromRevision).flatMap(row => row.commands)
    .flatMap(command => command.kind === 'class-write' ? [command.payload.newClasses] : []);
}
async function latestRevision() {
  const rows = await listUnmaterialized(projectId);
  return Math.max(0, ...rows.map(row => row.revision));
}

let undoApi: ReturnType<typeof useUndoContext>;
let storeApi: ReturnType<typeof useClassStore>;

function Harness() {
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
  projectId = `browser_layers_first_edit_${crypto.randomUUID()}`;
  runtime = projectFsRuntime(projectId, { [FILE]: MAIN });
  setActiveSaveProjectId(projectId);
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

beforeEach(() => {
  vi.clearAllMocks();
  resetClassWriteBaselines();
});
afterEach(() => {
  vi.restoreAllMocks();
  runtime?.close(); runtime = undefined;
  setActiveSaveProjectId(null);
});

describe('first-edit undo writes the scan-seeded file value back', () => {
  it('⌘Z after a Layers-selected first edit writes the PRE-EDIT classes, not the edit', async () => {
    await mount();
    // The scan saw the file before any edit (viewportMessages/scanning.ts).
    setClassWriteBaseline(KEY, FILE_CLASSES);

    // Layers selection → no registerElement; the edit creates the key.
    await act(async () => { expect(await storeApi.setClasses(KEY, EDITED)).toBe(true); });
    await flushDurableSourceWrites(projectId);
    expect(runtime!.read(FILE)).toContain(bodyLine(EDITED));
    const beforeUndo = await latestRevision();

    await act(async () => { await undoApi.undo(); });

    expect(toast.error).not.toHaveBeenCalled();
    expect(await classWritesAfter(beforeUndo),
      'undo must restore the file value, not re-write the edit').toEqual([FILE_CLASSES]);
    await flushDurableSourceWrites(projectId);
    expect(runtime!.read(FILE)).toContain(bodyLine(FILE_CLASSES));
  });

  // The legacy fallback ("re-write the edited value" — a byte-identical no-op
  // that left the file edited after ⌘Z) is retired: since 7932857b the durable
  // undo refuses to invent an original value it never saw. It must fail loudly
  // and change nothing, rather than silently keep the edit on disk.
  it('no scan baseline (never-scanned element) refuses honestly instead of the old no-op write', async () => {
    await mount();
    await act(async () => { expect(await storeApi.setClasses(KEY, EDITED)).toBe(true); });
    await flushDurableSourceWrites(projectId);
    const beforeUndo = await latestRevision();

    await act(async () => { await undoApi.undo(); });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('original file value is unknown'));
    expect(await classWritesAfter(beforeUndo)).toEqual([]);
    expect(undoApi.canUndo).toBe(true); // the step is kept, not silently consumed
    expect(runtime!.read(FILE)).toContain(bodyLine(EDITED));
  });
});
