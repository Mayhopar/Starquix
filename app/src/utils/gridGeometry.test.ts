import { describe, it, expect } from 'vitest';
import { findTrack, getCellRect, isAdjacentCell, getGapPositions, getTrackTotal, normalizeGridClasses, getTrackBoundaries, snapToNearestBoundary, computeSpanFromSize , dragTargetCell, gridOfChild } from './gridGeometry';
import type { GridGeometry } from '@/store/types';

describe('findTrack', () => {
  const tracks = [100, 200, 100];
  const gap = 10;

  it('returns 0 for position in first track', () => {
    expect(findTrack(50, tracks, gap)).toBe(0);
  });

  it('returns 1 for position in second track', () => {
    expect(findTrack(200, tracks, gap)).toBe(1);
  });

  it('returns 2 for position in third track', () => {
    expect(findTrack(370, tracks, gap)).toBe(2);
  });

  it('returns -1 for position in gap', () => {
    expect(findTrack(105, tracks, gap)).toBe(-1);
  });

  it('returns -1 for position before tracks', () => {
    expect(findTrack(-10, tracks, gap)).toBe(-1);
  });

  it('returns -1 for position after all tracks', () => {
    expect(findTrack(500, tracks, gap)).toBe(-1);
  });

  it('returns 0 for position at start boundary', () => {
    expect(findTrack(0, tracks, gap)).toBe(0);
  });

  it('handles zero gap', () => {
    expect(findTrack(150, [100, 100], 0)).toBe(1);
  });
});

