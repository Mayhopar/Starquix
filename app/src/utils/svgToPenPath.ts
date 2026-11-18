/**
 * Convert a static inline <svg> (AI-generated card art, pasted markup) into
 * the editor's PenPath model so it becomes a REAL pen shape — node editing,
 * PenStyleBlock, persistence, export all reuse the existing pen system
 * (never a parallel editor — see parity rule).
 *
 * v1 scope: the FIRST geometry child of the svg — path (M/L/H/V/C/S/Q/T/Z,
 * absolute + relative; first subpath only), circle, ellipse, rect (rx
 * ignored), polygon, polyline, line. Arcs (A/a) and multi-shape svgs return
 * null → caller shows "can't convert" feedback.
 */
// ui-lint-exempt: generates user-document classes (fill-[#hex] etc.), not app chrome
import type { PenPath, PenAnchor } from '@/components/Canvas/penGeometry';
import { ellipsePenPath, mapAnchors, normalizePenPath, seedPathStyle, fmt } from '@/components/Canvas/penGeometry';

export interface SvgConversion {
  /** Normalized to bbox origin 0,0 — wrapper-space px, ready for ADD_DRAWN_ELEMENT. */
  path: PenPath;
  w: number;
  h: number;
  /** Wrapper style classes derived from the shape's fill/stroke attrs. */
  styleClasses: string;
}

// --- path `d` parsing -------------------------------------------------------

