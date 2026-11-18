/**
 * A class edit must reach the source file even when it is the FIRST thing that
 * ever touched the element.
 *
 * Live defect (local mode, 2026-08-03): styling an element that lives in the
 * page file itself — `src/pages/index.astro:7:3`, the bare-key shape a page's
 * own elements are designed to have — wrote ZERO bytes. `git status` stayed
 * empty at +0s and +20s. The edit survived only as a `sq:source-classes`
 * overlay entry and repainted from there on reload. The documented contract
 * (docs/archive/plans/2026-08-03-local-instance-overrides-ledger.md) is the opposite:
 * "an element that lives in the page file → you're editing the page → yes,
 * real bytes". Only COMPONENT-owned elements are meant to be absorbed.
 *
 * Cause, and why it is not the local write-scope guard: the guard never runs.
 * `ClassStoreContext`'s sourceClasses observer only queues a file write for a
 * key that ALREADY had an entry in the tier — `editedKeys` is populated in the
 * `else if (prev[key].classes !== next[key].classes)` branch, so a key whose
 * entry the edit itself created falls into the `if (!prev[key])` branch and is
 * never passed to `markDirty`. The tier is populated by
 * `ClassStore.registerElement`, which runs on the iframe-CLICK path only, so any
 * selection that did not come from a canvas click (Layers panel, ⌘K insert
 * follow-on selection, restored selection) makes the user's first class edit a
 * new key — and it is silently never written.
 *
 * This is runtime-agnostic: it is the same code WC and server mode run. In WC
 * the overlay IS the persistence story so nothing is lost; in server and local
 * mode the file is the truth and the edit exists nowhere on disk.
 *
 * Contract migration (7932857b "make class edits durable before source flush"):
 * setClasses no longer feeds an observer → markDirty → viteClassWriter queue.
 * It accepts ONE durable edit carrying a `class-write` materialization command
 * (the "write"), and the materializer puts the bytes on disk. So "writes the
 * file" is pinned by the accepted command AND the real bytes after a flush on a
 * project-fs runtime. The image tier still uses its writer queue.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { db } from '@/db';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';

const PAGE_KEY = 'src/pages/index.astro:7:3';
const PAGE_LOC = { file: 'src/pages/index.astro', line: 7, column: 3 };

const IMG_KEY = 'src/pages/index.astro:11:5';
const IMG_LOC = { file: 'src/pages/index.astro', line: 11, column: 5 };

const PAGE_SOURCE = [
  '---', '---', '<html>', '<body>', '<main>', '<section>',
  '  <h1 class="text-sm">Hi</h1>',
  '</section>', '<div>', '<figure>',
  '    <img src="/cat.png" alt="" />',
  '</figure>', '</div>', '</main>', '</body>', '</html>', '',
].join('\n');

const h = vi.hoisted(() => ({
  doc: null as unknown as Y.Doc,
  lastEdit: Promise.resolve(true) as Promise<boolean>,
  writeClassUpdate: vi.fn(() => Promise.resolve(true)),
  writeImageUpdate: vi.fn(() => Promise.resolve(true)),
  // WC mode: setServerWriteMode(false) at Editor mount ⇒ isAvailable() false.
  classWriterAvailable: vi.fn(() => true),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  // Faithful to the real useDispatch: applyCommand inside a 'user' transaction.
  useDispatch: () => (command: unknown) => {
    let result = false;
    h.doc.transact(() => {
      result = applyCommand(h.doc, command as Parameters<typeof applyCommand>[1]);
    }, 'user');
    return result;
  },
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
}));
const hoistedUndo = vi.hoisted(() => ({
  ctx: { takeSnapshot: vi.fn(), isUndoingRef: { current: false } },
}));
vi.mock('@/context/UndoContext', () => ({
  // isUndoingRef is the authoritative undo signal the provider reads (task-150).
  // ONE stable object: the real UndoContext hands back the same ref every
  // render, and a fresh one per call re-subscribes the observers forever.
  useUndoContext: () => hoistedUndo.ctx,
}));
vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: {
    isAvailable: h.classWriterAvailable,
    writeClassUpdate: h.writeClassUpdate,
  },
}));
vi.mock('@/services/ViteImageWriter', () => ({
  viteImageWriter: {
    isAvailable: () => true,
    writeImageUpdate: h.writeImageUpdate,
  },
}));

import { applyCommand } from '@/store/commands';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';
import { useDispatch } from '@/store/hooks';

function Harness() {
  const { registerElement, setClasses } = useClassStore();
  const dispatch = useDispatch();
  return (
    <>
      <button
        data-testid="click-select"
        onClick={() => registerElement(PAGE_KEY, 'text-sm', PAGE_LOC)}
      />
      <button
        data-testid="edit"
        onClick={() => { h.lastEdit = setClasses(PAGE_KEY, 'text-sm text-red-500'); }}
      />
      <button
        data-testid="edit-image"
        onClick={() =>
          dispatch({
            type: 'UPDATE_IMAGE_ATTRIBUTE',
            elementId: IMG_KEY,
            attribute: 'alt',
            value: 'a cat',
          })
        }
      />
    </>
  );
}

/** Every SYNC_CLASSES_TO_IFRAME the provider emitted, in order. */
let syncMessages: Array<{ key: string; classes: string }>;
let postMessageSpy: ReturnType<typeof vi.spyOn>;

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;

