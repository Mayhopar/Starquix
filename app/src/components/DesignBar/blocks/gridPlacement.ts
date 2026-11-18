/**
 * Pure grid-child placement helpers for the DesignBar Layout block.
 *
 * The DesignBar models grid placement as **Start + Span** (Tailwind-idiomatic,
 * matches the canonical `normalizeGridClasses` form). `deriveAxisPlacement`
 * reads the display values for one axis; `buildAxisClasses` writes them back.
 *
 * BUG-B fix: explicit Tailwind classes win, but when a child is placed by
 * `col-span-N` (no explicit start) or auto-flow, we fall back to the rendered
 * cell from the bridge `GRID_GEOMETRY_RESPONSE` so the inputs are never
 * spuriously empty. Mirrors ViewportFrame's geometry fallback (ViewportFrame.tsx
 * ~1409-1411).
 */
import { GRID_COL_PLACEMENT_RE, GRID_ROW_PLACEMENT_RE, FIXED_W_RE, FIXED_H_RE } from '@/utils/gridGeometry';

export type GridAxis = 'col' | 'row';

export interface AxisGeometry {
  /** 1-based rendered start track from bridge geometry, or null if unknown */
  renderedStart: number | null;
  /** rendered span from bridge geometry, or null if unknown */
  renderedSpan: number | null;
  /** parent track count (cols or rows); 0 if unknown */
  parentSize: number;
  /** true when parentSize came from live grid geometry (gate passed), not a class fallback that may be the wrong breakpoint */
  sizeIsExact: boolean;
}

export interface AxisPlacement {
  /** display value for the Start input ('' only when truly unknown) */
  start: string;
  /** display value for the Span input ('' only when truly unknown) */
  span: string;
}

/**
 * Pre-compiled per-axis token patterns (avoid rebuilding RegExp on every call/keystroke).
 * Unanchored is safe here: the DesignBar hands this module the breakpoint-RESOLVED
 * slot string (prefix-free — see DesignBar.tsx getEffectiveClasses), never the raw
 * serialized class string with md:/lg: prefixes.
 */
const AXIS_RE = {
  col: { start: /col-start-(\d+)/, end: /col-end-(\d+)/, span: /col-span-(\d+)/, full: 'col-span-full' },
  row: { start: /row-start-(\d+)/, end: /row-end-(\d+)/, span: /row-span-(\d+)/, full: 'row-span-full' },
} as const;

/** Placement + fixed-size grammar per axis, shared with writeGridPlacement (single source). */
const AXIS_TOKEN_RE = {
  col: { placement: GRID_COL_PLACEMENT_RE, fixedSize: FIXED_W_RE },
  row: { placement: GRID_ROW_PLACEMENT_RE, fixedSize: FIXED_H_RE },
} as const;