describe('getCellRect', () => {
  const geometry: GridGeometry = {
    containerRect: { top: 100, left: 50, width: 420, height: 220 },
    columns: [100, 200, 100],
    rows: [100, 100],
    columnGap: 10,
    rowGap: 10,
    cells: [],
  };

  it('returns correct rect for cell (0, 0)', () => {
    const rect = getCellRect(geometry, 0, 0);
    expect(rect).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('returns correct rect for cell (1, 0)', () => {
    const rect = getCellRect(geometry, 1, 0);
    expect(rect).toEqual({ left: 110, top: 0, width: 200, height: 100 });
  });

  it('returns correct rect for cell (0, 1)', () => {
    const rect = getCellRect(geometry, 0, 1);
    expect(rect).toEqual({ left: 0, top: 110, width: 100, height: 100 });
  });

  it('returns correct rect for multi-span cell (col 0-1, row 0)', () => {
    const rect = getCellRect(geometry, 0, 0, 2, 1);
    expect(rect).toEqual({ left: 0, top: 0, width: 310, height: 100 });
  });
});

describe('isAdjacentCell', () => {
  it('returns true for horizontally adjacent cells', () => {
    expect(isAdjacentCell(0, 0, 1, 0)).toBe(true);
  });

  it('returns true for vertically adjacent cells', () => {
    expect(isAdjacentCell(0, 0, 0, 1)).toBe(true);
  });

  it('returns false for diagonal cells', () => {
    expect(isAdjacentCell(0, 0, 1, 1)).toBe(false);
  });

  it('returns false for non-adjacent cells', () => {
    expect(isAdjacentCell(0, 0, 2, 0)).toBe(false);
  });

  it('returns true for same cell', () => {
    expect(isAdjacentCell(1, 1, 1, 1)).toBe(true);
  });
});

describe('getGapPositions', () => {
  it('returns positions between tracks', () => {
    expect(getGapPositions([100, 200, 100], 10)).toEqual([100, 310]);
  });

  it('returns empty array for single track', () => {
    expect(getGapPositions([100], 10)).toEqual([]);
  });

  it('returns empty array for no tracks', () => {
    expect(getGapPositions([], 10)).toEqual([]);
  });

  it('handles zero gap', () => {
    expect(getGapPositions([100, 200], 0)).toEqual([100]);
  });
});

describe('getTrackTotal', () => {
  it('sums tracks and gaps', () => {
    expect(getTrackTotal([100, 200, 100], 10)).toBe(420);
  });

  it('returns single track size with no gaps', () => {
    expect(getTrackTotal([100], 10)).toBe(100);
  });

  it('returns 0 for empty tracks', () => {
    expect(getTrackTotal([], 10)).toBe(0);
  });
});

describe('normalizeGridClasses', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeGridClasses('')).toBe('');
  });

  it('passes through non-grid tokens unchanged', () => {
    expect(normalizeGridClasses('flex p-4 bg-white')).toBe('flex p-4 bg-white');
  });

  it('preserves non-grid tokens with grid tokens', () => {
    expect(normalizeGridClasses('flex p-4 col-start-2')).toBe('flex p-4 col-start-2');
  });

  it('converts col-end to col-span when start is present', () => {
    expect(normalizeGridClasses('col-start-3 col-end-7')).toBe('col-start-3 col-span-4');
  });

  it('converts row-end to row-span when start is present', () => {
    expect(normalizeGridClasses('row-start-1 row-end-4')).toBe('row-start-1 row-span-3');
  });

  it('leaves col-end when no start is present', () => {
    const result = normalizeGridClasses('col-end-5');
    expect(result).toContain('col-end-5');
  });

  it('leaves contradictory end < start as-is', () => {
    const result = normalizeGridClasses('row-start-5 row-end-2');
    expect(result).toContain('row-start-5');
    expect(result).toContain('row-end-2');
  });

  it('removes higher breakpoint when it matches lower', () => {
    expect(normalizeGridClasses('md:col-start-7 lg:col-start-7')).toBe('md:col-start-7');
  });

  it('removes xl when it matches lg value', () => {
    expect(normalizeGridClasses('col-start-1 lg:col-start-5 xl:col-start-5'))
      .toBe('col-start-1 lg:col-start-5');
  });

  it('keeps different values across breakpoints', () => {
    expect(normalizeGridClasses('md:col-start-3 lg:col-start-7'))
      .toBe('md:col-start-3 lg:col-start-7');
  });

  it('deduplicates across multiple breakpoints in chain', () => {
    expect(normalizeGridClasses('sm:row-start-2 md:row-start-2 lg:row-start-2 xl:row-start-3'))
      .toBe('sm:row-start-2 xl:row-start-3');
  });

  it('removes bare col-span-1 (CSS default)', () => {
    expect(normalizeGridClasses('col-start-2 col-span-1')).toBe('col-start-2');
  });

  it('removes bare row-span-1 (CSS default)', () => {
    expect(normalizeGridClasses('row-start-3 row-span-1')).toBe('row-start-3');
  });

  it('keeps span-1 when it overrides a non-default from lower breakpoint', () => {
    const result = normalizeGridClasses('md:col-span-3 lg:col-span-1');
    expect(result).toBe('md:col-span-3 lg:col-span-1');
  });

  it('removes span-1 at higher bp when lower bp also has span-1', () => {
    expect(normalizeGridClasses('md:col-span-1 lg:col-span-1')).toBe('');
  });

  it('preserves col-span-full', () => {
    expect(normalizeGridClasses('col-span-full')).toBe('col-span-full');
  });

  it('deduplicates col-span-full across breakpoints', () => {
    expect(normalizeGridClasses('md:col-span-full lg:col-span-full')).toBe('md:col-span-full');
  });

  it('preserves col-auto', () => {
    expect(normalizeGridClasses('col-auto')).toBe('col-auto');
  });

  it('preserves responsive non-grid classes', () => {
    expect(normalizeGridClasses('md:px-4 lg:text-lg col-start-2'))
      .toBe('md:px-4 lg:text-lg col-start-2');
  });

  it('outputs grid tokens in breakpoint order after non-grid tokens', () => {
    const result = normalizeGridClasses('flex lg:col-start-3 col-start-1 p-4 md:row-start-2');
    expect(result).toBe('flex p-4 col-start-1 md:row-start-2 lg:col-start-3');
  });

  it('outputs col-start before col-span within same breakpoint', () => {
    const result = normalizeGridClasses('col-span-3 col-start-2');
    expect(result).toBe('col-start-2 col-span-3');
  });

  it('normalizes a realistic set of classes from resize operations', () => {
    const input = 'p-4 bg-white col-start-3 col-end-7 row-start-1 row-span-1 md:col-start-3 md:col-end-7 md:row-start-1 md:row-span-1 lg:col-start-3 lg:col-end-7';
    const result = normalizeGridClasses(input);
    expect(result).toBe('p-4 bg-white col-start-3 col-span-4 row-start-1');
  });

  it('converts end→span at each breakpoint independently', () => {
    const result = normalizeGridClasses('md:col-start-2 md:col-end-5');
    expect(result).toBe('md:col-start-2 md:col-span-3');
  });

  // col-span-N / row-span-N are the grid-column / grid-row SHORTHAND: declared
  // at a larger breakpoint they reset a start inherited from a smaller one.
  // Live 2026-11-12: a span resize at xl threw a card dragged at lg to column 1.
  it('restates the start beside a span kept at a larger breakpoint', () => {
    expect(normalizeGridClasses('lg:col-start-2 lg:col-span-3 lg:row-start-2 xl:col-start-2 xl:col-span-2'))
      .toBe('lg:col-start-2 lg:col-span-3 lg:row-start-2 xl:col-start-2 xl:col-span-2');
    expect(normalizeGridClasses('col-start-3 lg:col-span-2')).toBe('col-start-3 lg:col-start-3 lg:col-span-2');
    expect(normalizeGridClasses('row-start-2 md:row-span-3')).toBe('row-start-2 md:row-start-2 md:row-span-3');
  });

  it('adds no start beside a span when none is in force (auto stays auto)', () => {
    expect(normalizeGridClasses('lg:col-span-3 xl:col-span-2')).toBe('lg:col-span-3 xl:col-span-2');
  });
});

