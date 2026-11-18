// task-133 Task 6: local-mode delete + move/reorder for source-keyed elements
// — real file writes through viteStructuralWriter, no doc dispatch, selection
// cleared on successful delete, pending selection stashed on successful move.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Since the durable structural dispatch (c8535b79 / fdd2d12f) delete + move no
// longer call viteStructuralWriter: each builds ONE source gesture
// (prepareSourceGesture → resolve → apply) and accepts it durably
// (acceptFileChanges). This unit file stubs THAT seam. The op stubs below
// stand in for the gesture's transform, keyed by op kind, so the assertions
// stay "which location was removed / moved, with which root permission".
// Real-runtime coverage of the same path: localStructuralOps.ownerRedo /
// .pruneImports / .scanFence and durableEdits/__tests__/structuralAcceptance.
const ops = vi.hoisted(() => ({ writeRemove: vi.fn(), writeMove: vi.fn() }));
vi.mock('@/services/durableEdits/sourceGesture', () => ({
  prepareSourceGesture: vi.fn(() => ({
    files: new Map(),
    resolve: async (loc: unknown) => loc,
    apply: async (op: { kind: string; loc?: unknown; from?: unknown; to?: unknown; position?: unknown; allowRootRemoval?: boolean }) => {
      if (op.kind === 'remove') return ops.writeRemove(op.loc, op.allowRootRemoval);
      if (op.kind === 'move') return ops.writeMove(op.from, op.to, op.position, op.allowRootRemoval);
      throw new Error(`unexpected structural op ${op.kind}`);
    },
  })),
}));
vi.mock('@/services/durableEdits/fileAcceptance', () => ({
  acceptFileChanges: vi.fn(async (_folder: string, input: unknown) => ({
    files: typeof input === 'function' ? await (input as () => Promise<unknown[]>)() : input,
  })),
  finishAcceptedFiles: vi.fn(async () => ({})),
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import {
  deleteLocalElement,
  moveLocalElement,
  planGutterLocalMove,
  predictedSiblingOrder,
  planLocalReparentInsert,
  layersZoneToStructuralPosition,
  isSourceKeyedElementKey,
  _resetStructuralWriteInFlightForTests,
  tryAcquireStructuralWrite,
} from '../localStructuralOps';
import {
  setLocalExpectedRoute,
  setLocalScannedRoute,
  setLocalPageFile,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import { peekLocalPendingSelection, clearLocalPendingSelection } from '@/utils/localPendingSelection';
// The REPRO block drives THE plugin implementation (single source, parity law).
// eslint-disable-next-line import/no-relative-packages
// @ts-expect-error plain-JS preview-template plugin, no types
import { removeElementAtLocation } from '../../../../../preview-template/src/plugins/sq-source-plugin.js';

const writeRemove = ops.writeRemove;
const writeMove = ops.writeMove;

import { LOCAL_CROSS_FILE_WRITE_EVENT } from '@/utils/localWriteScope';
import { DEFAULT_CARD } from '@/utils/cardFields';
import { _resetCardTitleLocksForTests, setCardSource } from '@/utils/cardTitleLock';

const PAGE = 'src/pages/index.astro';
const KEY = `${PAGE}:8:3`;
const TARGET = `${PAGE}:15:3`;

/** Files whose write was refused as an instance-scope edit of a master. */
let refusals: string[] = [];
const onRefusal = (e: Event) => refusals.push((e as CustomEvent).detail.file);
beforeAll(() => window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal));
afterAll(() => window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal));

beforeEach(() => {
  refusals = [];
  vi.clearAllMocks();
  clearLocalPendingSelection();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  setActiveSaveProjectId('browser_local_structural_ops');
  // Default: the selected element lives in the page being edited (same-file).
  // Cross-file behaviour has its own describe block below.
  setLocalPageFile(PAGE);
  writeRemove.mockResolvedValue({ success: true, removedSource: '<section />', removedLine: 8, removedColumn: 3, file: PAGE });
  // Real move replies carry the target-side splice-region fields too.
  writeMove.mockResolvedValue({
    success: true, insertedLine: 14, removedSource: '  <div>m</div>\n', removedLine: 8, removedColumn: 1, file: PAGE,
    replacedLine: 14, replacedLineCount: 1, originalSegment: '',
  });
});

afterEach(() => setActiveSaveProjectId(null));

describe('isSourceKeyedElementKey', () => {
  it('true for file:line:col keys (with or without #n suffix)', () => {
    expect(isSourceKeyedElementKey(KEY)).toBe(true);
    expect(isSourceKeyedElementKey(`${KEY}#2`)).toBe(true);
  });
  it('false for doc keys (instance root/child, drawn, dynamic)', () => {
    expect(isSourceKeyedElementKey('el-abc123')).toBe(false);
    expect(isSourceKeyedElementKey('el-abc123:h1-0')).toBe(false);
    expect(isSourceKeyedElementKey('drawn-1')).toBe(false);
    expect(isSourceKeyedElementKey('dynamic:section:0@hash')).toBe(false);
  });
});

describe('deleteLocalElement', () => {
  it('a card title (or an element containing it) cannot be deleted: nothing happens — no write, no toast (owner 2026-10-09)', async () => {
    const CARD = 'src/components/WorksCard.astro';
    const lines = DEFAULT_CARD.split('\n');
    const at = (needle: string) => { const i = lines.findIndex((l) => l.includes(needle)); return `${CARD}:${i + 1}:${lines[i].indexOf('<') + 1}`; };
    setLocalPageFile(CARD);
    setCardSource(CARD, DEFAULT_CARD);
    const clearSelection = vi.fn();
    expect(await deleteLocalElement({ key: at('<h3'), clearSelection })).toBe(false);
    expect(await deleteLocalElement({ key: at('<div class="p-4'), clearSelection })).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    // Any other field still deletes.
    writeRemove.mockResolvedValue({ success: true, removedSource: '<p />', removedLine: 1, removedColumn: 1, file: CARD });
    expect(await deleteLocalElement({ key: at('<p class'), clearSelection })).toBe(true);
    _resetCardTitleLocksForTests();
  });

  it('success: writeRemove with the key-derived loc, clears selection, returns true', async () => {
    const clearSelection = vi.fn();
    const ok = await deleteLocalElement({ key: KEY, clearSelection });
    // allowRootRemoval true: the target file IS the page being edited, so
    // emptying it is the user's explicit intent (data-loss guard opt-in).
    expect(writeRemove).toHaveBeenCalledWith({ file: PAGE, line: 8, column: 3 }, true);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('#n-suffixed key: blocked toast, NO write, selection kept', async () => {
    const clearSelection = vi.fn();
    const ok = await deleteLocalElement({ key: `${KEY}#1`, clearSelection });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Loop copies'));
    expect(writeRemove).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('non-source key: toast, no write, false', async () => {
    const ok = await deleteLocalElement({ key: 'el-abc123', clearSelection: vi.fn() });
    expect(toast).toHaveBeenCalled();
    expect(writeRemove).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  // Deleted: 'write {success:false}' and 'write resolving false (writes not
  // armed)'. Both states are retired: the gesture's apply() always returns
  // success:true or throws, and 2143c143 ("drop the dead 'not confirmed'
  // branch") removed the delete-side check. A failing delete is a rejection
  // (next test) or 'Project storage is not ready' (below).

  it('write rejection: toast.error carries the reason, false', async () => {
    writeRemove.mockRejectedValue(new Error('unbalanced span'));
    const ok = await deleteLocalElement({ key: KEY, clearSelection: vi.fn() });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't delete the element/));
    expect(ok).toBe(false);
  });

  it('no active project storage: toast.error, NO write, selection kept, false', async () => {
    setActiveSaveProjectId(null);
    const clearSelection = vi.fn();
    const ok = await deleteLocalElement({ key: KEY, clearSelection });
    expect(toast.error).toHaveBeenCalled();
    expect(writeRemove).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});

describe('moveLocalElement', () => {
  it('success: writeMove(loc, targetLoc, position), pending selection stashed at insertedLine, true', async () => {
    const ok = await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'before' });
    expect(writeMove).toHaveBeenCalledWith(
      { file: PAGE, line: 8, column: 3 },
      { file: PAGE, line: 15, column: 3 },
      'before',
      true,
    );
    // 426889ee: the pending selection also carries the accepting project's
    // identity (generations + accepted source location).
    expect(peekLocalPendingSelection()).toMatchObject({ file: PAGE, predicted: `${PAGE}:14:`, projectId: 'browser_local_structural_ops' });
    expect(ok).toBe(true);
  });

  it('#n-suffixed dragged key: blocked toast, NO write', async () => {
    const ok = await moveLocalElement({ key: `${KEY}#1`, targetKey: TARGET, position: 'before' });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Loop copies'));
    expect(writeMove).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('#n-suffixed target key: blocked toast, NO write', async () => {
    const ok = await moveLocalElement({ key: KEY, targetKey: `${TARGET}#3`, position: 'after' });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Loop copies'));
    expect(writeMove).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('non-source target (drawn/doc key): toast, no write, false', async () => {
    const ok = await moveLocalElement({ key: KEY, targetKey: 'drawn-1', position: 'after' });
    expect(toast).toHaveBeenCalled();
    expect(writeMove).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('key === targetKey: silent no-op, no write, no toast', async () => {
    const ok = await moveLocalElement({ key: KEY, targetKey: KEY, position: 'before' });
    expect(writeMove).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('write {success:false}: toast.error, NO pending selection', async () => {
    writeMove.mockResolvedValue({ success: false, insertedLine: 0, file: PAGE });
    const ok = await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'inside-end' });
    expect(toast.error).toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
    expect(ok).toBe(false);
  });

  it('write rejection (e.g. plugin cycle guard): toast.error with reason, no pending', async () => {
    writeMove.mockRejectedValue(new Error('cannot move into own subtree'));
    const ok = await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'inside-end' });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't move the element/));
    expect(peekLocalPendingSelection()).toBeNull();
    expect(ok).toBe(false);
  });
});

describe('planGutterLocalMove', () => {
  const keys = ['a:1:1', 'b:2:1', 'c:3:1'].map((k) => `src/pages/${k}`);

  it('move down (not to end): before the element that follows the new slot', () => {
    // a moves to index 1 → order [b, a, c] → a sits before c
    expect(planGutterLocalMove(keys, 0, 1)).toEqual({ targetKey: keys[2], position: 'before' });
  });

  it('move to the end: after the previous element', () => {
    expect(planGutterLocalMove(keys, 0, 2)).toEqual({ targetKey: keys[2], position: 'after' });
  });

  it('move up to the front: before the displaced first element', () => {
    expect(planGutterLocalMove(keys, 2, 0)).toEqual({ targetKey: keys[0], position: 'before' });
  });

  it('no neighbor (single element) or same index: null', () => {
    expect(planGutterLocalMove([keys[0]], 0, 0)).toBeNull();
    expect(planGutterLocalMove(keys, 1, 1)).toBeNull();
  });

  // Fix 3 (review of 66987f8b): un-anchorable neighbors (drawn roots, #n loop
  // copies — not in the file / not addressable) are SKIPPED, not handed to
  // moveLocalElement to fail on.
  it('drawn immediate neighbor: skips it and anchors on the next source-keyed sibling', () => {
    const mixed = [keys[0], keys[1], 'drawn-x', keys[2]];
    // keys[0] moves to index 1 → [b, a, drawn-x, c] → anchor before c, not drawn-x
    expect(planGutterLocalMove(mixed, 0, 1)).toEqual({ targetKey: keys[2], position: 'before' });
  });

  it('#n-suffixed immediate neighbor: skipped the same way', () => {
    const mixed = [keys[0], keys[1], `${keys[2]}#1`, keys[2]];
    expect(planGutterLocalMove(mixed, 0, 1)).toEqual({ targetKey: keys[2], position: 'before' });
  });

  it('anchorable neighbor only on the preceding side: anchors after it', () => {
    const mixed = [keys[0], keys[1], 'drawn-x'];
    // keys[0] moves to the end → [b, a?] wait: to index 2 → [b, drawn-x, a] →
    // no following anchor; preceding scan skips drawn-x → after b
    expect(planGutterLocalMove(mixed, 0, 2)).toEqual({ targetKey: keys[1], position: 'after' });
  });

  it('both sides un-anchorable: toast, null', () => {
    const mixed = [keys[0], 'drawn-1', 'drawn-2'];
    expect(planGutterLocalMove(mixed, 0, 2)).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('anchor'));
  });
});

// task-148 (canvas/Layers reparent drop wiring): parent + insertIndex →
// before/after anchor among the new parent's children, or inside-end of the
// parent itself when it has no anchorable children.
describe('planLocalReparentInsert', () => {
  const parent = 'src/pages/index.astro:4:1';
  const kids = ['a:10:3', 'b:14:3', 'c:20:3'].map((k) => `src/pages/${k}`);
  const dragged = 'src/pages/index.astro:30:3';

  it('slot with a following child: before it', () => {
    expect(planLocalReparentInsert(parent, kids, 1, dragged))
      .toEqual({ targetKey: kids[1], position: 'before' });
  });

  it('slot at the end: after the last child', () => {
    expect(planLocalReparentInsert(parent, kids, 3, dragged))
      .toEqual({ targetKey: kids[2], position: 'after' });
  });

  it('empty container: inside-end of the parent itself', () => {
    expect(planLocalReparentInsert(parent, [], 0, dragged))
      .toEqual({ targetKey: parent, position: 'inside-end' });
  });

  it('skips the dragged element when it is already a child of the target parent', () => {
    // dragged sits at the slot — anchor on the NEXT sibling, never on itself
    expect(planLocalReparentInsert(parent, [dragged, kids[0]], 0, dragged))
      .toEqual({ targetKey: kids[0], position: 'before' });
  });

  it('drawn/#n children are skipped; falls through to inside-end of the parent', () => {
    expect(planLocalReparentInsert(parent, ['drawn-1', `${kids[0]}#1`], 1, dragged))
      .toEqual({ targetKey: parent, position: 'inside-end' });
  });

  it('nothing anchorable (drawn parent, drawn children): toast, null', () => {
    expect(planLocalReparentInsert('drawn-parent', ['drawn-1'], 0, dragged)).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('anchor'));
  });

  it('root drop (null parent) with no anchorable sibling: toast, null', () => {
    expect(planLocalReparentInsert(null, [], 0, dragged)).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('anchor'));
  });
});

// Fix 1 (review of 66987f8b): overlapping destructive writes. The module
// enforces its own "one structural write per gesture" header rule — a second
// op issued while one is in flight is refused. Fix 2 (task-148): the refusal
// is no longer INVISIBLE — the refused caller toasts (a fixed toast id
// collapses an auto-repeat / double-fire burst into ONE visible toast).
// Owner 2026-11-10: "there should be no refusals … nothing should be lost" —
// a gesture made while another write is in flight waits its turn.
describe('in-flight write guard', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a second delete while the first is in flight waits its turn, then runs — no toast', async () => {
    let resolveFirst!: (v: unknown) => void;
    writeRemove.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const clearSelection = vi.fn();

    const first = deleteLocalElement({ key: KEY, clearSelection });
    const second = deleteLocalElement({ key: KEY, clearSelection });
    await tick();
    expect(writeRemove).toHaveBeenCalledTimes(1); // the second waits its turn

    resolveFirst({ success: true, removedSource: '<x/>', removedLine: 8, file: PAGE });
    expect(await first).toBe(true);
    await second;
    expect(writeRemove).toHaveBeenCalledTimes(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it('a burst of deletes runs one after another — never a toast', async () => {
    let resolveFirst!: (v: unknown) => void;
    writeRemove.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const burst = [0, 1, 2, 3].map(() => deleteLocalElement({ key: KEY, clearSelection: vi.fn() }));
    await tick();
    expect(writeRemove).toHaveBeenCalledTimes(1);
    resolveFirst({ success: true, removedSource: '<x/>', removedLine: 8, file: PAGE });
    await Promise.all(burst);
    expect(writeRemove).toHaveBeenCalledTimes(4);
    expect(toast).not.toHaveBeenCalled();
  });

  it('a move while a delete is in flight waits its turn, then moves', async () => {
    let resolveDelete!: (v: unknown) => void;
    writeRemove.mockReturnValueOnce(new Promise((r) => { resolveDelete = r; }));

    const del = deleteLocalElement({ key: KEY, clearSelection: vi.fn() });
    const moved = moveLocalElement({ key: KEY, targetKey: TARGET, position: 'before' });
    await tick();
    expect(writeMove).not.toHaveBeenCalled(); // still waiting

    resolveDelete({ success: true, removedSource: '<x/>', removedLine: 8, file: PAGE });
    await del;
    await moved;
    expect(writeMove).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('the guard releases after completion AND after failure', async () => {
    writeRemove.mockRejectedValueOnce(new Error('boom'));
    expect(await deleteLocalElement({ key: KEY, clearSelection: vi.fn() })).toBe(false);
    // failed op released the guard → next op runs
    expect(await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'before' })).toBe(true);
    expect(writeMove).toHaveBeenCalledTimes(1);
  });
});

describe('layersZoneToStructuralPosition', () => {
  it('inside on a container → inside-end; inside on a leaf → after', () => {
    expect(layersZoneToStructuralPosition('inside', { tagName: 'div', children: [] })).toBe('inside-end');
    expect(layersZoneToStructuralPosition('inside', { tagName: 'img', children: [] })).toBe('after');
  });
  it('before/after pass through', () => {
    expect(layersZoneToStructuralPosition('before', undefined)).toBe('before');
    expect(layersZoneToStructuralPosition('after', undefined)).toBe('after');
  });
});

// task-133 Task 8: successful ops push an undo record (forward + inverse ops)
// through the caller-provided pushUndo; failures/refusals never push.
describe('undo records (Task 8)', () => {
  it('delete pushes forward remove + inverse verbatim restore at removedLine:removedColumn', async () => {
    const pushUndo = vi.fn();
    await deleteLocalElement({ key: KEY, clearSelection: vi.fn(), pushUndo });
    expect(pushUndo).toHaveBeenCalledExactlyOnceWith({
      origin: expect.objectContaining({ armed: expect.any(Boolean) }), // its page: ⌘Z replays there
      structuralOp: {
        sourceFiles: [],
        forward: [{ kind: 'remove', loc: { file: PAGE, line: 8, column: 3 }, allowRootRemoval: true }],
        inverse: [{ kind: 'restore', loc: { file: PAGE, line: 8, column: 3 }, text: '<section />' }],
      },
    });
  });

  it('failed delete pushes nothing', async () => {
    writeRemove.mockRejectedValue(new Error('boom'));
    const pushUndo = vi.fn();
    await deleteLocalElement({ key: KEY, clearSelection: vi.fn(), pushUndo });
    expect(pushUndo).not.toHaveBeenCalled();
  });

  it('move pushes forward move + inverse [region restore of the splice, verbatim restore]', async () => {
    const pushUndo = vi.fn();
    await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'after', pushUndo });
    expect(pushUndo).toHaveBeenCalledExactlyOnceWith({
      origin: expect.objectContaining({ armed: expect.any(Boolean) }), // its page: ⌘Z replays there
      structuralOp: {
        sourceFiles: [],
        forward: [{
          kind: 'move',
          from: { file: PAGE, line: 8, column: 3 },
          to: { file: PAGE, line: 15, column: 3 },
          position: 'after',
          allowRootRemoval: true,
        }],
        inverse: [
          { kind: 'restore-region', loc: { file: PAGE, line: 14, column: 1 }, lineCount: 1, segment: '' },
          { kind: 'restore', loc: { file: PAGE, line: 8, column: 1 }, text: '  <div>m</div>\n' },
        ],
      },
    });
  });

  it('failed move pushes nothing', async () => {
    writeMove.mockRejectedValue(new Error('boom'));
    const pushUndo = vi.fn();
    await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'after', pushUndo });
    expect(pushUndo).not.toHaveBeenCalled();
  });

  // LIVE SMOKE (Critical, same class as insert): a move into a single-line
  // target splits that target's line — the inverse region restore carries
  // the original line bytes and rejoins it.
  it('mid-line move target: inverse restore-region carries the split line bytes', async () => {
    writeMove.mockResolvedValue({
      success: true, insertedLine: 16, removedSource: '    <p>First</p>\n', removedLine: 7, removedColumn: 1, file: PAGE,
      replacedLine: 15, replacedLineCount: 3, originalSegment: '  <footer>End</footer>\n',
    });
    const pushUndo = vi.fn();
    await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'inside-end', pushUndo });
    expect(pushUndo.mock.calls[0][0].structuralOp.inverse).toEqual([
      { kind: 'restore-region', loc: { file: PAGE, line: 15, column: 1 }, lineCount: 3, segment: '  <footer>End</footer>\n' },
      { kind: 'restore', loc: { file: PAGE, line: 7, column: 1 }, text: '    <p>First</p>\n' },
    ]);
  });

  it('legacy move reply without region fields: inverse falls back to remove-at-insertedLine', async () => {
    writeMove.mockResolvedValue({
      success: true, insertedLine: 14, removedSource: '  <div>m</div>\n', removedLine: 8, removedColumn: 1, file: PAGE,
    });
    const pushUndo = vi.fn();
    await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'after', pushUndo });
    expect(pushUndo.mock.calls[0][0].structuralOp.inverse[0]).toEqual(
      // allowRootRemoval: the inverse remove undoes OUR OWN splice.
      { kind: 'remove', loc: { file: PAGE, line: 14, column: 1 }, allowRootRemoval: true },
    );
  });
});

// ── Wrong-file-write guard (live-smoke Critical): delete/move never write
// while the page switch is in flight — the scanned KEY they act on belongs to
// the page the user just left (selection is cleared on every switch, so only a
// pick on the outgoing canvas reaches this), so the write would hit the wrong
// real file. Owner 2026-11-10: no "Still switching pages" message either —
// the gesture is simply moot on the page now on screen.
describe('page-switch-in-flight guard', () => {
  // The reset also wipes the surface file; re-arm it so THIS block tests the
  // route gate alone (an unknown surface file is a cross-file refusal now).
  beforeEach(() => { _resetLocalPageSyncForTests(); setLocalPageFile(PAGE); });

  it('delete of an element on the page being left: no writeRemove, no message', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/');
    expect(await deleteLocalElement({ key: KEY, clearSelection: vi.fn() })).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('move of an element on the page being left: no writeMove, no message', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/');
    expect(await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'before' })).toBe(false);
    expect(writeMove).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('in-sync scan → both ops proceed', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/layout-only');
    expect(await deleteLocalElement({ key: KEY, clearSelection: vi.fn() })).toBe(true);
    expect(await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'before' })).toBe(true);
  });

  it('the in-flight guard is NOT consumed by a page-switch refusal', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/');
    await deleteLocalElement({ key: KEY, clearSelection: vi.fn() });
    expect(tryAcquireStructuralWrite()).toBe(true);
  });
});