async function mount() {
  await db.delete(); await db.open();
  resetClassWriteBaselines();
  projectId = `browser_first_edit_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': PAGE_SOURCE });
  setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc();
  // setClasses is a durable acceptance (7932857b): it needs a project id.
  h.doc.getMap('meta').set('projectId', projectId);
  h.lastEdit = Promise.resolve(true);
  h.writeClassUpdate.mockClear();
  h.writeImageUpdate.mockClear();
  h.classWriterAvailable.mockClear();
  syncMessages = [];
  postMessageSpy?.mockRestore();
  postMessageSpy = vi
    .spyOn(window, 'postMessage')
    .mockImplementation((msg: unknown) => {
      const m = msg as { type?: string; payload?: { key: string; classes: string; painted?: boolean } };
      // A `painted` SYNC is only the observer's bookkeeping for a value the writer already put on the canvas at call
      // time (instant-edit P1): a canvas that understands intents skips it, so it is never a second DOM push.
      if (m?.type === 'SYNC_CLASSES_TO_IFRAME' && m.payload && !m.payload.painted) {
        syncMessages.push({ key: m.payload.key, classes: m.payload.classes });
      }
    });
  render(
    <ClassStoreProvider>
      <Harness />
    </ClassStoreProvider>,
  );
}

/** The image queue is idle-debounced at 5s; drive past it. */
function flushIdleSave() {
  act(() => {
    vi.advanceTimersByTime(6000);
  });
}

/** Click the class edit and wait for its durable acceptance to settle. */
async function editClasses() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('edit'));
    await h.lastEdit;
  });
}

/** Every accepted class-write command (the durable "file write"). */
async function acceptedClassWrites() {
  const rows = await listUnmaterialized(projectId);
  return rows.flatMap(row => row.commands).flatMap(command =>
    command.kind === 'class-write' ? [command.payload] : []);
}

beforeEach(() => {
  localStorage.clear();
  h.classWriterAvailable.mockReturnValue(true);
  // Only the timer functions: IndexedDB (fake-indexeddb) runs on setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  cleanup();
  postMessageSpy?.mockRestore();
  vi.useRealTimers();
  runtime?.close(); runtime = undefined;
  setActiveSaveProjectId(null);
});

describe('a class edit on a page-file element writes the file', () => {
  it('FIRST edit on an element the tier has never seen still writes (Layers-panel selection)', async () => {
    await mount();

    // No registerElement: this is a selection that never went through an
    // iframe click. The edit itself creates the sourceClasses entry.
    await editClasses();
    expect(await h.lastEdit).toBe(true);

    const writes = await acceptedClassWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      sourceLocation: expect.objectContaining(PAGE_LOC),
      newClasses: 'text-sm text-red-500',
      // 2026-08-05: the gesture-time write-scope origin travels with the
      // command so a deferred write is not re-judged against a surface the
      // user has since left.
      origin: expect.anything(),
    });
    // task-166: the class-write baseline slot is always carried (null = the
    // materializer reads what the FILE renders).
    expect(writes[0]).toHaveProperty('baseClasses');

    // …and the bytes land in the real file.
    await flushDurableSourceWrites(projectId);
    expect(runtime!.read('src/pages/index.astro')).toContain('<h1 class="text-sm text-red-500">Hi</h1>');
  });

  // Control — passes today. Proves the harness, the writer mock and the idle
  // timer are all wired correctly, so the failure above is the defect and not
  // the setup.
  it('control: an edit AFTER a canvas click (entry already in the tier) writes', async () => {
    await mount();

    act(() => {
      fireEvent.click(screen.getByTestId('click-select'));
    });
    await editClasses();

    expect(await acceptedClassWrites()).toContainEqual(expect.objectContaining({
      sourceLocation: expect.objectContaining(PAGE_LOC),
      newClasses: 'text-sm text-red-500',
      // task-166: the baseline registered by the click — what the FILE renders.
      baseClasses: 'text-sm',
    }));
  });
});

/**
 * The OTHER half of the same defect. In the live repro the missing file write
 * and the missing canvas repaint flipped together on every pass, because both
 * hang off the observer's single `editedKeys` collection: the forEach posts
 * SYNC_CLASSES_TO_IFRAME (→ ViewportFrame → UPDATE_CLASSES → bridge → DOM) AND
 * calls markDirty. A key that never enters `editedKeys` gets neither. A fix
 * that only restores the write leaves the canvas black.
 */
describe('a class edit on a page-file element repaints the canvas', () => {
  it('FIRST edit on an element the tier has never seen syncs to the iframe', async () => {
    await mount();

    await editClasses();

    expect(syncMessages).toContainEqual({
      key: PAGE_KEY,
      classes: 'text-sm text-red-500',
    });
  });

  it('control: an edit AFTER a canvas click syncs to the iframe', async () => {
    await mount();

    act(() => {
      fireEvent.click(screen.getByTestId('click-select'));
    });
    await editClasses();

    expect(syncMessages).toContainEqual({
      key: PAGE_KEY,
      classes: 'text-sm text-red-500',
    });
  });

  it('emits exactly ONE sync per edit — no duplicate DOM push', async () => {
    await mount();

    await editClasses();

    expect(
      syncMessages.filter((m) => m.classes === 'text-sm text-red-500'),
    ).toHaveLength(1);
  });
});

/**
 * The guard rail on the fix. Registration is NOT an edit.
 *
 * `registerElement` runs on every canvas click and `restoreSourceClasses` runs
 * once at boot for every persisted overlay entry — both create sourceClasses
 * keys the user did not just touch. If either queues a write, a plain click
 * rewrites a class attribute, and in local mode opening a project flushes the
 * whole overlay into the user's real files. That is the shape of the migration
 * purge that destroyed live data on 2026-08-03 (placementStorageMigration.test.ts).
 * Never "fix" the first-edit defect by treating all NEW keys as edited.
 */
describe('registration is not an edit', () => {
  it('a canvas click alone queues NO file write and NO iframe sync', async () => {
    await mount();

    act(() => {
      fireEvent.click(screen.getByTestId('click-select'));
    });
    flushIdleSave();

    expect(h.writeClassUpdate).not.toHaveBeenCalled();
    expect(await acceptedClassWrites()).toEqual([]);
    expect(syncMessages).toEqual([]);
  });

});

/**
 * Sibling tiers. Both already write on a FIRST edit — the image tier because
 * useSourceImageSync diffs per-attribute against an ABSENT prev map (undefined
 * !== value → markDirty), the text tier because viewportMessages/textEditing.ts
 * writes straight from the commit handler and never consults a prev tier.
 * Pinned so the class-tier fix cannot regress them.
 */
describe('sibling source tiers are unaffected', () => {
  it('image tier: a FIRST image-attribute edit writes the file', async () => {
    await mount();

    act(() => {
      fireEvent.click(screen.getByTestId('edit-image'));
    });
    flushIdleSave();

    expect(h.writeImageUpdate).toHaveBeenCalledWith(
      expect.objectContaining(IMG_LOC),
      'alt',
      'a cat', false, { armed: false, pageFile: null }, true, expect.any(String),
    );
  });

  it('image tier: a class edit does not queue an image write', async () => {
    await mount();

    await editClasses();
    flushIdleSave();

    expect(h.writeImageUpdate).not.toHaveBeenCalled();
  });
});

/**
 * WC shares this exact code — the fix is branch-free by design. The old
 * "writer unavailable" WC mode (setServerWriteMode(false) ⇒ the observer's
 * flush degraded to a no-op) is retired: since the files-truth unification
 * (2026-08-28) WC IS the runtime and writes real files, and since 7932857b the
 * class edit never consults viteClassWriter (its "newly-executed flush writes
 * nothing" pin was deleted with that path). What remains true: an unavailable
 * legacy writer changes neither the repaint nor the inertness of a click.
 */
describe('WC mode: writer unavailable', () => {
  it('a FIRST edit still repaints the canvas', async () => {
    h.classWriterAvailable.mockReturnValue(false);
    await mount();

    await editClasses();

    expect(syncMessages).toContainEqual({
      key: PAGE_KEY,
      classes: 'text-sm text-red-500',
    });
  });

  it('a canvas click alone is still inert in WC', async () => {
    h.classWriterAvailable.mockReturnValue(false);
    await mount();

    act(() => {
      fireEvent.click(screen.getByTestId('click-select'));
    });
    flushIdleSave();

    expect(h.writeClassUpdate).not.toHaveBeenCalled();
    expect(await acceptedClassWrites()).toEqual([]);
    expect(syncMessages).toEqual([]);
  });
});