describe('getTrackBoundaries', () => {
  it('full range', () => {
    expect(getTrackBoundaries([100, 200, 150], 10, 0, 3)).toEqual([100, 310, 470]);
  });

  it('partial range (from=1)', () => {
    expect(getTrackBoundaries([100, 200, 150], 10, 1, 3)).toEqual([200, 360]);
  });

  it('zero gap', () => {
    expect(getTrackBoundaries([100, 200, 150], 0, 0, 3)).toEqual([100, 300, 450]);
  });

  it('0-height rows, no gap', () => {
    expect(getTrackBoundaries([300, 0, 0, 0], 0, 0, 4)).toEqual([300, 300, 300, 300]);
  });

  it('0-height rows with gap', () => {
    expect(getTrackBoundaries([300, 0, 0, 0], 16, 0, 4)).toEqual([300, 316, 332, 348]);
  });

  it('empty tracks', () => {
    expect(getTrackBoundaries([], 10, 0, 0)).toEqual([]);
  });

  it('clamps to beyond array length', () => {
    expect(getTrackBoundaries([100, 200], 10, 0, 5)).toEqual([100, 310]);
  });

  it('clamps with non-zero from', () => {
    expect(getTrackBoundaries([100, 200, 150], 10, 1, 10)).toEqual([200, 360]);
  });
});

describe('snapToNearestBoundary', () => {
  it('snaps within threshold', () => {
    expect(snapToNearestBoundary(95, [100, 310, 470])).toBe(100);
    expect(snapToNearestBoundary(105, [100, 310, 470])).toBe(100);
  });

  it('no snap outside threshold', () => {
    expect(snapToNearestBoundary(70, [100, 310, 470])).toBe(70);
    expect(snapToNearestBoundary(200, [100, 310, 470])).toBe(200);
  });

  it('picks closest when multiple in range', () => {
    expect(snapToNearestBoundary(308, [300, 316, 332])).toBe(300);
    expect(snapToNearestBoundary(310, [300, 316, 332])).toBe(316);
  });

  it('exact match', () => {
    expect(snapToNearestBoundary(100, [100, 310, 470])).toBe(100);
    expect(snapToNearestBoundary(310, [100, 310, 470])).toBe(310);
  });

  it('empty boundaries', () => {
    expect(snapToNearestBoundary(100, [])).toBe(100);
  });
});

