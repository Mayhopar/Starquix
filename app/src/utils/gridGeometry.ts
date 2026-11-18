import type { GridGeometry, EditorCommand } from '@/store/types';

/** Returns the track index at `position`, or -1 if in a gap or out of bounds. */
export function findTrack(position: number, tracks: number[], gap: number): number {
  let offset = 0;
  for (let i = 0; i < tracks.length; i++) {
    if (position >= offset && position < offset + tracks[i]) {
      return i;
    }
    offset += tracks[i] + gap;
  }
  return -1;
}

/** Rect of a grid cell (or multi-span cell) relative to the container's top-left. */
export function getCellRect(
  geometry: GridGeometry,
  col: number,
  row: number,
  colSpan = 1,
  rowSpan = 1,
): { left: number; top: number; width: number; height: number } {
  let left = 0;
  for (let c = 0; c < col; c++) {
    left += geometry.columns[c] + geometry.columnGap;
  }

  let top = 0;
  for (let r = 0; r < row; r++) {
    top += geometry.rows[r] + geometry.rowGap;
  }

  let width = 0;
  for (let c = col; c < col + colSpan; c++) {
    width += geometry.columns[c];
    if (c > col) width += geometry.columnGap;
  }

  let height = 0;
  for (let r = row; r < row + rowSpan; r++) {
    height += geometry.rows[r];
    if (r > row) height += geometry.rowGap;
  }

  return { left, top, width, height };
}

/** Manhattan distance <= 1. */
export function isAdjacentCell(
  col1: number, row1: number,
  col2: number, row2: number,
): boolean {
  return Math.abs(col1 - col2) + Math.abs(row1 - row2) <= 1;
}

/** Returns { col, row } at the given position, or null if in a gap or out of bounds. */
export function findCell(
  geometry: GridGeometry,
  x: number,
  y: number,
): { col: number; row: number } | null {
  const col = findTrack(x, geometry.columns, geometry.columnGap);
  const row = findTrack(y, geometry.rows, geometry.rowGap);
  if (col === -1 || row === -1) return null;
  return { col, row };
}

/** Clamp a target cell so [col, col+colSpan) x [row, row+rowSpan) stays inside rendered tracks. */
export function clampCellToSpan(
  geo: { columns: number[]; rows: number[] },
  cell: { col: number; row: number },
  colSpan: number,
  rowSpan: number,
): { col: number; row: number } {
  return {
    col: Math.max(0, Math.min(cell.col, geo.columns.length - colSpan)),
    row: Math.max(0, Math.min(cell.row, geo.rows.length - rowSpan)),
  };
}

/** Index of the track whose start is nearest to `position` (twin of `nearestTrack` in bridge/parts/geometry.ts — bridge parts cannot import). */
function nearestTrackStart(position: number, tracks: number[], gap: number): number {
  let best = 0, bestDistance = Infinity, offset = 0;
  tracks.forEach((size, i) => {
    const distance = Math.abs(position - offset);
    if (distance < bestDistance) { bestDistance = distance; best = i; }
    offset += size + gap;
  });
  return best;
}

/**
 * The cell a dragged grid child lands in: the one nearest to where its OWN
 * top-left corner now is (its cell plus the cursor's travel) — not the cell
 * under the cursor, which puts a wide card grabbed in its middle a column over.
 */
export function dragTargetCell(
  geo: GridGeometry,
  dragged: { col: number; row: number; colSpan: number; rowSpan: number },
  travelX: number,
  travelY: number,
): { col: number; row: number } {
  const from = getCellRect(geo, dragged.col, dragged.row);
  return clampCellToSpan(geo, {
    col: nearestTrackStart(from.left + travelX, geo.columns, geo.columnGap),
    row: nearestTrackStart(from.top + travelY, geo.rows, geo.rowGap),
  }, dragged.colSpan, dragged.rowSpan);
}

/**
 * The measured grid, when `key` is one of its cells; null otherwise. The one
 * answer to "is the selection a grid child" for canvas snapping: it holds for
 * a Layers-panel selection too, and a grid left over from the last selection
 * never applies to another element.
 */
export function gridOfChild(geo: GridGeometry | null, key: string | null): GridGeometry | null {
  return geo && key && geo.cells.some(c => c.key === key) ? geo : null;
}

/** Pixel positions where gaps start between tracks. */
export function getGapPositions(tracks: number[], gap: number): number[] {
  const positions: number[] = [];
  let offset = 0;
  for (let i = 0; i < tracks.length; i++) {
    offset += tracks[i];
    if (i < tracks.length - 1) {
      positions.push(offset);
      offset += gap;
    }
  }
  return positions;
}

/** Total size of a track list including gaps. */
export function getTrackTotal(tracks: number[], gap: number): number {
  if (tracks.length === 0) return 0;
  return tracks.reduce((sum, size) => sum + size, 0) + (tracks.length - 1) * gap;
}

