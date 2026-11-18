import { describe, it, expect } from 'vitest';
import { buildShape, SHAPE_KINDS } from '../shapeMarkup';
import type { PenPath } from '../penGeometry';

const parse = (r: { penPath: string }): PenPath => JSON.parse(r.penPath);

describe('buildShape (universal vector model, task-109)', () => {
  it('rect: 4 corner anchors, closed, fill seed', () => {
    const r = buildShape('rect', 120, 80, false);
    const p = parse(r);
    expect(p.anchors).toEqual([
      { x: 0, y: 0, corner: true },
      { x: 120, y: 0, corner: true },
      { x: 120, y: 80, corner: true },
      { x: 0, y: 80, corner: true },
    ]);
    expect(p.closed).toBe(true);
    expect(r.classes).toBe('w-[120px] h-[80px] fill-gray-200');
    expect(r.staticMarkup).toContain('viewBox="0 0 120 80"');
  });

  it('ellipse: 4 smooth anchors with k-handles', () => {
    const p = parse(buildShape('ellipse', 200, 100, false));
    const k = 0.5522847498;
    expect(p.anchors).toHaveLength(4);
    expect(p.closed).toBe(true);
    for (const a of p.anchors) expect(a.corner).toBe(false);
    // jsdom -0 gotcha: use toBeCloseTo, never toEqual, on mirrored handles
    expect(p.anchors[0].x).toBeCloseTo(100, 1);
    expect(p.anchors[0].y).toBe(0);
    expect(p.anchors[0].hOut!.dx).toBeCloseTo(k * 100, 1);
    expect(p.anchors[0].hOut!.dy).toBeCloseTo(0, 5);
    expect(p.anchors[0].hIn!.dx).toBeCloseTo(-k * 100, 1);
  });

  it('line: 2 corner anchors on drag diagonal, open; downSlope flips', () => {
    const down = parse(buildShape('line', 200, 50, true));
    expect(down.anchors).toEqual([
      { x: 0, y: 0, corner: true },
      { x: 200, y: 50, corner: true },
    ]);
    expect(down.closed).toBe(false);
    const up = parse(buildShape('line', 200, 50, false));
    expect(up.anchors[0]).toEqual({ x: 0, y: 50, corner: true });
    expect(up.anchors[1]).toEqual({ x: 200, y: 0, corner: true });
  });

  it('arrow: line + markerEnd, marker in markup', () => {
    const r = buildShape('arrow', 200, 50, true);
    expect(parse(r).markerEnd).toBe('arrow');
    expect(r.staticMarkup).toContain('marker-end="url(#sq-arrow)"');
  });

  it('line/arrow seed open-path classes', () => {
    for (const kind of ['line', 'arrow'] as const) {
      expect(buildShape(kind, 200, 50, true).classes).toBe('w-[200px] h-[50px] fill-none stroke-gray-900 stroke-2');
    }
  });

  it('polygon: hexagon scaled to w×h, closed corners', () => {
    const p = parse(buildShape('polygon', 200, 100, false));
    expect(p.anchors).toEqual([
      { x: 50, y: 0, corner: true },
      { x: 150, y: 0, corner: true },
      { x: 200, y: 50, corner: true },
      { x: 150, y: 100, corner: true },
      { x: 50, y: 100, corner: true },
      { x: 0, y: 50, corner: true },
    ]);
    expect(p.closed).toBe(true);
  });

  it('every kind: penPath + markup present, no currentColor/text-*, no paint-color attrs', () => {
    for (const k of SHAPE_KINDS) {
      const r = buildShape(k, 100, 100, true);
      expect(r.penPath).toBeTruthy();
      expect(r.staticMarkup).toContain('<path d=');
      expect(r.staticMarkup).not.toContain('currentColor');
      expect(r.classes).not.toMatch(/(?:^| )text-/);
      expect(r.staticMarkup).not.toMatch(/(?:fill|stroke)="(?!none)[^"]*"/);
    }
  });
});