/**
 * DATA-LOSS guard (real incident 2026-08-02): a page renders its components
 * inline, so the scanned element the user clicks carries the COMPONENT's
 * sourceLocation. Selecting the rendered header on a page and pressing Delete
 * removed the ROOT of src/components/Header.astro — the header vanished from
 * every page, Back.astro went to 0 bytes, and the project had no git.
 *
 * THE LAW (owner, 2026-08-02): "components should only write to file once their
 * master version is changed". From a PAGE view a write may only target the PAGE
 * file. c22e3cc3's first pass only WARNED on a cross-file child edit — still a
 * master rewrite driven by an instance-level gesture, so it is now REFUSED and
 * the refusal offers the component view (where the same edit is same-file).
 */
describe('cross-file structural edits (instance edits never write the master)', () => {
  const COMPONENT = 'src/components/Header.astro';
  const COMPONENT_ROOT_KEY = `${COMPONENT}:4:1`;

  it('cross-file ROOT delete (the incident): refused, NO write, selection kept, no undo', async () => {
    const clearSelection = vi.fn();
    const pushUndo = vi.fn();
    const ok = await deleteLocalElement({ key: COMPONENT_ROOT_KEY, clearSelection, pushUndo });
    expect(ok).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
    expect(refusals).toEqual([COMPONENT]);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
  });

  it('cross-file CHILD delete is refused too — it still rewrites every page', async () => {
    const ok = await deleteLocalElement({ key: `${COMPONENT}:5:3`, clearSelection: vi.fn() });
    expect(ok).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
    expect(refusals).toEqual([COMPONENT]);
  });

  it('same-file delete does NOT refuse (regression pin)', async () => {
    expect(await deleteLocalElement({ key: KEY, clearSelection: vi.fn() })).toBe(true);
    expect(refusals).toEqual([]);
    expect(writeRemove).toHaveBeenCalledWith({ file: PAGE, line: 8, column: 3 }, true);
  });

  it('an UNKNOWN page file is treated as cross-file, never as same-file', async () => {
    setLocalPageFile(null);
    expect(await deleteLocalElement({ key: KEY, clearSelection: vi.fn() })).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
  });

  it('the undo record still carries the root-removal permission for same-file', async () => {
    const pushUndo = vi.fn();
    await deleteLocalElement({ key: KEY, clearSelection: vi.fn(), pushUndo });
    expect(pushUndo.mock.calls[0][0].structuralOp.forward[0]).toMatchObject({
      kind: 'remove', allowRootRemoval: true,
    });
  });

  it('a move ACROSS files is refused with its own copy (the drag makes no sense)', async () => {
    const ok = await moveLocalElement({ key: `${COMPONENT}:5:3`, targetKey: TARGET, position: 'before' });
    expect(ok).toBe(false);
    expect(writeMove).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('different files'));
  });

  it('a move entirely INSIDE a component is refused from a page view', async () => {
    const ok = await moveLocalElement({ key: `${COMPONENT}:5:3`, targetKey: `${COMPONENT}:6:3`, position: 'after' });
    expect(ok).toBe(false);
    expect(writeMove).not.toHaveBeenCalled();
    expect(refusals).toEqual([COMPONENT]);
  });

  /** The component view is the escape hatch — pin it or the law has no exit. */
  describe('component view: the component file IS the surface', () => {
    beforeEach(() => setLocalPageFile(COMPONENT));

    it('deleting the component ROOT there is allowed (master edit)', async () => {
      writeRemove.mockResolvedValue({ success: true, removedSource: '<header/>', removedLine: 4, removedColumn: 1, file: COMPONENT });
      expect(await deleteLocalElement({ key: COMPONENT_ROOT_KEY, clearSelection: vi.fn() })).toBe(true);
      expect(writeRemove).toHaveBeenCalledWith({ file: COMPONENT, line: 4, column: 1 }, true);
      expect(refusals).toEqual([]);
    });

    it('moving inside it is allowed', async () => {
      writeMove.mockResolvedValue({
        success: true, insertedLine: 6, removedSource: '<h1/>', removedLine: 5, removedColumn: 3, file: COMPONENT,
        replacedLine: 6, replacedLineCount: 1, originalSegment: '',
      });
      expect(await moveLocalElement({ key: `${COMPONENT}:5:3`, targetKey: `${COMPONENT}:6:3`, position: 'after' })).toBe(true);
      expect(refusals).toEqual([]);
    });

    it('but a PAGE-file edit from the component view is refused (symmetric)', async () => {
      expect(await deleteLocalElement({ key: KEY, clearSelection: vi.fn() })).toBe(false);
      expect(writeRemove).not.toHaveBeenCalled();
    });
  });
});

