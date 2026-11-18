import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { handleWheel, handleDragElementExitIframe, handleDragElementDrop, handleDragModeChanged, buildGridPlacementTokens } from '../dragAndDrop';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});
// task-148: canvas drags of source-keyed elements in local mode route to the
// REAL structural writer path. The routing planners (planGutterLocalMove /
// planLocalReparentInsert) and isSourceKeyedElementKey stay REAL; only the
// write op itself is mocked (useLayersDrag.local.test.tsx pattern).
const { mockMoveLocalElement } = vi.hoisted(() => ({
  mockMoveLocalElement: vi.fn(async () => true),
}));
vi.mock('@/components/Editor/localStructuralOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Editor/localStructuralOps')>()),
  moveLocalElement: mockMoveLocalElement,
}));
// fdd2d12f: every doc-backed drop now commits as ONE durable gesture through
// acceptEditorCommands(doc, actions, claimSnapshot(), sourceCommands) instead
// of ctx.actions.dispatch. The seam is mocked; the durable acceptance itself is
// covered by the store/durableEdits suites.
const { mockAccept } = vi.hoisted(() => ({
  mockAccept: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('@/store/commandGesture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/commandGesture')>()),
  acceptEditorCommands: mockAccept,
}));
/** Every command accepted by the drop (flattened across gestures). */
const accepted = () => mockAccept.mock.calls.flatMap((c) => c[1] as Array<{ type: string; key?: string; gridColumn?: string }>);
const acceptedTypes = () => accepted().map((a) => a.type);
/** Source (file) commands riding the gesture — the 4th accept argument. */
const acceptedSourceCommands = () => mockAccept.mock.calls.flatMap((c) => (c[3] ?? []) as unknown[]);
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import toast from 'react-hot-toast';
import { deduplicateKeysToIds, isRootLevelElement, keyToElementId } from '../elementIds';
import { setSelectedCellGeometry, getSelectedCellGeometrySnapshot } from '@/store/gridGeometryStore';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';

const staleCell = { key: 'drawn-1', breakpoint: 'base', start: 1, span: 2, rowStart: 1, rowSpan: 1, parentCols: 12, parentRows: 1 };

describe('elementIds helpers', () => {
  it('keyToElementId maps instance keys to instanceId, passes others through', () => {
    expect(keyToElementId('el-1:h1-0')).toBe('el-1');
    expect(keyToElementId('src/pages/index.astro:5:1')).toBe('src/pages/index.astro:5:1');
  });

  it('deduplicateKeysToIds keeps first occurrence per instanceId', () => {
    expect(deduplicateKeysToIds(['el-1:h1-0', 'el-1:p-0', 'drawn-x'])).toEqual(['el-1', 'drawn-x']);
  });

  it('isRootLevelElement is true for null parent', () => {
    expect(isRootLevelElement({ parentKey: null })).toBe(true);
    expect(isRootLevelElement({ parentKey: 'el-1' })).toBe(false);
  });

  // Producer-level wrapper guard (2026-07-24): the #sq-components wrapper also
  // scans with parentKey null — counting it as root-level is how its key
  // leaked into the rootElementIds seed (REORDER_PAGE_ELEMENTS filters too,
  // but the producer must not offer it in the first place).
  it('isRootLevelElement is false for the wrapper itself, true for its children', () => {
    const WRAPPER = 'src/pages/preview/[projectId]/[pageId].astro:18:29';
    expect(isRootLevelElement({ key: WRAPPER, parentKey: null })).toBe(false);
    expect(isRootLevelElement({ key: 'el-1:section-0', parentKey: WRAPPER })).toBe(true);
  });
});

describe('buildGridPlacementTokens', () => {
  it('builds start tokens and omits span-1', () => {
    expect(buildGridPlacementTokens('', 1, 2, 1, 1)).toEqual({
      gridColumn: 'col-start-2', gridRow: 'row-start-3',
    });
    expect(buildGridPlacementTokens('md:', 0, 0, 2, 3)).toEqual({
      gridColumn: 'md:col-start-1 md:col-span-2', gridRow: 'md:row-start-1 md:row-span-3',
    });
  });
});

