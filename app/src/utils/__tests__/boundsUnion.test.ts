/**
 * Regression for the bridge's `rectOf` fallback. When a `<slot>` inside
 * BlogSlot's posts wrapper has `display: contents`, its own DOMRect is
 * zero-size and the selection overlay drew nothing. The bridge falls back
 * to the union of the children's rects so the slot has a meaningful
 * bounding box. Algorithm lives here (testable) and is duplicated inside
 * the bridge template (runtime).
 */
import { describe, it, expect } from 'vitest';
import { unionRect, type SimpleRect } from '../boundsUnion';

describe('unionRect — bridge rectOf fallback', () => {
  it('returns null for an empty child list', () => {
    expect(unionRect([])).toBeNull();
  });

  it('returns null when every child rect is zero-size', () => {
    const zeros: SimpleRect[] = [
      { top: 0, left: 0, width: 0, height: 0 },
      { top: 0, left: 0, width: 0, height: 0 },
    ];
    expect(unionRect(zeros)).toBeNull();
  });

  it('unions a single non-zero child', () => {
    const out = unionRect([{ top: 10, left: 20, width: 100, height: 50 }]);
    expect(out).toEqual({ top: 10, left: 20, width: 100, height: 50 });
  });

  it('unions three blog cards in a row (simulates BlogSlot posts wrapper)', () => {
    const cards: SimpleRect[] = [
      { top: 100, left: 0,   width: 250, height: 300 },
      { top: 100, left: 270, width: 250, height: 300 },
      { top: 100, left: 540, width: 250, height: 300 },
    ];
    expect(unionRect(cards)).toEqual({ top: 100, left: 0, width: 790, height: 300 });
  });

  it('unions cards on multiple rows (3-column grid, 6 posts)', () => {
    const cards: SimpleRect[] = [
      { top: 100, left: 0,   width: 250, height: 300 },
      { top: 100, left: 270, width: 250, height: 300 },
      { top: 100, left: 540, width: 250, height: 300 },
      { top: 420, left: 0,   width: 250, height: 300 },
      { top: 420, left: 270, width: 250, height: 300 },
      { top: 420, left: 540, width: 250, height: 300 },
    ];
    expect(unionRect(cards)).toEqual({ top: 100, left: 0, width: 790, height: 620 });
  });

  it('skips zero-size children when unioning', () => {
    const mixed: SimpleRect[] = [
      { top: 0,   left: 0,   width: 0,   height: 0 },     // ignored
      { top: 50,  left: 10,  width: 100, height: 60 },
      { top: 50,  left: 200, width: 100, height: 60 },
    ];
    expect(unionRect(mixed)).toEqual({ top: 50, left: 10, width: 290, height: 60 });
  });
});
