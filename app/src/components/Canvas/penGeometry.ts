export interface PenHandle {
  dx: number;
  dy: number;
}

export interface PenAnchor {
  x: number;
  y: number;
  /** Incoming control handle, relative to the anchor. */
  hIn?: PenHandle | null;
  /** Outgoing control handle, relative to the anchor. */
  hOut?: PenHandle | null;
  corner: boolean;
}

export interface PenPath {
  anchors: PenAnchor[];
  closed: boolean;
  /** Arrow tool: rendered as <marker> decoration, never as anchors (task-109). */
  markerEnd?: 'arrow';
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 2-decimal formatting keeps float session coords compact; integers unchanged. || 0 kills -0. */
export const fmt = (n: number) => Math.round(n * 100) / 100 || 0;

/**
 * Paint-only seed classes (the design-doc seed table). Open: no fill so
 * segments stay visible; closed: light fill. strokeClosed: pen-drawn closed
 * paths keep their stroke, shape-tool closed paths are fill-only.
 */
export function seedPathStyle(closed: boolean, strokeClosed: boolean): string {
  return !closed
    ? 'fill-none stroke-gray-900 stroke-2'
    : strokeClosed
      ? 'fill-gray-200 stroke-gray-900 stroke-2'
      : 'fill-gray-200';
}

/** Wrapper seed classes for a committed path: size + paint seeds. */
export function seedPathClasses(w: number, h: number, closed: boolean, strokeClosed: boolean): string {
  return `w-[${w}px] h-[${h}px] ${seedPathStyle(closed, strokeClosed)}`;
}

/** Cubic-bezier circle constant. */
export const K_CIRCLE = 0.5522847498;

/**
 * Ellipse as 4 smooth anchors with K cubic handles (N/E/S/W) — THE ellipse
 * construction, shared by the shape tool and svg conversion.
 */
export function ellipsePenPath(cx: number, cy: number, rx: number, ry: number): PenPath {
  const kx = K_CIRCLE * rx;
  const ky = K_CIRCLE * ry;
  return {
    closed: true,
    anchors: [
      { x: cx, y: cy - ry, hIn: { dx: -kx, dy: 0 }, hOut: { dx: kx, dy: 0 }, corner: false },
      { x: cx + rx, y: cy, hIn: { dx: 0, dy: -ky }, hOut: { dx: 0, dy: ky }, corner: false },
      { x: cx, y: cy + ry, hIn: { dx: kx, dy: 0 }, hOut: { dx: -kx, dy: 0 }, corner: false },
      { x: cx - rx, y: cy, hIn: { dx: 0, dy: ky }, hOut: { dx: 0, dy: -ky }, corner: false },
    ],
  };
}

/**
 * Structure-preserving anchor map — THE way to transform a PenPath.
 * fnPoint maps absolute anchor positions, fnDelta maps relative handle offsets.
 */
export function mapAnchors(
  path: PenPath,
  fnPoint: (p: { x: number; y: number }) => { x: number; y: number },
  fnDelta: (d: PenHandle) => PenHandle,
): PenPath {
  // Spread the path so non-anchor fields (markerEnd, future additions) survive —
  // reconstructing {anchors, closed} here silently dropped markerEnd once (task-109).
  return {
    ...path,
    anchors: path.anchors.map((a) => ({
      ...a,
      ...fnPoint(a),
      hIn: a.hIn ? fnDelta(a.hIn) : a.hIn,
      hOut: a.hOut ? fnDelta(a.hOut) : a.hOut,
    })),
  };
}

/** Round a path to 2 decimals (session-commit storage form). */
export const roundPath = (path: PenPath): PenPath =>
  mapAnchors(path, (p) => ({ x: fmt(p.x), y: fmt(p.y) }), (d) => ({ dx: fmt(d.dx), dy: fmt(d.dy) }));

function segment(a: PenAnchor, b: PenAnchor): string {
  if (!a.hOut && !b.hIn) return `L ${fmt(b.x)} ${fmt(b.y)}`;
  const c1x = a.x + (a.hOut?.dx ?? 0);
  const c1y = a.y + (a.hOut?.dy ?? 0);
  const c2x = b.x + (b.hIn?.dx ?? 0);
  const c2y = b.y + (b.hIn?.dy ?? 0);
  return `C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(b.x)} ${fmt(b.y)}`;
}

/** SVG path `d` string. Straight L when neither end has a handle, else cubic C. */
export function buildPathD(path: PenPath): string {
  const { anchors, closed } = path;
  if (anchors.length === 0) return '';
  const parts = [`M ${fmt(anchors[0].x)} ${fmt(anchors[0].y)}`];
  for (let i = 1; i < anchors.length; i++) parts.push(segment(anchors[i - 1], anchors[i]));
  if (closed && anchors.length > 1) {
    parts.push(segment(anchors[anchors.length - 1], anchors[0]));
    parts.push('Z');
  }
  return parts.join(' ');
}

/** Bounds over anchors + absolute handle tips (control-polygon bbox; cheap and conservative). */
export function computeBBox(path: PenPath): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const fold = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const a of path.anchors) {
    fold(a.x, a.y);
    if (a.hIn) fold(a.x + a.hIn.dx, a.y + a.hIn.dy);
    if (a.hOut) fold(a.x + a.hOut.dx, a.y + a.hOut.dy);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Translate anchors so the bbox origin is 0,0; keep 2-decimal precision on
 * the drawing (integer snapping visibly nudges anchors at refit); w/h stay
 * integers >= 2 for the wrapper classes (task-106 shape minimums).
 * x/y are the original bbox origin for wrapper placement.
 */
export function normalizePenPath(path: PenPath): { path: PenPath; w: number; h: number; x: number; y: number } {
  const bbox = computeBBox(path);
  return {
    path: mapAnchors(
      path,
      (p) => ({ x: fmt(p.x - bbox.x), y: fmt(p.y - bbox.y) }),
      (d) => ({ dx: fmt(d.dx), dy: fmt(d.dy) }),
    ),
    w: Math.max(2, Math.round(bbox.w)),
    h: Math.max(2, Math.round(bbox.h)),
    x: Math.round(bbox.x),
    y: Math.round(bbox.y),
  };
}

/**
 * Split the segment a→b at the point nearest to `at`.
 * Straight segments project `at` onto the line (the fat hit stroke lets
 * clicks land a few px off — inserting the raw point would kink the line).
 * Curved segments use a de Casteljau split so the rendered curve is
 * UNCHANGED; neighbor handles shrink and the new anchor carries the tangent.
 */
export function splitSegment(
  a: PenAnchor,
  b: PenAnchor,
  at: { x: number; y: number },
): { a: PenAnchor; mid: PenAnchor; b: PenAnchor } {
  if (!a.hOut && !b.hIn) {
    // Straight: project onto the segment.
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0.5 : Math.min(1, Math.max(0, ((at.x - a.x) * vx + (at.y - a.y) * vy) / len2));
    return { a, mid: { x: fmt(a.x + vx * t), y: fmt(a.y + vy * t), corner: true }, b };
  }

  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.x + (a.hOut?.dx ?? 0), y: a.y + (a.hOut?.dy ?? 0) };
  const p2 = { x: b.x + (b.hIn?.dx ?? 0), y: b.y + (b.hIn?.dy ?? 0) };
  const p3 = { x: b.x, y: b.y };
  const bez = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  };
  // Nearest t by sampling + one refinement pass — plenty for a click target.
  let bestT = 0.5;
  let bestD = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const span = pass === 0 ? 1 : 2 / 32;
    const from = pass === 0 ? 0 : Math.max(0, bestT - span / 2);
    for (let i = 0; i <= 32; i++) {
      const t = from + (span * i) / 32;
      if (t > 1) break;
      const p = bez(t);
      const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
  }
  const t = bestT;
  const lerp = (p: { x: number; y: number }, q: { x: number; y: number }) => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
  });
  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const s = lerp(r0, r1);
  const h = (from: { x: number; y: number }, to: { x: number; y: number }): PenHandle | null => {
    const dx = fmt(to.x - from.x);
    const dy = fmt(to.y - from.y);
    return dx === 0 && dy === 0 ? null : { dx, dy };
  };
  return {
    a: { ...a, hOut: h({ x: a.x, y: a.y }, q0) },
    mid: { x: fmt(s.x), y: fmt(s.y), hIn: h(s, r0), hOut: h(s, r1), corner: false },
    b: { ...b, hIn: h({ x: b.x, y: b.y }, q2) },
  };
}

