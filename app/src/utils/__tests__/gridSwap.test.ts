import { describe, it, expect } from 'vitest';
import { planDisplaced } from '../gridSwap';

const rect = { left: 0, top: 0, width: 0, height: 0 };

function cell(key: string, col: number, row: number, colSpan = 1, rowSpan = 1) {
  return { key, col, row, colSpan, rowSpan, rect };
}
const plan = (cells: ReturnType<typeof cell>[], target: { col: number; row: number; colSpan: number; rowSpan: number }) =>
  planDisplaced(cells, 'dragged', target).map(({ cell: c, to }) => `${c.key}→${to ? `c${to.col}r${to.row}` : 'auto'}`);

describe('planDisplaced', () => {
  it('the covered sibling takes the cell the dragged one left (any overlap, not just its top-left track)', () => {
    const cells = [cell('dragged', 6, 0, 6, 1), cell('sibling', 0, 0, 6, 1)];
    // target covers cols 0-5; drop cell (col 2 → clamped 0) is NOT required to be the sibling's own track
    expect(plan(cells, { col: 0, row: 0, colSpan: 6, rowSpan: 1 })).toEqual(['sibling→c6r0']);
  });

  it('the sibling covered most swaps; the others go back to auto-flow', () => {
    const cells = [cell('dragged', 0, 1, 5, 1), cell('small', 0, 0, 1, 1), cell('big', 1, 0, 4, 1)];
    expect(plan(cells, { col: 0, row: 0, colSpan: 5, rowSpan: 1 })).toEqual(['big→c0r1', 'small→auto']);
  });

  it('nothing covered, nothing moves', () => {
    expect(plan([cell('dragged', 0, 0, 6, 1), cell('far', 10, 0, 2, 1)], { col: 0, row: 0, colSpan: 6, rowSpan: 1 })).toEqual([]);
  });

  // Live 2026-11-12 (6-column list of wide cards): a 2-wide card dropped on a
  // 3-wide one sent it to the 2-wide card's old cell at column 5 → columns
  // 5-7 → a 7th column appeared and every card shrank.
  it('a wider sibling does not take a narrower cell: it re-flows instead of running past the last track', () => {
    const cells = [cell('dragged', 4, 0, 2, 1), cell('wide', 0, 1, 3, 1)];
    expect(plan(cells, { col: 1, row: 1, colSpan: 2, rowSpan: 1 })).toEqual(['wide→auto']);
  });

  it('no swap into a spot the dropped card still covers (a wide card nudged one track over)', () => {
    const cells = [cell('dragged', 0, 0, 3, 1), cell('next', 3, 0, 2, 1)];
    // dragged now covers cols 1-3; its old cell (cols 0-2) would put `next` under it
    expect(plan(cells, { col: 1, row: 0, colSpan: 3, rowSpan: 1 })).toEqual(['next→auto']);
  });
});
