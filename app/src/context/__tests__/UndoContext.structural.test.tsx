import 'fake-indexeddb/auto';
/**
 * task-133 Task 8: structural undo — inverse replay on the one undo stack.
 *
 * Structural entries (file writes) share the one past/future stack with doc
 * snapshots. ⌘Z on a structural entry replays its INVERSE ops (never
 * applySnapshot — there is no doc state for them); ⇧⌘Z replays the forward
 * ops. The shared structural in-flight guard serializes replays against live
 * ops and against each other (guard-refusal + toast, no queue).
 *
 * Contract migration (the legacy fixture mocked viteStructuralWriter):
 * - fdd2d12f / 87a0781c: replay is ONE durable acceptance — the ops run as pure
 *   transforms over the projected source (acceptStructuralReplay) and are
 *   materialized afterwards. So op order is pinned by the resulting BYTES on a
 *   real project-fs runtime, not by writer-mock call order.
 * - 87a0781c: a rejected replay changes nothing and "leaves the entry
 *   untouched" (it used to be DROPPED because a partial file write had already
 *   happened). Acceptance is atomic, so there is no "partly" outcome anymore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

const h = vi.hoisted(() => ({ doc: null as unknown as import('yjs').Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));

import toast from 'react-hot-toast';
import { UndoProvider, useUndoContext } from '../UndoContext';
import {
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
  _resetStructuralWriteInFlightForTests,
} from '@/components/Editor/localStructuralOps';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import { applyCommand } from '@/store/commands';

const PAGE = 'src/pages/index.astro';
/** The page before any gesture. */
const ORIGINAL = '---\n---\n<main>\n  <p>keep</p>\n  <div>bye</div>\n</main>\n';
/** After deleting `<div>bye</div>` (line 5). */
const DELETED = '---\n---\n<main>\n  <p>keep</p>\n</main>\n';
/** After ⌘K-inserting `<Card />` after `<p>keep</p>` with a NEW import. */
const INSERTED_WITH_IMPORT = "---\nimport Card from '../components/Card.astro';\n---\n<main>\n  <p>keep</p>\n  <Card />\n  <div>bye</div>\n</main>\n";
/** The page already importing Card, before the insert. */
const IMPORTED = "---\nimport Card from '../components/Card.astro';\n---\n<main>\n  <p>keep</p>\n  <div>bye</div>\n</main>\n";
/** After moving `<p>keep</p>` below `<div>bye</div>`. */
const MOVED = '---\n---\n<main>\n  <div>bye</div>\n  <p>keep</p>\n</main>\n';

/** Delete gesture: forward remove, inverse verbatim restore. */
const deleteRecord = (): StructuralUndoRecord => ({
  structuralOp: {
    forward: [{ kind: 'remove', loc: { file: PAGE, line: 5, column: 3 } }],
    inverse: [{ kind: 'restore', loc: { file: PAGE, line: 5, column: 1 }, text: '  <div>bye</div>\n' }],
  },
});

/** ⌘K component insert (import added first, so the insert loc is post-import).
 *  Inverse = region restore of the splice THEN import removal. */
const insertRecord = (withImport: boolean): StructuralUndoRecord => ({
  structuralOp: {
    forward: [
      ...(withImport
        ? [{ kind: 'import', pageFile: PAGE, name: 'Card', importPath: '../components/Card.astro', remove: false } as const]
        : []),
      { kind: 'insert', loc: { file: PAGE, line: 5, column: 3 }, markup: '<Card />', position: 'after' },
    ],
    inverse: [
      { kind: 'restore-region', loc: { file: PAGE, line: 6, column: 1 }, lineCount: 1, segment: '' },
      ...(withImport
        ? [{ kind: 'import', pageFile: PAGE, name: 'Card', importPath: '../components/Card.astro', remove: true } as const]
        : []),
    ],
  },
});

/** Move gesture: forward move, inverse region-restore of the splice +
 *  verbatim restore at the original spot. */
