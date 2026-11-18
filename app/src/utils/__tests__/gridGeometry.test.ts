import { describe, it, expect } from 'vitest';
import { clampCellToSpan } from '../gridGeometry';

describe('clampCellToSpan', () => {
  const geo = {
    columns: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 12 tracks
    rows: [0], // 1 track
  };

  it('clamps col so the span stays inside the rendered tracks', () => {
    expect(clampCellToSpan(geo, { col: 9, row: 0 }, 6, 1)).toEqual({ col: 6, row: 0 });
  });

  it('leaves an in-range cell unchanged', () => {
    expect(clampCellToSpan(geo, { col: 3, row: 0 }, 6, 1)).toEqual({ col: 3, row: 0 });
    expect(clampCellToSpan(geo, { col: 6, row: 0 }, 6, 1)).toEqual({ col: 6, row: 0 });
  });

  it('clamps row to rows.length - rowSpan with a floor of 0', () => {
    expect(clampCellToSpan(geo, { col: 0, row: 5 }, 1, 1)).toEqual({ col: 0, row: 0 });
    // rowSpan larger than track count: floor at 0, never negative
    expect(clampCellToSpan(geo, { col: 0, row: 2 }, 1, 3)).toEqual({ col: 0, row: 0 });
  });
});
