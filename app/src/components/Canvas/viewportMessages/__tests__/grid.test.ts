import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGridGeometryResponse, parseExplicitRowCount } from '../grid';
import { clearSelectedCellGeometry, getSelectedCellGeometrySnapshot } from '@/store/gridGeometryStore';
import { makeFakeCtx } from './fakeContext';

const makeGeo = () => ({
  containerRect: { left: 0, top: 0, width: 100, height: 100 },
  cells: [
    { key: 'a', row: -1, col: -1, colSpan: 1, rowSpan: 1 },
    { key: 'b', row: 2, col: 3, colSpan: 1, rowSpan: 1 },
  ],
  explicitRowCount: 5,
});

describe('grid handlers', () => {
  it('parseExplicitRowCount reads grid-rows-N, defaults to 0', () => {
    expect(parseExplicitRowCount('grid grid-rows-4 gap-2')).toBe(4);
    expect(parseExplicitRowCount('grid gap-2')).toBe(0);
  });

  it('GRID_GEOMETRY_RESPONSE clamps negative cell positions to 0', () => {
    const ctx = makeFakeCtx();
    const geo = makeGeo();
    handleGridGeometryResponse(ctx, geo);
    expect(geo.cells[0]).toMatchObject({ row: 0, col: 0 });
    expect(geo.cells[1]).toMatchObject({ row: 2, col: 3 });
    expect(ctx.actions.setGridGeometry).toHaveBeenCalledWith(geo);
  });

  it('overrides explicitRowCount from the selected key Yjs classes', () => {
    const ctx = makeFakeCtx({
      refs: { selectedKey: { current: 'k1' } },
      actions: { getClassesFromYjs: vi.fn(() => 'grid grid-rows-7') },
    });
    const geo = makeGeo();
    handleGridGeometryResponse(ctx, geo);
    expect(ctx.actions.getClassesFromYjs).toHaveBeenCalledWith('k1');
    expect(geo.explicitRowCount).toBe(7);
  });

  it('keeps bridge explicitRowCount when nothing is selected', () => {
    const ctx = makeFakeCtx();
    const geo = makeGeo();
    handleGridGeometryResponse(ctx, geo);
    expect(geo.explicitRowCount).toBe(5);
  });
});

// task-090 review: the selected-cell store entry must carry the element key
// + the frame breakpoint that measured it, so stale geometry can never be
// shown for a different element (Layers-panel select) or another breakpoint.
describe('GRID_GEOMETRY_RESPONSE → selected-cell store identity', () => {
  beforeEach(() => clearSelectedCellGeometry());

  const geoPayload = (cells: Array<Record<string, unknown>>) => ({
    containerRect: { left: 0, top: 0, width: 100, height: 100 },
    columns: [10, 10, 10],
    rows: [10],
    columnGap: 0,
    rowGap: 0,
    cells,
    explicitRowCount: 1,
  });

  it('stamps the selected key and frame breakpoint into the store', () => {
    const ctx = makeFakeCtx({
      refs: { selectedKey: { current: 'el-1:div-0' }, breakpoint: { current: 'md' } },
    });
    handleGridGeometryResponse(ctx, geoPayload([
      { key: 'el-1:div-0', row: 0, col: 1, colSpan: 2, rowSpan: 1 },
    ]));
    expect(getSelectedCellGeometrySnapshot()).toEqual({
      key: 'el-1:div-0', breakpoint: 'md',
      start: 2, span: 2, rowStart: 1, rowSpan: 1, parentCols: 3, parentRows: 1,
    });
  });

  it('clears the store when the selected key is not among the cells', () => {
    const ctx = makeFakeCtx({
      refs: { selectedKey: { current: 'el-1:div-0' }, breakpoint: { current: 'base' } },
    });
    handleGridGeometryResponse(ctx, geoPayload([
      { key: 'el-1:div-0', row: 0, col: 0, colSpan: 1, rowSpan: 1 },
    ]));
    expect(getSelectedCellGeometrySnapshot()).not.toBeNull();

    const ctx2 = makeFakeCtx({
      refs: { selectedKey: { current: 'el-OTHER' }, breakpoint: { current: 'base' } },
    });
    handleGridGeometryResponse(ctx2, geoPayload([
      { key: 'el-1:div-0', row: 0, col: 0, colSpan: 1, rowSpan: 1 },
    ]));
    expect(getSelectedCellGeometrySnapshot()).toBeNull();
  });
});