describe('WHEEL', () => {
  it('zooms with ctrl/meta, pans otherwise, scaled to viewport', () => {
    const onZoom = vi.fn();
    const onPan = vi.fn();
    const { iframe } = makeFakeIframe();
    (iframe.current as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect =
      () => ({ left: 10, top: 20, width: 0, height: 0 });
    const ctx = makeFakeCtx({
      refs: { iframe, onZoom: { current: onZoom }, onPan: { current: onPan }, scaleProps: { current: 2 } },
    });
    handleWheel(ctx, { clientX: 5, clientY: 5, deltaX: 1, deltaY: 3, ctrlKey: true, metaKey: false });
    expect(onZoom).toHaveBeenCalledWith(20, 30, 3);
    handleWheel(ctx, { clientX: 5, clientY: 5, deltaX: 1, deltaY: 3, ctrlKey: false, metaKey: false });
    expect(onPan).toHaveBeenCalledWith(1, 3);
  });
});

describe('DRAG_ELEMENT_EXIT_IFRAME', () => {
  it('sets the reparent drag key', () => {
    const ctx = makeFakeCtx();
    handleDragElementExitIframe(ctx, { key: 'k1' });
    expect(ctx.actions.setReparentDragKey).toHaveBeenCalledWith('k1');
  });
});

describe('DRAG_MODE_CHANGED', () => {
  it('reparent mode sets the ref and hides the grid overlay', () => {
    const ctx = makeFakeCtx();
    handleDragModeChanged(ctx, { mode: 'reparent' });
    expect(ctx.refs.dragMode.current).toBe('reparent');
    expect(ctx.actions.setIsGridOverlayVisible).toHaveBeenCalledWith(false);
  });

  it('grid mode sets the ref and shows the grid overlay', () => {
    const ctx = makeFakeCtx();
    handleDragModeChanged(ctx, { mode: 'grid' });
    expect(ctx.refs.dragMode.current).toBe('grid');
    expect(ctx.actions.setIsGridOverlayVisible).toHaveBeenCalledWith(true);
  });
});

describe('DRAG_ELEMENT_DROP', () => {
  beforeEach(() => { mockAccept.mockClear(); });

  it('cancelled drop only clears drag state', () => {
    const ctx = makeFakeCtx();
    handleDragElementDrop(ctx, { cancelled: true, key: 'k1' });
    expect(ctx.actions.setReparentDragKey).toHaveBeenCalledWith(null);
    expect(ctx.actions.setIsGridOverlayVisible).toHaveBeenCalledWith(false);
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it('unknown dragged element is a no-op after state clear', () => {
    const ctx = makeFakeCtx({ refs: { currentPageId: { current: 'page-1' } } });
    handleDragElementDrop(ctx, { cancelled: false, key: 'missing', insertIndex: 0 });
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
    expect(ctx.actions.takeSnapshot).not.toHaveBeenCalled();
  });

  it('reparent drop accepts REPARENT_ELEMENT, skips next render, syncs DOM', async () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({
      refs: { iframe, currentPageId: { current: 'page-1' }, scannedElements: { current: [] as never } },
    });
    setSelectedCellGeometry(staleCell); // must be cleared in lockstep with setGridGeometry(null)
    await handleDragElementDrop(ctx, {
      cancelled: false, reparented: true, key: 'drawn-1', newParentKey: 'el-2', insertIndex: 1,
    });
    expect(ctx.actions.takeSnapshot).toHaveBeenCalled();
    expect(getSelectedCellGeometrySnapshot()).toBeNull();
    expect(accepted()).toContainEqual({
      type: 'REPARENT_ELEMENT', pageId: 'page-1', elementKey: 'drawn-1',
      newParentKey: 'el-2', insertIndex: 1,
    });
    expect(mockAccept.mock.calls[0][0]).toBe(ctx.env.doc);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REPARENT_ELEMENT_DOM' }), '*',
    );
    expect(ctx.actions.setGridGeometry).toHaveBeenCalledWith(null);
  });

  it('flow reorder posts REORDER_ELEMENTS_IN_IFRAME and persists root order', async () => {
    const scanned = [
      { key: 'el-1:div-0', parentKey: null },
      { key: 'el-2:div-0', parentKey: null },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
    });
    const winSpy = vi.spyOn(window, 'postMessage');
    setSelectedCellGeometry({ ...staleCell, key: 'el-1:div-0' });
    await handleDragElementDrop(ctx, { cancelled: false, key: 'el-1:div-0', insertIndex: 1 });
    expect(ctx.actions.takeSnapshot).toHaveBeenCalled();
    expect(getSelectedCellGeometrySnapshot()).toBeNull(); // flow reorder reflows the grid — stale cell must go
    expect(winSpy).toHaveBeenCalledWith(
      { type: 'REORDER_ELEMENTS_IN_IFRAME', payload: { elementIds: ['el-2:div-0', 'el-1:div-0'] } }, '*',
    );
    expect(accepted()).toContainEqual({
      type: 'REORDER_PAGE_ELEMENTS', pageId: 'page-1', elementIds: ['el-2', 'el-1'],
    });
    winSpy.mockRestore();
  });

  it('child-level flow reorder takes the snapshot BEFORE any Yjs mutation (drawn box drag undo hygiene)', async () => {
    // Repro: dragging a drawn box nested in a div used to dispatch a
    // "persist current order" SET_CHILD_ORDER BEFORE takeSnapshot(), tripping
    // the [undo] user-mutation-without-takeSnapshot detector and folding the
    // move into the PREVIOUS undo step. The snapshot captures childOrders
    // directly, so that pre-persist is redundant — takeSnapshot must come first.
    const scanned = [
      { key: 'drawn-a', parentKey: 'drawn-div' },
      { key: 'drawn-b', parentKey: 'drawn-div' },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
    });
    const winSpy = vi.spyOn(window, 'postMessage');
    await handleDragElementDrop(ctx, { cancelled: false, key: 'drawn-a', insertIndex: 1 });
    winSpy.mockRestore();

    const takeSnapshot = ctx.actions.takeSnapshot as ReturnType<typeof vi.fn>;

    // Exactly ONE SET_CHILD_ORDER — the reorder. No redundant pre-persist.
    expect(acceptedTypes().filter(t => t === 'SET_CHILD_ORDER').length).toBe(1);
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();

    // takeSnapshot fired before the (single) accepted mutation gesture.
    expect(takeSnapshot).toHaveBeenCalled();
    expect(mockAccept).toHaveBeenCalledTimes(1);
    const firstMutationOrder = mockAccept.mock.invocationCallOrder[0];
    const snapshotOrder = takeSnapshot.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(firstMutationOrder);
  });

  it('grid drop places element at highlighted cell and persists classes', async () => {
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [0, 0, 0],
      rows: [0, 0, 0],
      cells: [
        { key: 'el-1:div-0', row: 0, col: 0, colSpan: 1, rowSpan: 1 },
        { key: 'el-2:div-0', row: 1, col: 1, colSpan: 1, rowSpan: 1 },
      ],
    };
    const scanned = [
      { key: 'el-1:div-0', parentKey: 'grid-parent' },
      { key: 'el-2:div-0', parentKey: 'grid-parent' },
    ];
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: scanned as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: { col: 1, row: 1 } },
      },
    });
    await handleDragElementDrop(ctx, { cancelled: false, key: 'el-1:div-0', insertIndex: 0 });
    // Both placements (dragged + swapped occupant) persist as ONE accepted
    // gesture (fdd2d12f: the durable acceptance owns the class persist that
    // ctx.actions.persistGridClasses used to do).
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(accepted()).toContainEqual(
      expect.objectContaining({ type: 'GRID_PLACE_ELEMENT', key: 'el-1:div-0' }),
    );
    // occupant swap
    expect(accepted()).toContainEqual(
      expect.objectContaining({ type: 'GRID_PLACE_ELEMENT', key: 'el-2:div-0' }),
    );
    expect(ctx.actions.syncClassToIframe).toHaveBeenCalledWith('el-1:div-0');
    expect(ctx.actions.syncClassToIframe).toHaveBeenCalledWith('el-2:div-0');
    expect(ctx.actions.refreshGridState).toHaveBeenCalledWith('el-1:div-0');
    expect(ctx.actions.setHighlightedGridCell).toHaveBeenCalledWith(null);
  });

  it('grid drop preserves the dragged element span (BUG-A: reorder never resets span to 1)', async () => {
    // task-090: dragAndDrop.ts reads draggedCell.colSpan and feeds it through
    // buildGridPlacementTokens — a reposition must keep the span, never reset it.
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 12-col grid
      rows: [0],
      cells: [
        { key: 'el-1:div-0', row: 0, col: 0, colSpan: 6, rowSpan: 1 },
      ],
    };
    const scanned = [{ key: 'el-1:div-0', parentKey: 'grid-parent' }];
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: scanned as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: { col: 6, row: 0 } },
      },
    });
    await handleDragElementDrop(ctx, { cancelled: false, key: 'el-1:div-0', insertIndex: 0 });
    const placeCall = accepted().find((c) => c.type === 'GRID_PLACE_ELEMENT' && c.key === 'el-1:div-0');
    expect(placeCall).toBeTruthy();
    expect(placeCall!.gridColumn).toContain('col-span-6');
  });

  it('grid drop never dispatches SET_CHILD_ORDER (grid placement is not a reorder)', async () => {
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      rows: [0],
      cells: [
        { key: 'el-a:div-0', row: 0, col: 0, colSpan: 6, rowSpan: 1 },
        { key: 'el-a:div-3', row: 0, col: 6, colSpan: 6, rowSpan: 1 },
      ],
    };
    const scanned = [
      { key: 'el-a:div-0', parentKey: 'el-a:section-0' },
      { key: 'el-a:div-3', parentKey: 'el-a:section-0' },
    ];
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: scanned as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: { col: 6, row: 0 } },
        breakpoint: { current: 'lg' },
      },
    });
    await handleDragElementDrop(ctx, {
      key: 'el-a:div-3', newParentKey: 'el-a:section-0', insertIndex: 1, cancelled: false, reparented: false,
    });
    const types = acceptedTypes();
    expect(types).toContain('GRID_PLACE_ELEMENT');
    expect(types).not.toContain('SET_CHILD_ORDER');
  });

  function makeSpanGridCtx(highlightedCell: { col: number; row: number }) {
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      rows: [0],
      cells: [
        { key: 'el-a:div-0', row: 0, col: 0, colSpan: 6, rowSpan: 1 },
        { key: 'el-a:div-3', row: 0, col: 6, colSpan: 6, rowSpan: 1 },
      ],
    };
    const scanned = [
      { key: 'el-a:div-0', parentKey: 'el-a:section-0' },
      { key: 'el-a:div-3', parentKey: 'el-a:section-0' },
    ];
    return makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: scanned as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: highlightedCell },
        breakpoint: { current: 'lg' },
      },
    });
  }

  it('grid drop clamps placement so the span fits the track count', async () => {
    const ctx = makeSpanGridCtx({ col: 8, row: 0 }); // span 6 from col 8 would overflow 12 cols
    await handleDragElementDrop(ctx, {
      key: 'el-a:div-0', newParentKey: 'el-a:section-0', insertIndex: 1, cancelled: false, reparented: false,
    });
    expect(accepted()).toContainEqual(
      expect.objectContaining({
        type: 'GRID_PLACE_ELEMENT', key: 'el-a:div-0',
        gridColumn: 'lg:col-start-7 lg:col-span-6', // clamped 8 → 6 (col index 6 → col-start-7)
      }),
    );
  });

  it('a drop finished in reparent mode never grid-places', async () => {
    const ctx = makeSpanGridCtx({ col: 8, row: 0 });
    ctx.refs.dragMode.current = 'reparent';
    await handleDragElementDrop(ctx, {
      key: 'el-a:div-0', newParentKey: 'el-a:section-0', insertIndex: 1, cancelled: false, reparented: false,
    });
    expect(acceptedTypes()).not.toContain('GRID_PLACE_ELEMENT');
    expect(acceptedTypes()).toContain('SET_CHILD_ORDER'); // fell through to the flow reorder
  });

  it('grid drop swaps the span-overlapped occupant even when the drop cell is not its top-left track', async () => {
    const ctx = makeSpanGridCtx({ col: 8, row: 0 }); // clamps to col 6 — overlaps sibling at col 6-11
    await handleDragElementDrop(ctx, {
      key: 'el-a:div-0', newParentKey: 'el-a:section-0', insertIndex: 1, cancelled: false, reparented: false,
    });
    // sibling moves to the dragged element's ORIGINAL cell (col 0)
    expect(accepted()).toContainEqual(
      expect.objectContaining({
        type: 'GRID_PLACE_ELEMENT', key: 'el-a:div-3',
        gridColumn: 'lg:col-start-1 lg:col-span-6',
      }),
    );
  });

  // Live 2026-11-12: a 2-wide card dropped on a 3-wide one in a 6-column list
  // sent the 3-wide card to columns 5-7 — a 7th column, every card shrank.
  it('grid drop: a wider card than the freed cell goes back to auto-flow, a pinned one loses its pin', async () => {
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [0, 0, 0, 0, 0, 0],
      rows: [0, 0],
      cells: [
        { key: 'el-a:div-0', row: 0, col: 4, colSpan: 2, rowSpan: 1 },
        { key: 'el-a:div-1', row: 1, col: 0, colSpan: 3, rowSpan: 1 },
        { key: 'el-a:div-2', row: 1, col: 3, colSpan: 3, rowSpan: 1 },
      ],
    };
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: geo.cells.map(c => ({ key: c.key, parentKey: 'el-a:section-0' })) as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: { col: 1, row: 1 } },
        breakpoint: { current: 'lg' },
      },
    });
    // div-1 is pinned (an earlier drag); div-2 is already auto-placed.
    (ctx.actions.getClassesFromYjs as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'el-a:div-1' ? 'p-6 lg:col-start-1 lg:col-span-3 lg:row-start-2' : 'p-6 lg:col-span-3');
    await handleDragElementDrop(ctx, {
      key: 'el-a:div-0', newParentKey: 'el-a:section-0', insertIndex: 0, cancelled: false, reparented: false,
    });
    const placed = accepted().filter(a => a.type === 'GRID_PLACE_ELEMENT');
    expect(placed.map(a => a.key)).toEqual(['el-a:div-0', 'el-a:div-1']); // div-2 (auto, barely covered) is left alone
    expect(placed[1].gridColumn).toBe('lg:col-span-3'); // no start: the grid places it, inside its 6 columns
  });

  // Live 2026-11-12: on a phone canvas a responsive list is one column. A drop
  // there pinned col-start-1 row-start-3 on the base layer and stranded the
  // card on its own row at every wider breakpoint. One column = a stack.
  it('a drop in a one-column grid is a reorder, never a placement', async () => {
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [311],
      rows: [100, 100, 100],
      cells: [
        { key: 'el-a:div-0', row: 0, col: 0, colSpan: 1, rowSpan: 1 },
        { key: 'el-a:div-1', row: 1, col: 0, colSpan: 1, rowSpan: 1 },
        { key: 'el-a:div-2', row: 2, col: 0, colSpan: 1, rowSpan: 1 },
      ],
    };
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: geo.cells.map(c => ({ key: c.key, parentKey: 'el-a:section-0' })) as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: { col: 0, row: 2 } },
      },
    });
    handleDragModeChanged(ctx, { mode: 'flow' }); // the bridge's announcement for a one-column grid
    await handleDragElementDrop(ctx, {
      key: 'el-a:div-0', newParentKey: 'el-a:section-0', insertIndex: 2, cancelled: false, reparented: false,
    });
    expect(acceptedTypes()).not.toContain('GRID_PLACE_ELEMENT');
    expect(acceptedTypes()).toContain('SET_CHILD_ORDER');
  });
});

