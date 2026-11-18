import { describe, it, expect } from 'vitest';
import { penDrawReducer, initialDrawState, penEditReducer, initialEditState } from '../penState';
import type { PenPath } from '../penGeometry';

const down = (x: number, y: number, mods = {}) => ({ type: 'pointerdown', x, y, alt: false, shift: false, ...mods }) as const;
const move = (x: number, y: number, mods = {}) => ({ type: 'pointermove', x, y, alt: false, shift: false, ...mods }) as const;
const up = (x: number, y: number) => ({ type: 'pointerup', x, y, alt: false, shift: false }) as const;

const corner = (x: number, y: number) => ({ x, y, corner: true });

describe('penDrawReducer', () => {
  it('click places a corner anchor', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(10, 10));
    s = penDrawReducer(s, up(10, 10));
    expect(s.path.anchors).toHaveLength(1);
    expect(s.path.anchors[0]).toMatchObject({ x: 10, y: 10, corner: true });
  });

  it('click-drag places a smooth anchor with symmetric handles', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(10, 10));
    s = penDrawReducer(s, move(40, 10));
    s = penDrawReducer(s, up(40, 10));
    const a = s.path.anchors[0];
    expect(a.corner).toBe(false);
    expect(a.hOut).toEqual({ dx: 30, dy: 0 });
    expect(a.hIn).toEqual({ dx: -30, dy: 0 }); // symmetric
  });

  it('shift snaps the placed segment direction to 15° increments', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(0, 0)); s = penDrawReducer(s, up(0, 0));
    s = penDrawReducer(s, down(100, 8, { shift: true })); // ~4.6° → snaps to 0°
    s = penDrawReducer(s, up(100, 8));
    expect(s.path.anchors[1]).toMatchObject({ x: 100, y: 0 });
  });

  it('click within closeRadius of first anchor closes the path and yields commit', () => {
    let s = initialDrawState();
    for (const [x, y] of [[0, 0], [100, 0], [50, 80]]) { s = penDrawReducer(s, down(x, y)); s = penDrawReducer(s, up(x, y)); }
    s = penDrawReducer(s, down(2, 2)); s = penDrawReducer(s, up(2, 2));
    expect(s.committed).toEqual(expect.objectContaining({ closed: true }));
    expect(s.committed!.anchors).toHaveLength(3); // closing click adds NO anchor
  });

  it('Enter commits an open path with >=2 anchors', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(0, 0)); s = penDrawReducer(s, up(0, 0));
    s = penDrawReducer(s, down(50, 30)); s = penDrawReducer(s, up(50, 30));
    s = penDrawReducer(s, { type: 'enter' });
    expect(s.committed).toEqual(expect.objectContaining({ closed: false }));
    expect(s.committed!.anchors).toHaveLength(2);
  });

  it('Enter with <2 anchors cancels', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(0, 0)); s = penDrawReducer(s, up(0, 0));
    s = penDrawReducer(s, { type: 'enter' });
    expect(s.committed).toBeNull();
    expect(s.cancelled).toBe(true);
  });

  it('Escape mid-draw cancels without commit', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(0, 0)); s = penDrawReducer(s, up(0, 0));
    s = penDrawReducer(s, down(50, 0)); s = penDrawReducer(s, up(50, 0));
    s = penDrawReducer(s, { type: 'escape' });
    expect(s.cancelled).toBe(true);
    expect(s.committed).toBeNull();
  });

  it('events after commit are no-ops (terminal state)', () => {
    let s = initialDrawState();
    for (const [x, y] of [[0, 0], [100, 0], [50, 80]]) { s = penDrawReducer(s, down(x, y)); s = penDrawReducer(s, up(x, y)); }
    s = penDrawReducer(s, down(2, 2)); s = penDrawReducer(s, up(2, 2));
    const after = penDrawReducer(s, down(300, 300));
    expect(after).toBe(s);
  });

  it('backspace removes the last placed anchor; on the only anchor it cancels', () => {
    let s = initialDrawState();
    s = penDrawReducer(s, down(0, 0)); s = penDrawReducer(s, up(0, 0));
    s = penDrawReducer(s, down(50, 0)); s = penDrawReducer(s, up(50, 0));
    s = penDrawReducer(s, { type: 'backspace' });
    expect(s.path.anchors).toHaveLength(1);
    expect(s.cancelled).toBe(false);

    s = penDrawReducer(s, { type: 'backspace' });
    expect(s.cancelled).toBe(true);
  });

  it('idle pointermove before the first anchor is a no-op (no re-render churn)', () => {
    const s = initialDrawState();
    expect(penDrawReducer(s, move(50, 50))).toBe(s);
  });

  it('pointerdown honors an explicit closeRadius (zoom-aware hit area)', () => {
    let s = initialDrawState();
    for (const [x, y] of [[0, 0], [100, 0], [50, 80]]) { s = penDrawReducer(s, down(x, y)); s = penDrawReducer(s, up(x, y)); }
    // 10px away from the first anchor: outside default 6, inside explicit 16
    s = penDrawReducer(s, { ...down(10, 0), closeRadius: 16 });
    expect(s.committed).toEqual(expect.objectContaining({ closed: true }));
  });
});

