import { describe, it, expect } from 'vitest';
import { buildPathD, computeBBox, normalizePenPath, buildPenMarkup, splitSegment, roundPath, type PenPath } from '../penGeometry';

const corner = (x: number, y: number) => ({ x, y, corner: true });

describe('buildPathD', () => {
  it('corner-only open path emits M + L segments', () => {
    const p: PenPath = { anchors: [corner(0, 0), corner(100, 0), corner(100, 50)], closed: false };
    expect(buildPathD(p)).toBe('M 0 0 L 100 0 L 100 50');
  });

  it('closed path appends Z and the closing segment', () => {
    const p: PenPath = { anchors: [corner(0, 0), corner(100, 0), corner(50, 80)], closed: true };
    expect(buildPathD(p)).toMatch(/Z$/);
  });

  it('smooth anchors emit cubic C using hOut of prev and hIn of next (handles are anchor-relative)', () => {
    const p: PenPath = {
      anchors: [
        { x: 0, y: 0, hOut: { dx: 20, dy: 0 }, corner: false },
        { x: 100, y: 100, hIn: { dx: -20, dy: 0 }, corner: false },
      ],
      closed: false,
    };
    expect(buildPathD(p)).toBe('M 0 0 C 20 0, 80 100, 100 100');
  });

  it('missing handle falls back to the anchor point itself', () => {
    const p: PenPath = {
      anchors: [corner(0, 0), { x: 100, y: 0, hIn: { dx: -30, dy: 20 }, corner: false }],
      closed: false,
    };
    expect(buildPathD(p)).toBe('M 0 0 C 0 0, 70 20, 100 0');
  });
});

describe('computeBBox / normalizePenPath', () => {
  it('bbox covers anchors AND handle extremes', () => {
    const p: PenPath = {
      anchors: [
        { x: 10, y: 10, hOut: { dx: -15, dy: 0 }, corner: false }, // handle reaches x=-5
        corner(50, 40),
      ],
      closed: false,
    };
    expect(computeBBox(p)).toEqual({ x: -5, y: 10, w: 55, h: 30 });
  });

  it('normalize translates anchors so bbox origin is 0,0 and returns integer w/h >= 2', () => {
    const p: PenPath = { anchors: [corner(10, 10), corner(110, 10)], closed: false };
    const n = normalizePenPath(p);
    expect(n.path.anchors[0]).toMatchObject({ x: 0, y: 0 });
    expect(n.w).toBe(100);
    expect(n.h).toBe(2); // zero-height path clamps to 2 like task-106 shapes
  });

  it('normalize keeps 2-decimal anchor precision (no integer snapping of the drawing)', () => {
    const p: PenPath = { anchors: [corner(0.4, 0), corner(100.456, 50.789)], closed: false };
    const n = normalizePenPath(p);
    // origin 0.4 → anchor 0 at 0; anchor 1 at 100.06 (2dp), not 100
    expect(n.path.anchors[1].x).toBeCloseTo(100.06, 2);
    expect(n.path.anchors[1].y).toBeCloseTo(50.79, 2);
  });
});

describe('splitSegment', () => {
  it('straight segment: projects the click ONTO the line and inserts a corner', () => {
    const a = corner(0, 0);
    const b = corner(100, 0);
    // click 4px off the line (inside the fat hit stroke)
    const s = splitSegment(a, b, { x: 40, y: 4 });
    expect(s.mid.corner).toBe(true);
    expect(s.mid.x).toBeCloseTo(40, 1);
    expect(s.mid.y).toBeCloseTo(0, 1); // projected, no kink
    expect(s.a).toBe(a); // straight split leaves neighbors untouched
    expect(s.b).toBe(b);
  });

  it('curved segment: de Casteljau split preserves the curve shape', () => {
    // Symmetric arc: split near the top must not change the rendered curve.
    const a = { x: 0, y: 0, hOut: { dx: 30, dy: -40 }, corner: false };
    const b = { x: 100, y: 0, hIn: { dx: -30, dy: -40 }, corner: false };
    const s = splitSegment(a, b, { x: 50, y: -30 }); // near curve apex (t≈0.5)
    // new anchor sits ON the curve near the apex
    expect(s.mid.x).toBeCloseTo(50, 0);
    expect(s.mid.y).toBeCloseTo(-30, 0);
    expect(s.mid.corner).toBe(false);
    // neighbors' handles shorten (t≈0.5 → half length)
    expect(s.a.hOut!.dx).toBeCloseTo(15, 0);
    expect(s.b.hIn!.dx).toBeCloseTo(-15, 0);
    // split point carries symmetric tangent handles
    expect(s.mid.hIn!.dx).toBeCloseTo(-s.mid.hOut!.dx, 0);
  });
});