describe('computeSpanFromSize', () => {
  it('empty boundaries => 1', () => {
    expect(computeSpanFromSize(100, [])).toBe(1);
  });

  it('normal boundaries', () => {
    const b = [100, 300, 450, 600];
    expect(computeSpanFromSize(50, b)).toBe(1);
    expect(computeSpanFromSize(100, b)).toBe(1);
    expect(computeSpanFromSize(190, b)).toBe(1);
    expect(computeSpanFromSize(210, b)).toBe(2);
    expect(computeSpanFromSize(300, b)).toBe(2);
    expect(computeSpanFromSize(380, b)).toBe(3);
    expect(computeSpanFromSize(600, b)).toBe(4);
    expect(computeSpanFromSize(1000, b)).toBe(4);
  });

  it('single boundary', () => {
    expect(computeSpanFromSize(50, [100])).toBe(1);
    expect(computeSpanFromSize(200, [100])).toBe(1);
  });

  it('all-collapsed: at boundary => 1', () => {
    expect(computeSpanFromSize(300, [300, 300, 300, 300])).toBe(1);
  });

  it('all-collapsed: below => 1', () => {
    expect(computeSpanFromSize(200, [300, 300, 300, 300])).toBe(1);
  });

  it('all-collapsed: above => minimal span (0-height rows dont inflate)', () => {
    // All rows past the first are 0px — spanning more has no visual effect.
    // Return minimal span (1) instead of max (4).
    expect(computeSpanFromSize(350, [300, 300, 300, 300])).toBe(1);
  });

  it('partially collapsed (trailing 0-height)', () => {
    const b = [200, 300, 300, 300];
    expect(computeSpanFromSize(200, b)).toBe(1);
    expect(computeSpanFromSize(280, b)).toBe(2);
    expect(computeSpanFromSize(300, b)).toBe(2);
    // All remaining are collapsed at 300 — minimal span is 2 (not 4)
    expect(computeSpanFromSize(350, b)).toBe(2);
  });

  it('partially collapsed with non-collapsed after', () => {
    // [200, 300, 300, 500] — rows 1&2 are collapsed but row 3 has real height
    const b = [200, 300, 300, 500];
    expect(computeSpanFromSize(200, b)).toBe(1);
    expect(computeSpanFromSize(280, b)).toBe(2);
    expect(computeSpanFromSize(300, b)).toBe(2);
    // size 350: past collapsed group, midpoint(300,500)=400, 350 < 400 → span 3
    expect(computeSpanFromSize(350, b)).toBe(3);
    expect(computeSpanFromSize(450, b)).toBe(4);
  });

  it('0-height rows with gap (not collapsed)', () => {
    const b = [300, 316, 332, 348];
    expect(computeSpanFromSize(300, b)).toBe(1);
    expect(computeSpanFromSize(310, b)).toBe(2);
    expect(computeSpanFromSize(316, b)).toBe(2);
    expect(computeSpanFromSize(330, b)).toBe(3);
  });

  it('reversed boundaries (north handle, 0-height rows)', () => {
    // rows=[300,0,0,0] reversed → [0,0,0,300] gap=0
    const b = [0, 0, 0, 300];
    // All leading boundaries collapsed at 0 — minimal span
    expect(computeSpanFromSize(0, b)).toBe(1);
    // size 1: past collapsed group, next non-collapsed is 300.
    // midpoint(0,300)=150, 1 < 150 → span at the boundary after collapsed group
    expect(computeSpanFromSize(1, b)).toBe(3);
    expect(computeSpanFromSize(160, b)).toBe(4);
    expect(computeSpanFromSize(300, b)).toBe(4);
  });

  it('reversed all-collapsed', () => {
    // rows=[0,0,0,300] reversed → [300,0,0,0] gap=0 → boundaries [300,300,300,300]
    const b = [300, 300, 300, 300];
    expect(computeSpanFromSize(300, b)).toBe(1);
    // Above: all remaining collapsed, minimal span
    expect(computeSpanFromSize(350, b)).toBe(1);
  });
});

// Live 2026-11-12 (6-column list of 3-wide cards): the drop cell was the one
// under the CURSOR, so a card grabbed in its middle and moved one row straight
// down landed a column to the right.
describe('dragTargetCell', () => {
  const geo = { columns: [140, 140, 140, 140, 140, 140], rows: [73, 73], columnGap: 24, rowGap: 24 } as never;
  const wide = { col: 0, row: 0, colSpan: 3, rowSpan: 1 };

  it('a card moved straight down keeps its column, wherever it was grabbed', () => {
    expect(dragTargetCell(geo, wide, 0, 97)).toEqual({ col: 0, row: 1 });
  });

  it('lands on the track its own corner is nearest to', () => {
    expect(dragTargetCell(geo, wide, 70, 0)).toEqual({ col: 0, row: 0 }); // under half a track (164 / 2)
    expect(dragTargetCell(geo, wide, 100, 0)).toEqual({ col: 1, row: 0 });
    expect(dragTargetCell(geo, { col: 2, row: 1, colSpan: 1, rowSpan: 1 }, -200, -60)).toEqual({ col: 1, row: 0 });
  });

  it('never runs the span past the last track', () => {
    expect(dragTargetCell(geo, wide, 2000, 500)).toEqual({ col: 3, row: 1 });
  });
});

// Live 2026-11-12: a card picked in the Layers panel (after a non-grid canvas
// selection) could not be span-resized — the canvas asked a flag only an
// iframe click sets, instead of the grid it had just measured.
describe('gridOfChild', () => {
  const geo = { cells: [{ key: 'card-1' }, { key: 'card-2' }] } as never;
  it('is the measured grid when the selection is one of its cells, however it was selected', () => {
    expect(gridOfChild(geo, 'card-2')).toBe(geo);
  });
  it('is null for anything else — a stale grid never snaps another element', () => {
    expect(gridOfChild(geo, 'section')).toBeNull();
    expect(gridOfChild(null, 'card-1')).toBeNull();
    expect(gridOfChild(geo, null)).toBeNull();
  });
});