describe('penEditReducer', () => {
  const tri = (): PenPath => ({ anchors: [corner(0, 0), corner(100, 0), corner(50, 80)], closed: true });

  const dragStart = (kind: 'anchor' | 'hIn' | 'hOut', index: number, x: number, y: number) =>
    ({ type: 'drag-start', target: { kind, index }, x, y, alt: false, shift: false }) as const;

  it('drag anchor moves it (relative handles ride along)', () => {
    const smooth: PenPath = {
      anchors: [{ x: 0, y: 0, hOut: { dx: 20, dy: 0 }, hIn: { dx: -20, dy: 0 }, corner: false }, corner(100, 0)],
      closed: false,
    };
    let s = initialEditState(smooth);
    s = penEditReducer(s, dragStart('anchor', 0, 0, 0));
    s = penEditReducer(s, move(30, 40));
    s = penEditReducer(s, up(30, 40));
    expect(s.path.anchors[0]).toMatchObject({ x: 30, y: 40, hOut: { dx: 20, dy: 0 } });
  });

  it('drag handle updates hOut and mirrors hIn without alt', () => {
    const smooth: PenPath = {
      anchors: [{ x: 50, y: 50, hOut: { dx: 10, dy: 0 }, hIn: { dx: -10, dy: 0 }, corner: false }, corner(100, 0)],
      closed: false,
    };
    let s = initialEditState(smooth);
    s = penEditReducer(s, dragStart('hOut', 0, 60, 50));
    s = penEditReducer(s, move(80, 60));
    s = penEditReducer(s, up(80, 60));
    expect(s.path.anchors[0].hOut).toEqual({ dx: 30, dy: 10 });
    expect(s.path.anchors[0].hIn).toEqual({ dx: -30, dy: -10 });
  });

  it('alt-drag breaks symmetry: only the dragged handle moves', () => {
    const smooth: PenPath = {
      anchors: [{ x: 50, y: 50, hOut: { dx: 10, dy: 0 }, hIn: { dx: -10, dy: 0 }, corner: false }, corner(100, 0)],
      closed: false,
    };
    let s = initialEditState(smooth);
    s = penEditReducer(s, dragStart('hOut', 0, 60, 50));
    s = penEditReducer(s, move(80, 60, { alt: true }));
    s = penEditReducer(s, up(80, 60));
    expect(s.path.anchors[0].hOut).toEqual({ dx: 30, dy: 10 });
    expect(s.path.anchors[0].hIn).toEqual({ dx: -10, dy: 0 }); // untouched
  });

  it('shift-snap on anchor drag', () => {
    let s = initialEditState(tri());
    s = penEditReducer(s, dragStart('anchor', 1, 100, 0));
    s = penEditReducer(s, move(150, 4, { shift: true })); // ~4.6° from drag origin → 0°
    s = penEditReducer(s, up(150, 4));
    expect(s.path.anchors[1]).toMatchObject({ x: 150, y: 0 });
  });

  it('toggle smooth→corner nulls handles', () => {
    const smooth: PenPath = {
      anchors: [{ x: 50, y: 50, hOut: { dx: 10, dy: 0 }, hIn: { dx: -10, dy: 0 }, corner: false }, corner(100, 0)],
      closed: false,
    };
    let s = initialEditState(smooth);
    s = penEditReducer(s, { type: 'toggle-anchor', index: 0 });
    const a = s.path.anchors[0];
    expect(a.corner).toBe(true);
    expect(a.hIn ?? null).toBeNull();
    expect(a.hOut ?? null).toBeNull();
  });

  it('toggle corner→smooth seeds handles along neighbor directions', () => {
    let s = initialEditState(tri());
    s = penEditReducer(s, { type: 'toggle-anchor', index: 1 }); // anchor (100,0); prev (0,0), next (50,80)
    const a = s.path.anchors[1];
    expect(a.corner).toBe(false);
    expect(a.hIn!.dx).toBeLessThan(0); // toward prev
    expect(a.hOut!.dx).toBeLessThan(0); // toward next (50,80) → dx negative
    expect(a.hOut!.dy).toBeGreaterThan(0);
  });

  it('add-anchor splices a corner anchor after the segment start', () => {
    let s = initialEditState(tri());
    s = penEditReducer(s, { type: 'add-anchor', segmentIndex: 0, x: 50, y: 0 });
    expect(s.path.anchors).toHaveLength(4);
    expect(s.path.anchors[1]).toMatchObject({ x: 50, y: 0, corner: true });
  });

  it('add-anchor on a straight segment projects an off-line click onto the line', () => {
    let s = initialEditState(tri());
    s = penEditReducer(s, { type: 'add-anchor', segmentIndex: 0, x: 50, y: 4 }); // 4px off
    expect(s.path.anchors[1].x).toBeCloseTo(50, 1);
    expect(s.path.anchors[1].y).toBeCloseTo(0, 1); // no kink
  });

  it('add-anchor on a curved segment splits without changing the curve (neighbor handles shrink)', () => {
    const arc: PenPath = {
      anchors: [
        { x: 0, y: 0, hOut: { dx: 30, dy: -40 }, corner: false },
        { x: 100, y: 0, hIn: { dx: -30, dy: -40 }, corner: false },
      ],
      closed: false,
    };
    let s = initialEditState(arc);
    s = penEditReducer(s, { type: 'add-anchor', segmentIndex: 0, x: 50, y: -30 });
    expect(s.path.anchors).toHaveLength(3);
    const mid = s.path.anchors[1];
    expect(mid.corner).toBe(false);
    expect(mid.y).toBeCloseTo(-30, 0); // sits ON the curve
    expect(s.path.anchors[0].hOut!.dx).toBeCloseTo(15, 0); // de Casteljau shrink
    expect(s.path.anchors[2].hIn!.dx).toBeCloseTo(-15, 0);
  });

  it('add-anchor on the CLOSING segment of a closed path splices at the end', () => {
    let s = initialEditState(tri()); // segments: 0-1, 1-2, 2-0 (closing = index 2)
    s = penEditReducer(s, { type: 'add-anchor', segmentIndex: 2, x: 25, y: 40 });
    expect(s.path.anchors).toHaveLength(4);
    // new anchor is LAST (between anchor 2 and the wrap to 0), on the 2→0 line
    const added = s.path.anchors[3];
    expect(added.x).toBeCloseTo(25, 0);
    expect(added.y).toBeCloseTo(40, 0);
  });

  it('delete-anchor removes; dropping below 2 anchors flags deleted', () => {
    let s = initialEditState(tri());
    s = penEditReducer(s, { type: 'delete-anchor', index: 2 });
    expect(s.path.anchors).toHaveLength(2);
    expect(s.deleted).toBe(false);

    s = penEditReducer(s, { type: 'delete-anchor', index: 1 });
    expect(s.deleted).toBe(true);
  });

  // Grab-offset dragging: the point must move by the pointer DELTA, never jump
  // to the pointer position (grabbing a 4px-radius dot off-center must be 1:1).
  it('off-center anchor grab moves by delta — no jump to the pointer', () => {
    let s = initialEditState(tri());
    // anchor 1 is at (100,0); grab 3px right, 2px below its center
    s = penEditReducer(s, dragStart('anchor', 1, 103, 2));
    s = penEditReducer(s, move(113, 2));
    s = penEditReducer(s, up(113, 2));
    expect(s.path.anchors[1]).toMatchObject({ x: 110, y: 0 }); // +10/+0, not 113/2
  });

  it('off-center handle grab moves the tip by delta — no jump', () => {
    const smooth: PenPath = {
      anchors: [{ x: 50, y: 50, hOut: { dx: 10, dy: 0 }, hIn: { dx: -10, dy: 0 }, corner: false }, corner(100, 0)],
      closed: false,
    };
    let s = initialEditState(smooth);
    // tip is at (60,50); grab 2px off
    s = penEditReducer(s, dragStart('hOut', 0, 62, 52));
    s = penEditReducer(s, move(82, 52, { alt: true }));
    s = penEditReducer(s, up(82, 52));
    expect(s.path.anchors[0].hOut).toEqual({ dx: 30, dy: 0 }); // tip 80,50 → +20/0
  });

  it('shift on a handle drag snaps the handle ANGLE about its anchor', () => {
    const smooth: PenPath = {
      anchors: [{ x: 50, y: 50, hOut: { dx: 10, dy: 0 }, hIn: { dx: -10, dy: 0 }, corner: false }, corner(100, 0)],
      closed: false,
    };
    let s = initialEditState(smooth);
    s = penEditReducer(s, dragStart('hOut', 0, 60, 50));
    s = penEditReducer(s, move(100, 54, { shift: true })); // ~4.6° off horizontal → 0°
    s = penEditReducer(s, up(100, 54));
    expect(s.path.anchors[0].hOut).toEqual({ dx: 50, dy: 0 });
  });

  it('drag-start on a missing handle is a no-op', () => {
    let s = initialEditState(tri()); // corner anchors, no handles
    const next = penEditReducer(s, dragStart('hOut', 1, 100, 0));
    expect(next).toBe(s);
  });
});