// task-148 (was task-133 Task 6 v0 refusal): local runtime (files-truth) —
// source-keyed elements have no doc nodes, so canvas flow-drag reorder and
// reparent drops route to the SAME structural writeMove the Layers panel and
// gutter handles use (moveLocalElement), never to doc dispatches.
describe('DRAG_ELEMENT_DROP — local runtime structural wiring (task-148)', () => {
  const SRC1 = 'src/pages/index.astro:8:3';
  const SRC2 = 'src/pages/index.astro:15:3';
  const SRC3 = 'src/pages/index.astro:22:3';

  const localDoc = () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('projectId', 'browser_lf_abc');
    return doc;
  };

  it('flow reorder of a source-keyed element: moveLocalElement with the anchored slot, NO doc dispatch/snapshot', async () => {
    vi.clearAllMocks();
    const scanned = [
      { key: SRC1, parentKey: null },
      { key: SRC2, parentKey: null },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
      env: { doc: localDoc() },
    });
    const winSpy = vi.spyOn(window, 'postMessage');
    handleDragElementDrop(ctx, { cancelled: false, key: SRC1, insertIndex: 1 });
    await Promise.resolve();
    // moving SRC1 to the end → after SRC2 (planGutterLocalMove, real)
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: SRC1, targetKey: SRC2, position: 'after' }),
    );
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
    expect(ctx.actions.takeSnapshot).not.toHaveBeenCalled();
    // successful write → DOM keeps the dragged order (HMR reload re-renders); no snap-back
    expect(winSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REORDER_ELEMENTS_IN_IFRAME' }), '*',
    );
    winSpy.mockRestore();
  });

  it('failed/refused flow-reorder write: DOM snapped back to the original sibling order', async () => {
    vi.clearAllMocks();
    mockMoveLocalElement.mockResolvedValueOnce(false);
    const scanned = [
      { key: SRC1, parentKey: null },
      { key: SRC2, parentKey: null },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
      env: { doc: localDoc() },
    });
    const winSpy = vi.spyOn(window, 'postMessage');
    handleDragElementDrop(ctx, { cancelled: false, key: SRC1, insertIndex: 1 });
    await Promise.resolve();
    expect(winSpy).toHaveBeenCalledWith(
      { type: 'REORDER_ELEMENTS_IN_IFRAME', payload: { elementIds: [SRC1, SRC2] } }, '*',
    );
    winSpy.mockRestore();
  });

  it('flow reorder with no anchorable sibling: toast + snap-back, no write', () => {
    vi.clearAllMocks();
    const scanned = [
      { key: SRC1, parentKey: null },
      { key: 'drawn-a', parentKey: null },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
      env: { doc: localDoc() },
    });
    const winSpy = vi.spyOn(window, 'postMessage');
    handleDragElementDrop(ctx, { cancelled: false, key: SRC1, insertIndex: 1 });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('anchor'));
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
    expect(winSpy).toHaveBeenCalledWith(
      { type: 'REORDER_ELEMENTS_IN_IFRAME', payload: { elementIds: [SRC1, 'drawn-a'] } }, '*',
    );
    winSpy.mockRestore();
  });

  it('reparent drop into an empty container: moveLocalElement inside-end, NO doc dispatch, no DOM sync', () => {
    vi.clearAllMocks();
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({
      refs: {
        iframe,
        currentPageId: { current: 'page-1' },
        scannedElements: { current: [{ key: SRC1, parentKey: null }, { key: SRC2, parentKey: null }] as never },
      },
      env: { doc: localDoc() },
    });
    handleDragElementDrop(ctx, {
      cancelled: false, reparented: true, key: SRC1, newParentKey: SRC2, insertIndex: 0,
    });
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: SRC1, targetKey: SRC2, position: 'inside-end' }),
    );
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
    expect(ctx.actions.takeSnapshot).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REPARENT_ELEMENT_DOM' }), '*',
    );
  });

  it('reparent drop before an existing child: anchors before it', () => {
    vi.clearAllMocks();
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: {
          current: [
            { key: SRC1, parentKey: null },
            { key: SRC2, parentKey: null },
            { key: SRC3, parentKey: SRC2 },
          ] as never,
        },
      },
      env: { doc: localDoc() },
    });
    handleDragElementDrop(ctx, {
      cancelled: false, reparented: true, key: SRC1, newParentKey: SRC2, insertIndex: 0,
    });
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: SRC1, targetKey: SRC3, position: 'before' }),
    );
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  it('doc-backed drawn elements in local mode keep the doc flow-reorder path', async () => {
    vi.clearAllMocks();
    const scanned = [
      { key: 'drawn-a', parentKey: 'drawn-div' },
      { key: 'drawn-b', parentKey: 'drawn-div' },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
      env: { doc: localDoc() },
    });
    const winSpy = vi.spyOn(window, 'postMessage');
    await handleDragElementDrop(ctx, { cancelled: false, key: 'drawn-a', insertIndex: 1 });
    winSpy.mockRestore();
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
    expect(accepted()).toContainEqual(
      expect.objectContaining({ type: 'SET_CHILD_ORDER' }),
    );
  });

  it('grid drop of a source-keyed element in local mode is NOT blocked (class-based, valid)', async () => {
    vi.clearAllMocks();
    const geo = {
      containerRect: { left: 0, top: 0 },
      columns: [0, 0, 0],
      rows: [0, 0, 0],
      cells: [{ key: SRC1, row: 0, col: 0, colSpan: 1, rowSpan: 1 }],
    };
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: [{ key: SRC1, parentKey: 'grid-parent' }] as never },
        gridGeometry: { current: geo as never },
        highlightedGridCell: { current: { col: 1, row: 1 } },
      },
      env: { doc: localDoc() },
    });
    await handleDragElementDrop(ctx, { cancelled: false, key: SRC1, insertIndex: 0 });
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
    expect(accepted()).toContainEqual(
      expect.objectContaining({ type: 'GRID_PLACE_ELEMENT', key: SRC1 }),
    );
  });
});


