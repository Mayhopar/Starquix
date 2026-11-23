import type { ElementRect } from '@/bridge';

/** An axis-aligned segment in document px; a gap also carries its length. */
export interface Segment { x1: number; y1: number; x2: number; y2: number }
export interface Gap extends Segment { value: number }

type Span = [number, number];
const xs = (r: ElementRect): Span => [r.left, r.left + r.width];
const ys = (r: ElementRect): Span => [r.top, r.top + r.height];
const overlaps = (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];

/** Gap segments along one axis: the space between the boxes, or — when they intersect — the edge-to-edge offsets. */
function along(a: Span, b: Span, intersect: boolean): Span[] {
  if (a[1] <= b[0]) return [[a[1], b[0]]];
  if (b[1] <= a[0]) return [[b[1], a[0]]];
  if (!intersect) return [];
  return [
    [Math.min(a[0], b[0]), Math.max(a[0], b[0])],
    [Math.min(a[1], b[1]), Math.max(a[1], b[1])],
  ];
}

/** Where a line crosses the other axis: mid of the shared span, else mid of `a` (diagonal — needs a guide). */
function across(a: Span, b: Span): { at: number; shared: boolean } {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo < hi ? { at: (lo + hi) / 2, shared: true } : { at: (a[0] + a[1]) / 2, shared: false };
}

/**
 * Figma's Option-hover: distances from the selection `a` to the hovered box `b`.
 * Apart on an axis → one gap line; boxes intersect (incl. one inside the other) →
 * edge-to-edge offsets on both axes. A diagonal line runs through a's centre and a
 * dashed guide extends b's edge to meet it. Zero-length gaps are dropped.
 */
export function measureGaps(a: ElementRect, b: ElementRect): { gaps: Gap[]; guides: Segment[] } {
  const ax = xs(a), bx = xs(b), ay = ys(a), by = ys(b);
  const intersect = overlaps(ax, bx) && overlaps(ay, by);
  const gaps: Gap[] = [];
  const guides: Segment[] = [];

  const y = across(ay, by);
  for (const [from, to] of along(ax, bx, intersect)) {
    if (to <= from) continue;
    gaps.push({ x1: from, y1: y.at, x2: to, y2: y.at, value: to - from });
    if (!y.shared) {
      const x = to === bx[0] ? to : from;
      guides.push({ x1: x, y1: by[0] > y.at ? by[0] : by[1], x2: x, y2: y.at });
    }
  }

  const x = across(ax, bx);
  for (const [from, to] of along(ay, by, intersect)) {
    if (to <= from) continue;
    gaps.push({ x1: x.at, y1: from, x2: x.at, y2: to, value: to - from });
    if (!x.shared) {
      const yEdge = to === by[0] ? to : from;
      guides.push({ x1: bx[0] > x.at ? bx[0] : bx[1], y1: yEdge, x2: x.at, y2: yEdge });
    }
  }

  return { gaps, guides };
}