/**
 * Attribute-only SVG for staticMarkup. The <path> carries NO fill/stroke —
 * both inherit from the wrapper's Tailwind fill/stroke classes.
 */
export function buildPenMarkup(path: PenPath, w: number, h: number): string {
  // overflow:visible — during a node-edit session the frame is frozen and
  // anchors may travel outside it; the bezier hull property keeps final
  // (normalized) paths inside their bbox anyway, so this is always safe.
  //
  // Head inherits wrapper stroke-* via DOM-tree CSS inheritance (marker content
  // is inside the same <svg>); stroke-width="2" is marker-unit sizing, not paint.
  // ponytail: fixed marker id — all defs identical, duplicate-id resolution is
  // harmless; make ids per-element if head shape ever varies per element.
  let marker = '';
  let markerRef = '';
  if (path.markerEnd === 'arrow') {
    marker =
      '<defs><marker id="sq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto" markerUnits="strokeWidth"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke-width="2"/></marker></defs>';
    markerRef = ' marker-end="url(#sq-arrow)"';
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" preserveAspectRatio="none" width="100%" height="100%" style="display:block;overflow:visible">` +
    marker +
    `<path d="${buildPathD(path)}" vector-effect="non-scaling-stroke"${markerRef}/></svg>`
  );
}