const moveRecord = (): StructuralUndoRecord => ({
  structuralOp: {
    forward: [{ kind: 'move', from: { file: PAGE, line: 4, column: 3 }, to: { file: PAGE, line: 5, column: 3 }, position: 'after' }],
    inverse: [
      { kind: 'restore-region', loc: { file: PAGE, line: 5, column: 1 }, lineCount: 1, segment: '' },
      { kind: 'restore', loc: { file: PAGE, line: 4, column: 1 }, text: '  <p>keep</p>\n' },
    ],
  },
});

/** A replay whose target file does not exist → the acceptance rejects. */
const brokenRecord = (): StructuralUndoRecord => ({
  structuralOp: {
    forward: [{ kind: 'remove', loc: { file: 'src/pages/missing.astro', line: 1, column: 1 } }],
    inverse: [{ kind: 'restore', loc: { file: 'src/pages/missing.astro', line: 1, column: 1 }, text: '<p/>\n' }],
  },
});

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

async function boot(files: Record<string, string>) {
  await db.delete(); await db.open();
  projectId = `browser_structural_undo_${crypto.randomUUID()}`;
  h.doc = new Y.Doc();
  h.doc.getMap('meta').set('projectId', projectId);
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, files);
}

/** Materialize every accepted revision, then read the real file. */
async function disk(file = PAGE) {
  await flushDurableSourceWrites(projectId);
  return runtime.read(file);
}

/** Hold the project's single acceptance lane so a replay stays in flight. */
function holdAcceptanceLane() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = acceptProjectEdit(h.doc, {
    projectId, operationId: `hold:${crypto.randomUUID()}`, commands: [],
    prepare: () => gate, mutate: () => {},
  });
  return async () => { release(); await held; };
}

const mount = () => renderHook(() => ({ ...useUndoContext(), doc: h.doc }), {
  wrapper: ({ children }: { children: React.ReactNode }) => <UndoProvider>{children}</UndoProvider>,
});

function teardown() {
  cleanup();
  runtime?.close();
  h.doc?.destroy();
  setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests();
  _resetStructuralWriteInFlightForTests();
}