function tokenizeD(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MmLlHhVvCcSsQqTtZzAa])|(-?\d*\.?\d+(?:e[+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) out.push(m[1] ?? parseFloat(m[2]));
  return out;
}

/** First subpath of a path `d` → PenPath in the svg's viewBox coordinates. Null on A/a or malformed input. */
export function pathDToPenPath(d: string): PenPath | null {
  const toks = tokenizeD(d);
  if (toks.length === 0 || toks[0] !== 'M' && toks[0] !== 'm') return null;

  const anchors: PenAnchor[] = [];
  let closed = false;
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  // Reflection state for S/T continuations. Object holder, not `let`s —
  // TS control-flow narrowing can't see closure writes and typed the truthy
  // branch as `never`.
  const refl: { c2: { x: number; y: number } | null; q: { x: number; y: number } | null } = { c2: null, q: null };

  const num = (): number | null => (typeof toks[i] === 'number' ? (toks[i++] as number) : null);
  const last = (): PenAnchor => anchors[anchors.length - 1];
  const pushCorner = (x: number, y: number) => anchors.push({ x, y, corner: true });
  const setCubic = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    const from = last();
    const hOut = { dx: fmt(c1x - from.x), dy: fmt(c1y - from.y) };
    if (hOut.dx !== 0 || hOut.dy !== 0) { from.hOut = hOut; from.corner = false; }
    const hIn = { dx: fmt(c2x - x), dy: fmt(c2y - y) };
    anchors.push({ x, y, hIn: hIn.dx !== 0 || hIn.dy !== 0 ? hIn : null, corner: false });
    refl.c2 = { x: c2x, y: c2y };
    refl.q = null;
  };
  const quadToCubic = (qx: number, qy: number, x: number, y: number) => {
    const from = last();
    setCubic(
      from.x + (2 / 3) * (qx - from.x), from.y + (2 / 3) * (qy - from.y),
      x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
      x, y,
    );
    refl.q = { x: qx, y: qy };
  };

  while (i < toks.length) {
    if (typeof toks[i] === 'string') cmd = toks[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'A') return null; // arcs unsupported (v1)

    if (C === 'Z') {
      closed = true;
      break; // first subpath only
    }

    if (C === 'M') {
      const x = num(); const y = num();
      if (x === null || y === null) return null;
      if (anchors.length > 0) break; // second subpath — stop
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      pushCorner(cx, cy);
      cmd = rel ? 'l' : 'L'; // subsequent implicit pairs are lineto
      refl.c2 = null; refl.q = null;
      continue;
    }
    if (C === 'L') {
      const x = num(); const y = num();
      if (x === null || y === null) return null;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      pushCorner(cx, cy);
      refl.c2 = null; refl.q = null;
      continue;
    }
    if (C === 'H') {
      const x = num(); if (x === null) return null;
      cx = rel ? cx + x : x;
      pushCorner(cx, cy);
      refl.c2 = null; refl.q = null;
      continue;
    }
    if (C === 'V') {
      const y = num(); if (y === null) return null;
      cy = rel ? cy + y : y;
      pushCorner(cx, cy);
      refl.c2 = null; refl.q = null;
      continue;
    }
    if (C === 'C') {
      const c1x = num(); const c1y = num(); const c2x = num(); const c2y = num(); const x = num(); const y = num();
      if (y === null || c1x === null || c1y === null || c2x === null || c2y === null || x === null) return null;
      const a1x = rel ? cx + c1x : c1x; const a1y = rel ? cy + c1y : c1y;
      const a2x = rel ? cx + c2x : c2x; const a2y = rel ? cy + c2y : c2y;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      setCubic(a1x, a1y, a2x, a2y, cx, cy);
      continue;
    }
    if (C === 'S') {
      const c2x = num(); const c2y = num(); const x = num(); const y = num();
      if (y === null || c2x === null || c2y === null || x === null) return null;
      const rc2 = refl.c2;
      const c1 = rc2 ? { x: 2 * cx - rc2.x, y: 2 * cy - rc2.y } : { x: cx, y: cy };
      const a2x = rel ? cx + c2x : c2x; const a2y = rel ? cy + c2y : c2y;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      setCubic(c1.x, c1.y, a2x, a2y, cx, cy);
      continue;
    }
    if (C === 'Q') {
      const qx = num(); const qy = num(); const x = num(); const y = num();
      if (y === null || qx === null || qy === null || x === null) return null;
      const aqx = rel ? cx + qx : qx; const aqy = rel ? cy + qy : qy;
      const nx = rel ? cx + x : x; const ny = rel ? cy + y : y;
      cx = nx; cy = ny;
      quadToCubic(aqx, aqy, nx, ny);
      continue;
    }
    if (C === 'T') {
      const x = num(); const y = num();
      if (x === null || y === null) return null;
      const rq = refl.q;
      const q = rq ? { x: 2 * cx - rq.x, y: 2 * cy - rq.y } : { x: cx, y: cy };
      const nx = rel ? cx + x : x; const ny = rel ? cy + y : y;
      cx = nx; cy = ny;
      quadToCubic(q.x, q.y, nx, ny);
      continue;
    }
    return null; // unknown command
  }

  if (anchors.length < 2) return null;
  // Closed path whose last anchor duplicates the first: merge (keep first's
  // position, adopt the duplicate's incoming handle) so Z doesn't add a node.
  if (closed) {
    const a0 = anchors[0];
    const aN = anchors[anchors.length - 1];
    if (Math.abs(a0.x - aN.x) < 0.01 && Math.abs(a0.y - aN.y) < 0.01) {
      if (aN.hIn) { a0.hIn = aN.hIn; a0.corner = false; }
      anchors.pop();
    }
  }
  if (anchors.length < 2) return null;
  return { anchors, closed };
}

// --- primitive shapes -------------------------------------------------------

function pointsToPenPath(pointsAttr: string, closed: boolean): PenPath | null {
  const nums = (pointsAttr.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/g) || []).map(Number);
  if (nums.length < 4) return null;
  const anchors: PenAnchor[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) anchors.push({ x: nums[i], y: nums[i + 1], corner: true });
  return { anchors, closed };
}

// --- entry point -------------------------------------------------------------

const GEOMETRY_TAGS = ['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'];

/**
 * svg outerHTML → normalized PenPath + wrapper size/classes.
 * `renderedW/H` (the element's on-canvas size) scales viewBox coords to px;
 * falls back to the svg's width/height attrs, then the viewBox itself.
 */