/**
 * End-to-end repro of the exact incident, with the REAL plugin transform doing
 * the work behind the gesture seam: Back.astro is a single <a> root; the user is on
 * src/pages/index.astro and deletes the rendered link. The file must survive
 * byte-identical.
 */
describe('REPRO: deleting a rendered component root from a page (real plugin)', () => {
  const BACK_FILE = 'src/components/Back.astro';
  const BACK_SOURCE = '<a href="/" class="back">&larr; Back</a>\n';

  /** The gesture's remove runs THE plugin transform over an in-memory fs. */
  const useFs = (fs: Record<string, string>) => {
    writeRemove.mockImplementation(async (loc: { file: string; line: number; column: number }, allowRootRemoval = false) => {
      const out = removeElementAtLocation(fs[loc.file], loc, { allowRootRemoval });
      fs[loc.file] = out.content;
      return { success: true, file: loc.file, ...out };
    });
  };

  it('refuses and leaves Back.astro byte-identical', async () => {
    const fs: Record<string, string> = { [BACK_FILE]: BACK_SOURCE };
    setLocalPageFile('src/pages/index.astro'); // the page the user is editing
    const clearSelection = vi.fn();
    const pushUndo = vi.fn();

    useFs(fs);
    const ok = await deleteLocalElement({ key: `${BACK_FILE}:1:1`, clearSelection, pushUndo });

    expect(ok).toBe(false);
    expect(fs[BACK_FILE]).toBe(BACK_SOURCE); // NOT 0 bytes
    expect(clearSelection).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
    // Refused CLIENT-side now: the plugin is never even asked.
    expect(refusals).toEqual([BACK_FILE]);
  });

  /**
   * What the owner actually WANTED: remove the component from THIS page. The
   * `<Header />` usage tag lives in the page file, so it is same-file and must
   * keep working — this is the gesture the refusal above steers toward.
   *
   * CAVEAT (task-148): the usage tag is only SELECTABLE when the component
   * spreads `{...Astro.props}` (that is what carries data-sq-source through the
   * compiled output). Without a spread, clicking the rendered header selects
   * the component's inner element instead, which is now refused — correct, but
   * it leaves the user with no way to remove the usage by clicking. Registered
   * as a selection concern, not patched here.
   */
  it('deleting the <Header /> USAGE tag on the page works and never touches the component', async () => {
    const PAGE_FILE = 'src/pages/index.astro';
    const HEADER_FILE = 'src/components/Header.astro';
    const HEADER_SOURCE = '<header><h1>hi</h1></header>\n';
    const fs: Record<string, string> = {
      [PAGE_FILE]: '---\nimport Header from "../components/Header.astro";\n---\n<main>\n  <Header />\n  <p>body</p>\n</main>\n',
      [HEADER_FILE]: HEADER_SOURCE,
    };
    setLocalPageFile(PAGE_FILE);
    useFs(fs);
    const ok = await deleteLocalElement({ key: `${PAGE_FILE}:5:3`, clearSelection: vi.fn() }); // the <Header /> tag itself
    expect(ok).toBe(true);
    expect(fs[PAGE_FILE]).not.toContain('<Header />');
    expect(fs[PAGE_FILE]).toContain('<p>body</p>');
    expect(fs[HEADER_FILE]).toBe(HEADER_SOURCE); // the master is untouched
  });

  it('the same delete on the page that OWNS the element still works', async () => {
    const fs: Record<string, string> = { [BACK_FILE]: BACK_SOURCE };
    setLocalPageFile(BACK_FILE); // component view: the user opened Back.astro itself
    useFs(fs);
    const ok = await deleteLocalElement({ key: `${BACK_FILE}:1:1`, clearSelection: vi.fn() });
    expect(ok).toBe(true);
    expect(fs[BACK_FILE]).toBe('');
  });
});