describe('UndoContext structural entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetStructuralWriteInFlightForTests();
  });
  afterEach(teardown);

  it('pushStructuralUndo arms canUndo and clears the future stack', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    // Build a redo entry first: push + undo → future has one entry
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    await act(async () => { await result.current.undo(); });
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false); // new gesture clears redo
  });

  it('undo of a delete entry replays the exact restore op', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(ORIGINAL);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('undo of an insert entry replays region-restore THEN import-remove (only when added)', async () => {
    await boot({ [PAGE]: INSERTED_WITH_IMPORT });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(insertRecord(true)));
    await act(async () => { await result.current.undo(); });
    // Import-remove first would shift line 6 → the region restore would delete
    // `<div>bye</div>` instead of `<Card />`. Exact bytes pin the order.
    expect(await disk()).toBe(ORIGINAL);
  });

  it('an inverse import op flagged removeFences replays with the flag (created-frontmatter collapse)', async () => {
    const bare = '<main>\n  <p>keep</p>\n</main>\n';
    await boot({ [PAGE]: "---\nimport Card from '../c/Card.astro';\n---\n<main>\n  <p>keep</p>\n</main>\n" });
    const { result } = mount();
    const record: StructuralUndoRecord = {
      structuralOp: {
        forward: [{ kind: 'import', pageFile: PAGE, name: 'Card', importPath: '../c/Card.astro', remove: false }],
        inverse: [{ kind: 'import', pageFile: PAGE, name: 'Card', importPath: '../c/Card.astro', remove: true, removeFences: true }],
      },
    };
    act(() => result.current.pushStructuralUndo(record));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(bare); // fences gone too, not an empty `---\n---`
  });

  // review pin: fileRecords belong to doc snapshots — attaching while a
  // structural entry tops the stack must leave the stack untouched (the entry
  // still replays; nothing throws).
  it('attachFileRecords with a structural entry on top is a no-op (guard pin)', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    act(() => result.current.attachFileRecords([{ path: 'x', previousContent: null }]));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(ORIGINAL);
    expect(result.current.canRedo).toBe(true);
  });

  it('undo of an insert entry whose import pre-existed never strips the import', async () => {
    await boot({ [PAGE]: INSERTED_WITH_IMPORT });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(insertRecord(false)));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(IMPORTED);
  });

  it('undo of a move entry replays region-restore of the splice THEN verbatim restore', async () => {
    await boot({ [PAGE]: MOVED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(moveRecord()));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(ORIGINAL);
  });

  it('redo replays the forward ops in order (import-add THEN insert) and re-arms undo', async () => {
    await boot({ [PAGE]: INSERTED_WITH_IMPORT });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(insertRecord(true)));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(ORIGINAL);
    await act(async () => { await result.current.redo(); });
    // Insert at 5:3 is only `<p>keep</p>` AFTER the import added a line.
    expect(await disk()).toBe(INSERTED_WITH_IMPORT);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('redo of a move entry replays the forward move', async () => {
    await boot({ [PAGE]: MOVED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(moveRecord()));
    await act(async () => { await result.current.undo(); });
    expect(await disk()).toBe(ORIGINAL);
    await act(async () => { await result.current.redo(); });
    expect(await disk()).toBe(MOVED);
  });

  it('failed undo replay → error toast, file untouched, entry STAYS (87a0781c), rest of the stack intact', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    // doc entry below the structural entry
    act(() => result.current.takeSnapshot());
    act(() => { h.doc.transact(() => h.doc.getMap('sourceText').set('k', new Y.Map()), 'user'); });
    act(() => result.current.pushStructuralUndo(brokenRecord()));
    await act(async () => { await result.current.undo(); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Undo was not saved'));
    expect(await disk()).toBe(DELETED);
    expect(result.current.canRedo).toBe(false); // not moved to future
    expect(result.current.canUndo).toBe(true);  // rejected replay left it on past
    // The stack is not corrupted: the next ⌘Z retries the same entry.
    await act(async () => { await result.current.undo(); });
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(result.current.canUndo).toBe(true);
  });

  it('failed redo replay → error toast, entry stays on future (87a0781c)', async () => {
    // The forward remove targets a file that disappeared after the undo.
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    const record: StructuralUndoRecord = {
      structuralOp: { forward: brokenRecord().structuralOp.forward, inverse: deleteRecord().structuralOp.inverse },
    };
    act(() => result.current.pushStructuralUndo(record));
    await act(async () => { await result.current.undo(); });
    expect(result.current.canRedo).toBe(true);
    await act(async () => { await result.current.redo(); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Redo was not saved'));
    expect(await disk()).toBe(ORIGINAL);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
  });

  it('a later-op failure rejects the WHOLE replay atomically: no partial write, entry stays', async () => {
    await boot({ [PAGE]: MOVED });
    const { result } = mount();
    const record = moveRecord();
    // First inverse op is valid; the second targets a missing file.
    record.structuralOp.inverse = [record.structuralOp.inverse[0], brokenRecord().structuralOp.inverse[0]];
    act(() => result.current.pushStructuralUndo(record));
    await act(async () => { await result.current.undo(); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(await disk()).toBe(MOVED); // the first op's splice was NOT applied
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  // Owner 2026-11-10 ("no refusals … nothing should be lost"): ⌘Z of an edit
  // made on another page used to be refused ("Structural replay belongs to
  // another surface"). The entry remembers its page and replays there.
  it('an edit made on one page undoes and redoes from another page', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    setLocalExpectedRoute('/'); setLocalPageFile(PAGE); // the edit's page
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    setLocalExpectedRoute('/about'); setLocalPageFile('src/pages/about.astro'); // the user moved on
    await act(async () => { await result.current.undo(); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(await disk()).toBe(ORIGINAL);
    await act(async () => { await result.current.redo(); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(await disk()).toBe(DELETED);
  });

  // Owner 2026-11-10: "there should be no refusals … nothing should be lost".
  it('a live structural write in flight → the undo waits its turn, then runs (no "busy")', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    expect(tryAcquireStructuralWrite()).toBe(true); // a live op holds the guard
    let undone!: Promise<unknown>;
    act(() => { undone = Promise.resolve(result.current.undo()); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(await disk()).toBe(DELETED); // still waiting its turn
    releaseStructuralWrite();
    await act(async () => { await undone; });
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('busy'));
    expect(await disk()).toBe(ORIGINAL);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('rapid double-undo: both run, one after another, each on the entry the first one left', async () => {
    // Two stacked deletes: `<div>bye</div>` then `<p>keep</p>`.
    await boot({ [PAGE]: '---\n---\n<main>\n</main>\n' });
    const { result } = mount();
    const deleteKeep: StructuralUndoRecord = {
      structuralOp: {
        forward: [{ kind: 'remove', loc: { file: PAGE, line: 4, column: 3 } }],
        inverse: [{ kind: 'restore', loc: { file: PAGE, line: 4, column: 1 }, text: '  <p>keep</p>\n' }],
      },
    };
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    act(() => result.current.pushStructuralUndo(deleteKeep));
    const release = holdAcceptanceLane();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => { first = Promise.resolve(result.current.undo()); }); // first replay in flight
    act(() => { second = Promise.resolve(result.current.undo()); }); // queued — never refused
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('busy'));
    await act(async () => { await release(); await first; });
    // The queued press runs on the stack the first one LEFT (after its render).
    await act(async () => { await second; });
    expect(result.current.canUndo).toBe(false); // both entries undone, in order
    expect(result.current.canRedo).toBe(true);
    expect(await disk()).toBe(ORIGINAL);
  });

  // review minor (Task 10 sweep): a new gesture while a structural replay is in
  // flight clears `future` — the replay's success resolution must NOT re-add its
  // entry afterwards (stale-redo resurrection).
  it('a doc gesture during an in-flight undo replay kills the stale redo (generation guard)', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    const release = holdAcceptanceLane();
    let replay!: Promise<unknown>;
    act(() => { replay = Promise.resolve(result.current.undo()); }); // replay in flight
    // new gesture mid-flight: checkpoint + user edit commits it (c8535b79)
    act(() => result.current.takeSnapshot());
    act(() => { h.doc.transact(() => h.doc.getMap('sourceText').set('k', new Y.Map()), 'user'); });
    await act(async () => { await release(); await replay; });
    expect(result.current.canRedo).toBe(false); // stale redo NOT resurrected
    expect(result.current.canUndo).toBe(true);  // the new snapshot survives
  });

  it('pushStructuralUndo during an in-flight undo replay also kills the stale redo', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    const release = holdAcceptanceLane();
    let replay!: Promise<unknown>;
    act(() => { replay = Promise.resolve(result.current.undo()); });
    act(() => result.current.pushStructuralUndo(deleteRecord())); // new structural gesture
    await act(async () => { await release(); await replay; });
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('a doc gesture during an in-flight redo replay drops the entry (no out-of-order undo)', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    await act(async () => { await result.current.undo(); }); // future: [entry]
    expect(await disk()).toBe(ORIGINAL);
    const release = holdAcceptanceLane();
    let replay!: Promise<unknown>;
    act(() => { replay = Promise.resolve(result.current.redo()); }); // forward replay in flight
    act(() => result.current.takeSnapshot()); // newer gesture lands on past mid-flight
    act(() => { h.doc.transact(() => h.doc.getMap('sourceText').set('k', new Y.Map()), 'user'); });
    await act(async () => { await release(); await replay; });
    expect(await disk()).toBe(DELETED); // the redo itself was accepted
    // past top must be the NEWER doc snapshot, not the stale structural entry:
    // undoing now restores doc state and never touches the file.
    await act(async () => { await result.current.undo(); });
    expect(h.doc.getMap('sourceText').has('k')).toBe(false);
    expect(await disk()).toBe(DELETED);
    expect(result.current.canUndo).toBe(false);
  });

  it('interleaved doc → structural → doc entries undo in order; doc entries restore doc state', async () => {
    await boot({ [PAGE]: DELETED });
    const { result } = mount();
    const doc = result.current.doc;
    const setText = (v: string | null) => {
      doc.transact(() => {
        const m = doc.getMap('sourceText');
        if (v === null) { m.delete('k'); return; }
        const e = new Y.Map();
        e.set('textContent', v);
        m.set('k', e);
      }, 'user');
    };
    const readText = () => {
      const e = doc.getMap('sourceText').get('k') as Y.Map<unknown> | undefined;
      return e ? (e.get('textContent') as string) : null;
    };

    act(() => result.current.takeSnapshot()); // captures: no text
    act(() => setText('one'));
    act(() => result.current.pushStructuralUndo(deleteRecord()));
    act(() => result.current.takeSnapshot()); // captures: 'one'
    act(() => setText('two'));

    await act(async () => { await result.current.undo(); }); // doc: back to 'one'
    expect(readText()).toBe('one');
    expect(await disk()).toBe(DELETED);

    await act(async () => { await result.current.undo(); }); // structural: file replay only
    expect(await disk()).toBe(ORIGINAL);
    expect(readText()).toBe('one'); // doc untouched by structural undo

    await act(async () => { await result.current.undo(); }); // doc: back to empty
    expect(readText()).toBe(null);
    expect(result.current.canUndo).toBe(false);

    // redo walks forward in the same order: doc → structural → doc
    await act(async () => { await result.current.redo(); });
    expect(readText()).toBe('one');
    await act(async () => { await result.current.redo(); });
    expect(await disk()).toBe(DELETED); // forward remove replayed
    await act(async () => { await result.current.redo(); });
    expect(readText()).toBe('two');
  });
});

/**
 * task-148: page delete/restore ride the SAME stack, but they mirror into Yjs
 * as well as the filesystem — ⌘Z must bring back the file bytes AND the page
 * row (with the id seeding would produce), ⇧⌘Z must re-delete both.
 */
describe('UndoContext page delete/restore entries (task-148)', () => {
  const ABOUT = 'src/pages/about.astro';
  const CONTENT = '---\n---\n<html><body><main>about</main></body></html>\n';
  const pageRecord = (): StructuralUndoRecord => ({
    structuralOp: {
      forward: [{ kind: 'page-delete', folder: `wc://${projectId}`, pageId: 'about', route: '/about', file: ABOUT }],
      inverse: [{
        kind: 'page-restore', folder: `wc://${projectId}`, pageId: 'about', route: '/about',
        file: ABOUT, content: CONTENT,
      }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _resetStructuralWriteInFlightForTests();
  });
  afterEach(teardown);

  it('⌘Z restores the file bytes AND re-adds the page row; ⇧⌘Z re-deletes both', async () => {
    await boot({ [PAGE]: ORIGINAL });
    const { result } = mount();
    // A sibling page must exist: DELETE_PAGE keeps the last row (and the
    // endpoint refuses the last FILE), so a redo only makes sense with ≥2.
    act(() => {
      applyCommand(result.current.doc, {
        type: 'ADD_PAGE', page: { id: 'index', name: '/', rootElementIds: [], children: [] },
      });
      result.current.pushStructuralUndo(pageRecord());
    });

    await act(async () => { await result.current.undo(); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(await disk(ABOUT)).toBe(CONTENT);
    // the row is back under the id /__sq/local/pages seeding would produce
    expect(result.current.doc.getMap('pages').has('about')).toBe(true);
    expect((result.current.doc.getMap('pages').get('about') as Y.Map<unknown>).get('name')).toBe('/about');
    expect(result.current.canRedo).toBe(true);

    await act(async () => { await result.current.redo(); });
    await flushDurableSourceWrites(projectId);
    expect(() => runtime.read(ABOUT)).toThrow();
    expect(result.current.doc.getMap('pages').has('about')).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('restore failure (the file reappeared) → toast, file + doc untouched, entry stays (87a0781c)', async () => {
    await boot({ [PAGE]: ORIGINAL, [ABOUT]: 'reappeared\n' });
    const { result } = mount();
    act(() => result.current.pushStructuralUndo(pageRecord()));

    await act(async () => { await result.current.undo(); });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Page file already exists'));
    expect(await disk(ABOUT)).toBe('reappeared\n');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.doc.getMap('pages').has('about')).toBe(false);
  });
});
