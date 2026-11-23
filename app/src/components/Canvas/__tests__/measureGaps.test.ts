import { describe, it, expect } from 'vitest';
import { measureGaps } from '../measureGaps';

const r = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
const values = (m: ReturnType<typeof measureGaps>) => m.gaps.map(g => g.value);

describe('measureGaps (Option-hover distances)', () => {
  it('siblings side by side: one horizontal gap through the shared span, no guide', () => {
    const m = measureGaps(r(0, 0, 100, 50), r(130, 10, 50, 60));
    expect(m.gaps).toEqual([{ x1: 100, y1: 30, x2: 130, y2: 30, value: 30 }]);
    expect(m.guides).toEqual([]);
  });

  it('stacked siblings of different widths: only the vertical gap', () => {
    const m = measureGaps(r(0, 100, 100, 20), r(20, 0, 200, 80));
    expect(m.gaps).toEqual([{ x1: 60, y1: 80, x2: 60, y2: 100, value: 20 }]);
  });

  it('selection inside the hovered parent: four paddings through the selection centre', () => {
    const m = measureGaps(r(10, 20, 80, 40), r(0, 0, 100, 100));
    expect(values(m)).toEqual([10, 10, 20, 40]);
    expect(m.gaps[0]).toEqual({ x1: 0, y1: 40, x2: 10, y2: 40, value: 10 });
    expect(m.gaps[3]).toEqual({ x1: 50, y1: 60, x2: 50, y2: 100, value: 40 });
  });

  it('hovered child inside the selection: same, mirrored', () => {
    expect(values(measureGaps(r(0, 0, 100, 100), r(10, 20, 80, 40)))).toEqual([10, 10, 20, 40]);
  });

  it('diagonal: both gaps through the selection centre, each with a guide off the hovered edge', () => {
    const m = measureGaps(r(0, 0, 100, 100), r(150, 200, 50, 50));
    expect(m.gaps).toEqual([
      { x1: 100, y1: 50, x2: 150, y2: 50, value: 50 },
      { x1: 50, y1: 100, x2: 50, y2: 200, value: 100 },
    ]);
    expect(m.guides).toEqual([
      { x1: 150, y1: 200, x2: 150, y2: 50 },
      { x1: 150, y1: 200, x2: 50, y2: 200 },
    ]);
  });

  it('touching or aligned edges draw nothing for that side', () => {
    expect(measureGaps(r(0, 0, 100, 50), r(100, 0, 100, 50)).gaps).toEqual([]);
    expect(values(measureGaps(r(0, 0, 50, 100), r(0, 0, 100, 100)))).toEqual([50]);
  });
});
