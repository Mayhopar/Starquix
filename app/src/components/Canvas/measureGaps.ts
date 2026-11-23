import type { ElementRect } from '@/bridge';

/** An axis-aligned segment in document px; a gap also carries its length. */
export interface Segment { x1: number; y1: number; x2: number; y2: number }
interface Gap extends Segment { value: number }

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

const transpose = (r: ElementRect): ElementRect => ({ left: r.top, top: r.left, width: r.height, height: r.width });
const flip = <S extends Segment>(s: S): S => ({ ...s, x1: s.y1, y1: s.x1, x2: s.y2, y2: s.x2 });

/** The horizontal lines; measureGaps gets the vertical ones by running this on transposed boxes. */
function horizontal(a: ElementRect, b: ElementRect, intersect: boolean): { gaps: Gap[]; guides: Segment[] } {
  const bx = xs(b), by = ys(b);
  const y = across(ys(a), by);
  const gaps: Gap[] = [];
  const guides: Segment[] = [];
  for (const [from, to] of along(xs(a), bx, intersect)) {
    if (to <= from) continue;
    gaps.push({ x1: from, y1: y.at, x2: to, y2: y.at, value: to - from });
    if (!y.shared) {
      const x = to === bx[0] ? to : from;
      guides.push({ x1: x, y1: by[0] > y.at ? by[0] : by[1], x2: x, y2: y.at });
    }
  }
  return { gaps, guides };
}

/**
 * Figma's Option-hover: distances from the selection `a` to the hovered box `b`.
 * Apart on an axis → one gap line; boxes intersect (incl. one inside the other) →
 * edge-to-edge offsets on both axes. A diagonal line runs through a's centre and a
 * dashed guide extends b's edge to meet it. Zero-length gaps are dropped.
 */
export function measureGaps(a: ElementRect, b: ElementRect): { gaps: Gap[]; guides: Segment[] } {
  const intersect = overlaps(xs(a), xs(b)) && overlaps(ys(a), ys(b));
  const h = horizontal(a, b, intersect);
  const v = horizontal(transpose(a), transpose(b), intersect);
  return { gaps: [...h.gaps, ...v.gaps.map(flip)], guides: [...h.guides, ...v.guides.map(flip)] };
}