/** The explicit numeric value of a col/row start|span class, or null if absent (no geometry fallback). */
export function extractExplicitAxisValue(classes: string, axis: GridAxis, field: 'start' | 'span'): number | null {
  const m = classes.match(AXIS_RE[axis][field]);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Derive the Start + Span display values for one grid axis.
 * Explicit Tailwind classes win; otherwise fall back to the rendered cell.
 */
export function deriveAxisPlacement(classes: string, axis: GridAxis, geo: AxisGeometry): AxisPlacement {
  const re = AXIS_RE[axis];
  const endMatch = classes.match(re.end);
  const spanMatch = classes.match(re.span);
  const spanFull = classes.split(/\s+/).filter(Boolean).includes(re.full);

  // Start: explicit class, else rendered cell start.
  const explicitStart = extractExplicitAxisValue(classes, axis, 'start');
  const startNum = explicitStart ?? geo.renderedStart;

  // Span: explicit span > full > end−start > rendered span.
  let spanNum: number | null = null;
  if (spanMatch) spanNum = parseInt(spanMatch[1], 10);
  else if (spanFull && geo.parentSize > 0) spanNum = startNum ? geo.parentSize - startNum + 1 : geo.parentSize;
  else if (endMatch && explicitStart != null) spanNum = parseInt(endMatch[1], 10) - explicitStart;
  else spanNum = geo.renderedSpan;

  return {
    start: startNum != null ? String(startNum) : '',
    span: spanNum != null ? String(spanNum) : '',
  };
}

/**
 * Build the canonical Tailwind tokens for one axis from a Start + Span placement.
 * Span is clamped to the grid bound when both start and parentSize are known.
 * A bare span of 1 with no explicit start emits nothing (auto/default placement).
 */
export function buildAxisClasses(
  axis: GridAxis,
  placement: { start: number | null; span: number | null },
  parentSize: number,
): string[] {
  const out: string[] = [];
  const start = placement.start;
  if (start != null && start >= 1) out.push(`${axis}-start-${start}`);
  let span = placement.span;
  if (span != null && parentSize > 0) {
    // clamp to the grid bound: from start when known, else the track count
    span = Math.max(1, Math.min(span, start != null ? parentSize - start + 1 : parentSize));
  }
  if (span != null && span > 1) out.push(`${axis}-span-${span}`);
  return out;
}

/**
 * A grid-child Start/Span input edit applied to one resolved class string.
 * The DesignBar itself writes `axisEditTokens` (below, same rules) on the
 * canvas's breakpoint layer; this string form serves a host without one.
 * Returns the new class string, or null only for non-numeric junk (a rejected
 * edit writes nothing). Out-of-range numerics CLAMP to [1, bound] instead of
 * silently no-oping (task-094 B1) — callers commit on blur/Enter, so transient
 * keystrokes never reach this funnel.
 *
 * Rules (task-090 review):
 * - A START edit is a position change: it preserves the DISPLAYED span
 *   (explicit col-span-N, col-end conversion, col-span-full conversion, or
 *   the rendered geometry span) and never touches fixed w-/h- sizes.
 * - A SPAN edit is a size change: column-first sizing strips the conflicting
 *   fixed width/height, and never materializes a start (auto stays auto).
 * - CLEARING start keeps only the class-derived span (no geometry write-back).
 */
export function buildAxisEdit(
  classes: string,
  axis: GridAxis,
  field: 'start' | 'span',
  value: string,
  geo: AxisGeometry,
): string | null {
  const edit = axisEditTokens(classes, axis, field, value, geo);
  if (!edit) return null;
  const { placement, fixedSize } = AXIS_TOKEN_RE[axis];
  const kept = classes.split(/\s+/).filter(Boolean).filter(
    (t) => !placement.test(t) && !(edit.stripsFixedSize && fixedSize.test(t)),
  );
  return [...kept, ...edit.tokens].join(' ');
}

/**
 * What a Start/Span edit asks for on one axis: its prefix-free tokens and
 * whether it is a size write. Null for non-numeric junk. The DesignBar hands
 * these to the shared `writeGridPlacement` on the canvas's breakpoint layer.
 */
export function axisEditTokens(
  classes: string,
  axis: GridAxis,
  field: 'start' | 'span',
  value: string,
  geo: AxisGeometry,
): { tokens: string[]; stripsFixedSize: boolean } | null {
  const trimmed = value.trim().toLowerCase();
  const isClear = trimmed === '' || trimmed === 'auto';
  // Bound: trust the parent count only when it came from live geometry.
  // A class-derived count resolved at the active breakpoint is NOT a valid
  // bound (B1: grid-cols-1 md:grid-cols-6 at xs gave bound=1). Fallback: 12.
  const bound = geo.sizeIsExact && geo.parentSize > 0 ? geo.parentSize : 12;
  let num: number | null = null;
  if (!isClear) {
    if (!/^\d+$/.test(trimmed)) return null; // junk input → reject, don't treat as clear
    num = Math.min(Math.max(parseInt(trimmed, 10), 1), bound); // clamp, never silently reject numerics
  }

  const explicitStart = extractExplicitAxisValue(classes, axis, 'start');
  // Span derived from classes only (span-N, end−start, full via parentSize) — no geometry.
  const re = AXIS_RE[axis];
  const endMatch = classes.match(re.end);
  const spanMatch = classes.match(re.span);
  const spanFull = classes.split(/\s+/).includes(re.full);
  let classSpan: number | null = null;
  if (spanMatch) classSpan = parseInt(spanMatch[1], 10);
  else if (spanFull && geo.parentSize > 0) classSpan = explicitStart ? geo.parentSize - explicitStart + 1 : geo.parentSize;
  else if (endMatch && explicitStart != null) classSpan = parseInt(endMatch[1], 10) - explicitStart;

  let start: number | null;
  let span: number | null;
  if (field === 'start') {
    start = num;
    // Pinning a start materializes the span the user SEES (incl. geometry);
    // clearing it keeps only what the classes themselves say.
    span = num != null ? (classSpan ?? geo.renderedSpan) : classSpan;
  } else {
    start = explicitStart; // never materialize a start from geometry
    span = num;
  }

  // Write with the same effective bound: a non-exact parentSize=1 would make
  // buildAxisClasses clamp any span back to 1 → token elided → span destroyed.
  return { tokens: buildAxisClasses(axis, { start, span }, bound), stripsFixedSize: field === 'span' && num != null };
}
