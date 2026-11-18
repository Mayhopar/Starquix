import { describe, it, expect } from 'vitest';
import { PANEL_MOTION, easeOut, lerpPath, shapeProgress } from '../footerMotion';
import { footerOutlinePath } from '../footerOutline';

describe('the panel path: m = 0 open … 1 closed', () => {
  const ms = Array.from({ length: 101 }, (_, i) => i / 100);

  it('starts open and ends closed', () => {
    expect(shapeProgress(0)).toEqual({ px: 0, py: 0 });
    expect(shapeProgress(1)).toEqual({ px: 1, py: 1 });
  });

  it('never passes through a hammer: the height is mostly gone only once the width is the bar\'s (owner 2026-11-05)', () => {
    for (const m of ms) {
      const { px, py } = shapeProgress(m);
      if (py > 0.5) expect(px).toBe(1);
    }
  });

  it('the height STARTS to go while the width is still shrinking', () => {
    const early = ms.filter(m => { const { px, py } = shapeProgress(m); return py > 0 && px < 1; });
    expect(early.length).toBeGreaterThan(10);
  });

  it('both only ever go one way', () => {
    let prev = shapeProgress(0);
    for (const m of ms) {
      const cur = shapeProgress(m);
      expect(cur.px).toBeGreaterThanOrEqual(prev.px);
      expect(cur.py).toBeGreaterThanOrEqual(prev.py);
      prev = cur;
    }
  });

  it('the click is answered at once: the width is already moving at the first frame (no slow start)', () => {
    // an ease-out in time (fast start) on a width that leaves m=0 with slope > 0
    const m1 = easeOut(1 / 60 / (PANEL_MOTION.closeMs / 1000), PANEL_MOTION.closeCurve); // one 60Hz frame in
    expect(shapeProgress(m1).px).toBeGreaterThan(0.05);
  });

  it('easeOut: 0 → 0, 1 → 1, fast start, soft landing', () => {
    expect(easeOut(0, 2.2)).toBe(0);
    expect(easeOut(1, 2.2)).toBe(1);
    expect(easeOut(0.1, 2.2)).toBeGreaterThan(0.2);
    expect(easeOut(0.99, 2.2) - easeOut(0.95, 2.2)).toBeLessThan(0.01);
  });
});

describe('lerpPath: x and y move on their OWN progress', () => {
  const bar = { w: 130, h: 38 };
  const open = footerOutlinePath({ bar, panel: { w: 337, h: 46 } });
  const closed = footerOutlinePath({ bar, panel: null });

  it('the open and closed outlines have the same command sequence (their numbers pair up)', () => {
    const cmds = (d: string) => d.replace(/-?\d+(\.\d+)?/g, '#');
    expect(cmds(open)).toBe(cmds(closed));
  });

  it('(0, 0) is the open outline, (1, 1) the closed one', () => {
    expect(lerpPath(open, closed, 0, 0)).toBe(open);
    expect(lerpPath(open, closed, 1, 1)).toBe(closed);
  });

  it('x narrows with px while y keeps its own: width done, height untouched = the open height at the bar\'s width', () => {
    const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const o = nums(open); const c = nums(closed); const mid = nums(lerpPath(open, closed, 1, 0));
    o.forEach((v, i) => { expect(mid[i]).toBeCloseTo(i % 2 === 0 ? c[i] : v, 1); });
  });
});