/**
 * task-148 item 7 — SELECT THE USAGE.
 *
 * The affirmative half of the 2026-08-02 data-loss incident: the write-scope
 * law stopped a delete from gutting a shared component, but left the user's
 * real intent — "remove this card from THIS page" — with no target. The
 * `<Card />` usage tag is that target. Predicate + all enumerated states:
 * `@/utils/localUsageTarget` and
 * ../../../../../docs/archive/plans/2026-08-10-task-148-usage-selection-ledger.md
 */
describe('usage re-target (task-148 item 7)', () => {
  const CARD_FILE = 'src/components/Card.astro';
  const CARD_ROOT = `${CARD_FILE}:4:1~s4db83f82b016cfb0`;
  const CARD_INNER = `${CARD_FILE}:5:3~s4db83f82b016cfb0`;
  /** Where `<Card title="First card">` actually is in the fixture's page. */
  const USAGE = { file: PAGE, line: 21, column: 5 };

  /** The fixture's real shape: <body>(page) > <article>(Card) > <h3>(Card). */
  const scannedByKey = new Map([
    [`${PAGE}:10:3`, { parentKey: null, sourceLocation: { file: PAGE, line: 10, column: 3 } }],
    [CARD_ROOT, {
      parentKey: `${PAGE}:10:3`,
      sourceLocation: { file: CARD_FILE, line: 4, column: 1 },
      usageLocation: USAGE,
    }],
    [CARD_INNER, {
      parentKey: CARD_ROOT,
      sourceLocation: { file: CARD_FILE, line: 5, column: 3 },
      usageLocation: USAGE,
    }],
  ]);

  it('deletes the <Card /> TAG in the page, never the component file', async () => {
    const clearSelection = vi.fn();
    const ok = await deleteLocalElement({ key: CARD_ROOT, clearSelection, scannedByKey });

    expect(ok).toBe(true);
    // The whole point: the write goes to the PAGE, at the invocation tag.
    expect(writeRemove).toHaveBeenCalledWith(USAGE, true);
    // …and never to Card.astro, which is what gutted Header.astro/Back.astro.
    expect(writeRemove.mock.calls[0][0].file).not.toBe(CARD_FILE);
    expect(refusals).toEqual([]);
    expect(clearSelection).toHaveBeenCalled();
  });

  it('records the retargeted location in undo, so ⌘Z restores the page file', async () => {
    const pushUndo = vi.fn();
    await deleteLocalElement({ key: CARD_ROOT, clearSelection: vi.fn(), pushUndo, scannedByKey });

    const op = pushUndo.mock.calls[0][0].structuralOp;
    expect(op.forward[0]).toEqual({ kind: 'remove', loc: USAGE, allowRootRemoval: true });
    expect(op.inverse[0].loc.file).toBe(PAGE);
  });

  it('still REFUSES an inner element of the component (the guard is untouched)', async () => {
    const ok = await deleteLocalElement({ key: CARD_INNER, clearSelection: vi.fn(), scannedByKey });

    expect(ok).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
    expect(refusals).toEqual([CARD_FILE]);
  });

  it('without a scan tree, behaves exactly as before — refused', async () => {
    const ok = await deleteLocalElement({ key: CARD_ROOT, clearSelection: vi.fn() });

    expect(ok).toBe(false);
    expect(writeRemove).not.toHaveBeenCalled();
    expect(refusals).toEqual([CARD_FILE]);
  });

  it('moves the <Card /> TAG next to a page sibling (both ends resolved)', async () => {
    const ok = await moveLocalElement({
      key: CARD_ROOT, targetKey: TARGET, position: 'before', scannedByKey,
    });

    expect(ok).toBe(true);
    expect(writeMove).toHaveBeenCalledWith(
      USAGE,
      { file: PAGE, line: 15, column: 3 },
      'before',
      true,
    );
  });

  it('drops a page element INTO the card — the anchor retargets to the tag', async () => {
    const ok = await moveLocalElement({
      key: KEY, targetKey: CARD_ROOT, position: 'inside-end', scannedByKey,
    });

    expect(ok).toBe(true);
    // Slot content authored between <Card>…</Card> is the PAGE's own markup.
    expect(writeMove).toHaveBeenCalledWith(
      { file: PAGE, line: 8, column: 3 },
      USAGE,
      'inside-end',
      true,
    );
  });

  it('refuses a move whose two ends collapse onto the SAME usage tag', async () => {
    // Any two elements rendered by one invocation retarget to one tag; moving
    // that tag relative to itself is a no-op the plugin would read as an
    // own-subtree splice.
    const ok = await moveLocalElement({
      key: CARD_ROOT, targetKey: CARD_INNER, position: 'after', scannedByKey,
    });

    expect(ok).toBe(false);
    expect(writeMove).not.toHaveBeenCalled();
  });
});