/** Snap threshold in iframe pixels. */
const GRID_SNAP_THRESHOLD = 20;

/** Cumulative boundary positions for a slice of tracks (right/bottom edge of each track). */
export function getTrackBoundaries(tracks: number[], gap: number, from: number, to: number): number[] {
  const boundaries: number[] = [];
  let offset = 0;
  for (let i = from; i < to && i < tracks.length; i++) {
    offset += tracks[i];
    boundaries.push(offset);
    offset += gap;
  }
  return boundaries;
}

/** Snap size to the nearest boundary within GRID_SNAP_THRESHOLD, or return as-is. */
export function snapToNearestBoundary(size: number, boundaries: number[]): number {
  let bestDist = GRID_SNAP_THRESHOLD;
  let bestSnap = size;
  for (const boundary of boundaries) {
    const dist = Math.abs(size - boundary);
    if (dist < bestDist) {
      bestDist = dist;
      bestSnap = boundary;
    }
  }
  return bestSnap;
}

/**
 * Determine how many tracks a size spans, using midpoints between boundaries
 * as decision thresholds. Collapsed boundaries (equal consecutive values from
 * 0-height tracks) are treated as a wall: the span stops at the first
 * collapsed boundary when size <= it, and uses the minimal span when all
 * remaining boundaries are collapsed (0-height rows don't inflate span).
 */
export function computeSpanFromSize(size: number, boundaries: number[]): number {
  if (boundaries.length === 0) return 1;

  for (let i = 0; i < boundaries.length; i++) {
    const current = boundaries[i];
    const next = boundaries[i + 1];

    if (next === undefined) return i + 1;

    if (current === next) {
      if (size <= current) return i + 1;
      // If all remaining boundaries are also collapsed, return minimal span —
      // 0-height rows beyond this point add no visual size.
      let allCollapsed = true;
      for (let j = i + 1; j < boundaries.length; j++) {
        if (boundaries[j] !== current) { allCollapsed = false; break; }
      }
      if (allCollapsed) return i + 1;
      continue;
    }

    const midpoint = (current + next) / 2;
    if (size < midpoint) return i + 1;
  }

  return boundaries.length;
}

const BREAKPOINTS_ORDER = ['', 'sm:', 'md:', 'lg:', 'xl:', '2xl:'];