export function svgToPenShape(svgMarkup: string, renderedW?: number, renderedH?: number): SvgConversion | null {
  const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const svg = parsed.querySelector('svg');
  if (!svg || parsed.querySelector('parsererror')) return null;

  const shapes = Array.from(svg.querySelectorAll(GEOMETRY_TAGS.join(','))).filter(
    (n) => !n.closest('defs, clipPath, mask, marker'),
  );
  if (shapes.length !== 1) return null; // multi-shape svgs unsupported (v1)
  const node = shapes[0];
  const tag = node.tagName.toLowerCase();
  const attr = (el: Element, name: string): number => parseFloat(el.getAttribute(name) || '0') || 0;

  let raw: PenPath | null = null;
  if (tag === 'path') raw = pathDToPenPath(node.getAttribute('d') || '');
  else if (tag === 'circle') raw = ellipsePenPath(attr(node, 'cx'), attr(node, 'cy'), attr(node, 'r'), attr(node, 'r'));
  else if (tag === 'ellipse') raw = ellipsePenPath(attr(node, 'cx'), attr(node, 'cy'), attr(node, 'rx'), attr(node, 'ry'));
  else if (tag === 'rect') {
    const x = attr(node, 'x'); const y = attr(node, 'y'); const w = attr(node, 'width'); const h = attr(node, 'height');
    if (w <= 0 || h <= 0) return null;
    raw = { closed: true, anchors: [
      { x, y, corner: true }, { x: x + w, y, corner: true },
      { x: x + w, y: y + h, corner: true }, { x, y: y + h, corner: true },
    ] };
  } else if (tag === 'polygon') raw = pointsToPenPath(node.getAttribute('points') || '', true);
  else if (tag === 'polyline') raw = pointsToPenPath(node.getAttribute('points') || '', false);
  else if (tag === 'line') {
    raw = { closed: false, anchors: [
      { x: attr(node, 'x1'), y: attr(node, 'y1'), corner: true },
      { x: attr(node, 'x2'), y: attr(node, 'y2'), corner: true },
    ] };
  }
  if (!raw) return null;

  // viewBox → rendered px scale.
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(svg.getAttribute('width') || '0') || 0;
  const vbH = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(svg.getAttribute('height') || '0') || 0;
  const vbX = vb.length === 4 ? vb[0] : 0;
  const vbY = vb.length === 4 ? vb[1] : 0;
  const outW = renderedW || parseFloat(svg.getAttribute('width') || '0') || vbW;
  const outH = renderedH || parseFloat(svg.getAttribute('height') || '0') || vbH;
  let sx = vbW > 0 && outW > 0 ? outW / vbW : 1;
  let sy = vbH > 0 && outH > 0 ? outH / vbH : 1;
  // preserveAspectRatio: the default (xMidYMid meet) letterboxes — the glyph
  // scales UNIFORMLY to fit (e.g. an AI `h-full` svg renders 96×160 but the
  // square inside stays square). Non-uniform sx/sy here would bake that
  // stretch into the converted shape. Only "none" stretches; "slice" fills.
  const par = (svg.getAttribute('preserveAspectRatio') || '').trim();
  if (par !== 'none' && vbW > 0 && vbH > 0) {
    const s = /\bslice\b/.test(par) ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = s; sy = s;
  }
  const scaled = mapAnchors(
    raw,
    (p) => ({ x: (p.x - vbX) * sx, y: (p.y - vbY) * sy }),
    (dl) => ({ dx: dl.dx * sx, dy: dl.dy * sy }),
  );

  const { path, w, h } = normalizePenPath(scaled);

  // Style: shape attrs win over svg attrs. When neither attr paints, fall back
  // to the standard pen seed paints (single source: penGeometry seedPathStyle).
  const fill = node.getAttribute('fill') ?? svg.getAttribute('fill');
  const stroke = node.getAttribute('stroke') ?? svg.getAttribute('stroke');
  const hasFill = !!fill && fill !== 'none';
  const hasStroke = !!stroke && stroke !== 'none';
  let styleClasses: string;
  if (!hasFill && !hasStroke) {
    styleClasses = seedPathStyle(path.closed, false); // invisible otherwise
  } else {
    const parts = [hasFill ? `fill-[${fill}]` : 'fill-none'];
    // ponytail: attr stroke-width → stroke-2; refine if it ever matters
    if (hasStroke) parts.push(`stroke-[${stroke}]`, 'stroke-2');
    styleClasses = parts.join(' ');
  }

  return { path, w, h, styleClasses };
}
