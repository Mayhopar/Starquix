/**
 * svg → PenPath conversion (convert-to-editable-shape, 2026-07-24).
 * The output feeds ADD_DRAWN_ELEMENT and must round-trip through
 * buildPenMarkup exactly like pen-tool shapes.
 */
import { describe, it, expect } from 'vitest';
import { svgToPenShape, pathDToPenPath } from '../svgToPenPath';
import { buildPathD, computeBBox } from '@/components/Canvas/penGeometry';

describe('pathDToPenPath', () => {
  it('parses M/L/Z into corner anchors, closed', () => {
    const p = pathDToPenPath('M 0 0 L 100 0 L 100 100 L 0 100 Z')!;
    expect(p.closed).toBe(true);
    expect(p.anchors).toHaveLength(4);
    expect(p.anchors.every((a) => a.corner)).toBe(true);
  });

  it('parses cubic C into handles', () => {
    const p = pathDToPenPath('M 0 50 C 25 0, 75 0, 100 50')!;
    expect(p.closed).toBe(false);
    expect(p.anchors).toHaveLength(2);
    expect(p.anchors[0].hOut).toEqual({ dx: 25, dy: -50 });
    expect(p.anchors[1].hIn).toEqual({ dx: -25, dy: -50 });
  });

  it('converts quadratic Q to an equivalent cubic', () => {
    const p = pathDToPenPath('M 0 0 Q 50 100 100 0')!;
    expect(p.anchors).toHaveLength(2);
    // cubic c1 = P0 + 2/3(Q-P0)
    expect(p.anchors[0].hOut!.dx).toBeCloseTo(33.33, 1);
    expect(p.anchors[0].hOut!.dy).toBeCloseTo(66.67, 1);
  });

  it('handles relative commands', () => {
    const p = pathDToPenPath('m 10 10 l 90 0 l 0 90 z')!;
    expect(p.anchors.map((a) => [a.x, a.y])).toEqual([[10, 10], [100, 10], [100, 100]]);
    expect(p.closed).toBe(true);
  });

  it('merges the Z-duplicated closing anchor', () => {
    const p = pathDToPenPath('M 0 0 L 100 0 L 100 100 L 0 0 Z')!;
    expect(p.anchors).toHaveLength(3);
  });

  it('rejects arcs', () => {
    expect(pathDToPenPath('M 0 0 A 50 50 0 0 1 100 100')).toBeNull();
  });
});

describe('svgToPenShape', () => {
  const CIRCLE_SVG = '<svg width="96" height="96" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="32" fill="#0066cc"></circle></svg>';

  it('converts a circle into a 4-anchor smooth closed path with the attr fill', () => {
    const conv = svgToPenShape(CIRCLE_SVG)!;
    expect(conv.path.closed).toBe(true);
    expect(conv.path.anchors).toHaveLength(4);
    expect(conv.path.anchors.every((a) => !a.corner && a.hIn && a.hOut)).toBe(true);
    expect(conv.w).toBe(64);
    expect(conv.h).toBe(64);
    expect(conv.styleClasses).toContain('fill-[#0066cc]');
    // renders through the pen pipeline
    expect(buildPathD(conv.path)).toContain('C');
  });

  it('scales viewBox coords to the rendered size', () => {
    const conv = svgToPenShape(CIRCLE_SVG, 192, 192)!;
    expect(conv.w).toBe(128); // r=32 → 64 in a 96 viewBox → ×2
    const bb = computeBBox(conv.path);
    expect(Math.round(bb.w)).toBe(128);
  });

  it('converts rect and polygon to corner anchors', () => {
    const rect = svgToPenShape('<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="60" fill="#333"/></svg>')!;
    expect(rect.path.anchors).toHaveLength(4);
    expect(rect.w).toBe(80);
    expect(rect.h).toBe(60);

    const poly = svgToPenShape('<svg viewBox="0 0 100 100"><polygon points="50,0 100,100 0,100"/></svg>')!;
    expect(poly.path.closed).toBe(true);
    expect(poly.path.anchors).toHaveLength(3);
  });

  it('open shapes with no paint get visible stroke seeds', () => {
    const line = svgToPenShape('<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100"/></svg>')!;
    expect(line.path.closed).toBe(false);
    expect(line.styleClasses).toContain('stroke-');
  });

  it('letterboxed render (h-full svg) scales UNIFORMLY — no stretch', () => {
    // AI card svg: width attr 96, h-full → rendered 96×160; default
    // preserveAspectRatio letterboxes, so the 56px square must stay square.
    const svg = '<svg width="96" height="96" viewBox="0 0 96 96" fill="none" class="h-full"><rect x="20" y="20" width="56" height="56" fill="#0066cc"></rect></svg>';
    const conv = svgToPenShape(svg, 96, 160)!;
    expect(conv.w).toBe(56);
    expect(conv.h).toBe(56);
  });

  it('preserveAspectRatio="none" keeps the stretch', () => {
    const svg = '<svg viewBox="0 0 96 96" preserveAspectRatio="none"><rect x="20" y="20" width="56" height="56"/></svg>';
    const conv = svgToPenShape(svg, 96, 192)!;
    expect(conv.w).toBe(56);
    expect(conv.h).toBe(112);
  });

  it('rejects multi-shape svgs', () => {
    expect(svgToPenShape('<svg viewBox="0 0 10 10"><rect width="5" height="5"/><circle cx="7" cy="7" r="2"/></svg>')).toBeNull();
  });

  it('ignores shapes inside defs/clipPath', () => {
    const conv = svgToPenShape('<svg viewBox="0 0 96 96"><defs><rect width="9" height="9"/></defs><circle cx="48" cy="48" r="32"/></svg>');
    expect(conv).not.toBeNull();
    expect(conv!.path.anchors).toHaveLength(4);
  });
});