// ── Shared grid-placement token grammar (task-090 review) ──
// ONE definition for every writer of grid-child placement: writeGridPlacement
// below (the commands and the DesignBar's fields) and the panel's string form
// (DesignBar/blocks/gridPlacement.ts). Do not re-declare these regexes
// locally — divergent copies were the root of the panel-vs-drag asymmetry.
/** Matches any grid-COLUMN placement token (unprefixed): col-start-*, col-end-*, col-span-*, col-auto, col-span-full. */
export const GRID_COL_PLACEMENT_RE = /^col-(start|end|span)-|^col-(auto|span-full)$/;
/** Matches any grid-ROW placement token (unprefixed). */
export const GRID_ROW_PLACEMENT_RE = /^row-(start|end|span)-|^row-(auto|span-full)$/;
/** Fixed (non-flow) width tokens — w-[..]/w-<n>/w-<frac>. Excludes w-full/auto/fit/min/max/screen and min-/max-. Column-first sizing: a span WRITE drops these. */
export const FIXED_W_RE = /^w-(\[|\d)/;
/** Fixed (non-flow) height tokens. */
export const FIXED_H_RE = /^h-(\[|\d)/;

const GRID_OUTPUT_ORDER = [
  'col-start', 'col-span', 'col-end', 'col-auto',
  'row-start', 'row-span', 'row-end', 'row-auto',
];

/**
 * Normalize grid placement classes: convert end->span, deduplicate across
 * breakpoints, remove default span-1, preserve non-grid tokens.
 */
export function normalizeGridClasses(classes: string): string {
  const tokens = classes.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';

  const nonGridTokens: string[] = [];
  const bpData: Record<string, Record<string, string>> = {};
  for (const bp of BREAKPOINTS_ORDER) bpData[bp] = {};

  for (const token of tokens) {
    const { bp, core } = extractBP(token);
    const parsed = parseGridCore(core);
    if (parsed) {
      bpData[bp][parsed.prop] = parsed.value;
    } else {
      nonGridTokens.push(token);
    }
  }

  for (const bp of BREAKPOINTS_ORDER) {
    convertEndToSpan(bpData[bp], 'col');
    convertEndToSpan(bpData[bp], 'row');
  }
  // Starts as written, before the dedupe below drops the repeats.
  const starts = BREAKPOINTS_ORDER.map(bp => ({ col: bpData[bp]['col-start'], row: bpData[bp]['row-start'] }));

  for (const prop of GRID_OUTPUT_ORDER) {
    const isSpan = prop === 'col-span' || prop === 'row-span';
    let effective: string | undefined = isSpan ? '1' : undefined;

    for (const bp of BREAKPOINTS_ORDER) {
      const val = bpData[bp][prop];
      if (val === undefined) continue;
      if (val === effective) {
        delete bpData[bp][prop];
      } else {
        effective = val;
      }
    }
  }

  // `col-span-N` / `row-span-N` are the grid-column / grid-row SHORTHAND: at the
  // breakpoint that declares one, a start from a smaller breakpoint resets to
  // auto. Restate the start in force beside every span that survived.
  for (const axis of ['col', 'row'] as const) {
    let start: string | undefined;
    BREAKPOINTS_ORDER.forEach((bp, i) => {
      start = starts[i][axis] ?? start;
      if (start !== undefined && bpData[bp][`${axis}-span`] !== undefined) bpData[bp][`${axis}-start`] = start;
    });
  }

  const result = [...nonGridTokens];
  for (const bp of BREAKPOINTS_ORDER) {
    for (const prop of GRID_OUTPUT_ORDER) {
      const val = bpData[bp][prop];
      if (val === undefined) continue;
      const coreToken = prop.endsWith('-auto') ? prop : `${prop}-${val}`;
      result.push(bp ? `${bp}${coreToken}` : coreToken);
    }
  }

  return result.join(' ');
}

/**
 * The ONE grid-placement write, shared by the canvas commands (drag, resize,
 * AI) and the DesignBar's Start/Span fields. `gridColumn` / `gridRow` are the
 * new tokens of an axis ('' leaves it alone); their breakpoint prefix names
 * the layer being written. A span write (`stripsFixedSize`) also drops the
 * fixed width/height from every breakpoint that applies there.
 */
export function writeGridPlacement(classes: string, gridColumn: string, gridRow: string, stripsFixedSize: boolean): string {
  const target = extractBP((gridColumn || gridRow).split(/\s+/)[0] || '').bp;
  const targetOrder = BREAKPOINTS_ORDER.indexOf(target);
  const kept = classes.split(/\s+/).filter(token => {
    if (token === '') return false;
    const { bp, core } = extractBP(token);
    // Min-width cascade: base and every prefix up to the target apply there.
    if (stripsFixedSize && BREAKPOINTS_ORDER.indexOf(bp) <= targetOrder) {
      if (gridColumn && FIXED_W_RE.test(core)) return false;
      if (gridRow && FIXED_H_RE.test(core)) return false;
    }
    // Prior placement is replaced only at the breakpoint being written.
    if (bp !== target) return true;
    if (gridColumn && GRID_COL_PLACEMENT_RE.test(core)) return false;
    if (gridRow && GRID_ROW_PLACEMENT_RE.test(core)) return false;
    return true;
  });
  return normalizeGridClasses([...kept, gridColumn, gridRow].join(' '));
}

export type GridCommand = Extract<EditorCommand, { type: 'GRID_PLACE_ELEMENT' | 'SET_GRID_SPAN' }>;
export const isGridCommand = (action: EditorCommand): action is GridCommand =>
  action.type === 'GRID_PLACE_ELEMENT' || action.type === 'SET_GRID_SPAN';
/**
 * The classes a grid command writes. Column-first sizing (task-090): only a
 * span WRITE (SET_GRID_SPAN, a resize) drops the fixed width/height; a
 * placement (drag-drop, swap, AI set_grid_placement) is a move and keeps them.
 */
export const gridCommandClasses = (classes: string, command: GridCommand): string =>
  writeGridPlacement(classes, command.gridColumn, command.gridRow, command.type === 'SET_GRID_SPAN');

function extractBP(token: string): { bp: string; core: string } {
  for (const prefix of ['sm:', 'md:', 'lg:', 'xl:', '2xl:']) {
    if (token.startsWith(prefix)) return { bp: prefix, core: token.slice(prefix.length) };
  }
  return { bp: '', core: token };
}

function parseGridCore(core: string): { prop: string; value: string } | null {
  const m = core.match(/^(col|row)-(start|end|span)-(\d+)$/);
  if (m) return { prop: `${m[1]}-${m[2]}`, value: m[3] };

  if (core === 'col-span-full') return { prop: 'col-span', value: 'full' };
  if (core === 'row-span-full') return { prop: 'row-span', value: 'full' };
  if (core === 'col-auto') return { prop: 'col-auto', value: 'auto' };
  if (core === 'row-auto') return { prop: 'row-auto', value: 'auto' };

  return null;
}

function convertEndToSpan(d: Record<string, string>, axis: 'col' | 'row'): void {
  const startKey = `${axis}-start`;
  const endKey = `${axis}-end`;
  const spanKey = `${axis}-span`;

  const start = d[startKey];
  const end = d[endKey];
  if (start !== undefined && end !== undefined && d[spanKey] === undefined) {
    const s = parseInt(start);
    const e = parseInt(end);
    if (!isNaN(s) && !isNaN(e) && e > s) {
      d[spanKey] = String(e - s);
      delete d[endKey];
    }
  }
}