// Predicted paint (filmstrip 2026-11-08): an ACCEPTED local delete/move paints
// the canvas at once (the write's refresh lands 150–400 ms later as a check);
// a refused gesture paints nothing.
describe('predicted paint after acceptance', () => {
  const MID = `${PAGE}:12:3`;
  const scanned = new Map([KEY, MID, TARGET].map((k) => [k, { parentKey: `${PAGE}:5:1` }]));
  let posted: Array<{ type: string; payload: unknown }>;
  const spy = () => vi.spyOn(window, 'postMessage').mockImplementation((m: unknown) => { posted.push(m as { type: string; payload: unknown }); });
  beforeEach(() => { posted = []; });

  it('delete removes the element from the canvas with the selection', async () => {
    const s = spy();
    const clearSelection = vi.fn();
    expect(await deleteLocalElement({ key: KEY, clearSelection })).toBe(true);
    expect(posted).toContainEqual({ type: 'SYNC_REMOVE_ELEMENT_FROM_DOM', payload: { key: KEY } });
    expect(clearSelection).toHaveBeenCalledTimes(1);
    s.mockRestore();
  });

  it('a refused delete paints nothing', async () => {
    const s = spy();
    expect(await deleteLocalElement({ key: `${KEY}#1`, clearSelection: vi.fn() })).toBe(false);
    expect(posted.filter((m) => m.type === 'SYNC_REMOVE_ELEMENT_FROM_DOM')).toEqual([]);
    s.mockRestore();
  });

  it('a same-parent move reorders the canvas now; a reparent waits for the refresh', async () => {
    const s = spy();
    expect(await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'after', scannedByKey: scanned })).toBe(true);
    expect(posted).toContainEqual({ type: 'REORDER_ELEMENTS_IN_IFRAME', payload: { elementIds: [MID, TARGET, KEY] } });
    posted = [];
    expect(await moveLocalElement({ key: KEY, targetKey: TARGET, position: 'inside-end', scannedByKey: scanned })).toBe(true);
    expect(posted.filter((m) => m.type === 'REORDER_ELEMENTS_IN_IFRAME')).toEqual([]);
    s.mockRestore();
  });

  it('predictedSiblingOrder: before/after within one parent, else null', () => {
    expect(predictedSiblingOrder(TARGET, KEY, 'before', scanned)).toEqual([TARGET, KEY, MID]);
    expect(predictedSiblingOrder(KEY, MID, 'after', scanned)).toEqual([MID, KEY, TARGET]);
    const other = new Map(scanned); other.set(TARGET, { parentKey: 'elsewhere' });
    expect(predictedSiblingOrder(KEY, TARGET, 'after', other)).toBeNull();
    expect(predictedSiblingOrder(KEY, TARGET, 'inside-end', scanned)).toBeNull();
    expect(predictedSiblingOrder(KEY, TARGET, 'after', undefined)).toBeNull();
  });
});