describe('DRAG_ELEMENT_DROP — order persistence (canvas parity with Layers)', () => {
  function docWith(elements: Record<string, Record<string, unknown>>, rootIds?: string[]): Y.Doc {
    const doc = new Y.Doc();
    const els = doc.getMap('elements');
    for (const [id, fields] of Object.entries(elements)) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      els.set(id, m);
    }
    if (rootIds) {
      const page = new Y.Map<unknown>();
      const arr = new Y.Array<string>();
      arr.insert(0, rootIds);
      page.set('rootElementIds', arr);
      doc.getMap('pages').set(COMPONENT_EDITOR_PAGE_ID, page);
    }
    return doc;
  }

  // Canvas reorders must persist master/chrome order to the file (2026-08-27:
  // the owner's drags were ALL canvas drags and never wrote anything). Since
  // fdd2d12f the file write rides the SAME accepted gesture as the doc reorder
  // (collectOrderCommands → source-batch sourceCommands, the 4th accept arg);
  // the collectors run real, only the acceptance seam is mocked.
  beforeEach(() => { mockAccept.mockClear(); });

  it('master-editor canvas reorder queues the layout order write (was doc-only, reset on reopen)', async () => {
    const doc = docWith({
      'el-1': { astroSource: 'layouts/Layout1.astro' },
      'el-2': { astroSource: 'library/Header.astro' },
    }, ['el-1', 'el-2']);
    const scanned = [
      { key: 'el-1:slot-0', parentKey: null },
      { key: 'el-2:header-0', parentKey: null },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: COMPONENT_EDITOR_PAGE_ID }, scannedElements: { current: scanned as never } },
      env: { doc },
    });
    await handleDragElementDrop(ctx, { cancelled: false, key: 'el-2:header-0', insertIndex: 0 });
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(acceptedTypes()).toContain('REORDER_PAGE_ELEMENTS');
    const source = acceptedSourceCommands() as Array<{ kind: string; payload: { payloads: unknown[]; deferUntil?: number } }>;
    expect(source).toHaveLength(1);
    expect(source[0].kind).toBe('source-batch');
    expect(source[0].payload.payloads).toEqual([
      expect.objectContaining({ astroSource: 'layouts/Layout1.astro', overrides: { orderOverrides: ['header-0', 'slot-0'] } }),
    ]);
    // Queued (deferred), not eager: an eager write full-reloads the WC iframe mid-edit.
    expect(source[0].payload.deferUntil).toBeGreaterThan(Date.now());
  });

  it('page canvas reorder of layout-chrome children fires the eager permutation write', async () => {
    const doc = docWith({
      'layoutchrome-page-1': { astroSource: 'layouts/Layout1.astro' },
    });
    const scanned = [
      { key: 'layoutchrome-page-1:div-0', parentKey: 'layoutchrome-page-1' },
      { key: 'layoutchrome-page-1:header-0', parentKey: 'layoutchrome-page-1' },
      { key: 'layoutchrome-page-1:footer-0', parentKey: 'layoutchrome-page-1' },
    ];
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' }, scannedElements: { current: scanned as never } },
      env: { doc },
    });
    await handleDragElementDrop(ctx, { cancelled: false, key: 'layoutchrome-page-1:footer-0', insertIndex: 0 });
    expect(mockAccept).toHaveBeenCalledTimes(1);
    const source = acceptedSourceCommands() as Array<{ kind: string; payload: { payloads: unknown[]; deferUntil?: number } }>;
    expect(source).toHaveLength(1);
    expect(source[0].kind).toBe('source-batch');
    expect(source[0].payload.payloads).toEqual([
      expect.objectContaining({
        astroSource: 'layouts/Layout1.astro',
        overrides: { orderPermutation: [2, 0, 1], orderRendered: ['div-0', 'header-0', 'footer-0'] },
      }),
    ]);
    expect(source[0].payload.deferUntil).toBeUndefined(); // eager
  });
});