describe('buildPenMarkup', () => {
  it('emits attribute-only SVG, no fill/stroke attrs, no class=', () => {
    const p: PenPath = { anchors: [corner(0, 0), corner(100, 50)], closed: false };
    const m = buildPenMarkup(p, 100, 50);
    expect(m).toContain('viewBox="0 0 100 50"');
    expect(m).toContain('preserveAspectRatio="none"');
    expect(m).toContain('<path d="');
    expect(m).not.toContain('fill=');
    expect(m).not.toContain('stroke=');
    expect(m).not.toContain('class=');
    expect(m).toContain('vector-effect="non-scaling-stroke"');
  });

  it('svg overflow is visible so mid-edit anchors outside the frame still paint', () => {
    const p: PenPath = { anchors: [corner(0, 0), corner(100, 50)], closed: false };
    expect(buildPenMarkup(p, 100, 50)).toContain('overflow:visible');
  });
});

describe('buildPathD float formatting', () => {
  it('trims float coords to 2 decimals; integers stay integers', () => {
    const p: PenPath = { anchors: [corner(0.333333, 0), corner(99.999999, 50)], closed: false };
    expect(buildPathD(p)).toBe('M 0.33 0 L 100 50');
  });
});

describe('markerEnd preservation', () => {
  const arrow: PenPath = {
    anchors: [{ x: 10.123, y: 10, corner: true }, { x: 110, y: 60, corner: true }],
    closed: false,
    markerEnd: 'arrow',
  };

  it('normalizePenPath preserves markerEnd', () => {
    expect(normalizePenPath(arrow).path.markerEnd).toBe('arrow');
  });

  it('roundPath preserves markerEnd', () => {
    expect(roundPath(arrow).markerEnd).toBe('arrow');
  });

  it('absent markerEnd stays absent', () => {
    const p: PenPath = { anchors: arrow.anchors, closed: false };
    expect('markerEnd' in normalizePenPath(p).path).toBe(false);
  });
});

describe('buildPenMarkup marker', () => {
  const arrow: PenPath = {
    anchors: [{ x: 0, y: 0, corner: true }, { x: 100, y: 50, corner: true }],
    closed: false,
    markerEnd: 'arrow',
  };

  it('emits defs/marker + marker-end for markerEnd:arrow', () => {
    const m = buildPenMarkup(arrow, 100, 50);
    expect(m).toContain('<defs><marker id="sq-arrow"');
    expect(m).toContain('orient="auto"');
    expect(m).toContain('markerUnits="strokeWidth"');
    expect(m).toContain('marker-end="url(#sq-arrow)"');
  });

  it('no marker without markerEnd', () => {
    const m = buildPenMarkup({ anchors: arrow.anchors, closed: false }, 100, 50);
    expect(m).not.toContain('<marker');
    expect(m).not.toContain('marker-end');
  });

  it('no paint-color attributes anywhere (task-107 law)', () => {
    const m = buildPenMarkup(arrow, 100, 50);
    expect(m).not.toMatch(/(?:fill|stroke)="(?!none)[^"]*"/); // fill="none" is the only allowed paint attr
    expect(m).not.toContain('currentColor');
  });
});
