/**
 * Tiny external store exposing the SELECTED grid child's cell placement to the
 * DesignBar. The bridge's GRID_GEOMETRY_RESPONSE lands in ViewportFrame state
 * (viewportMessages/grid.ts) — the DesignBar can't read that. This store bridges
 * the gap: grid.ts publishes the selected cell's rendered start/span + the parent
 * track counts here, and the DesignBar reads it via `useSelectedCellGeometry`.
 *
 * Used by the Layout block's Start+Span inputs as the geometry fallback so a
 * `col-span-N` / auto-placed child shows its real position instead of empty
 * (BUG-B / task-090). Mirrors the dropZoneStore useSyncExternalStore pattern.
 */
import { useSyncExternalStore } from 'react';

export interface SelectedCellGeometry {
  /** element key this cell was measured FOR — consumers must gate on it (stale-geometry guard, task-090 review) */
  key: string;
  /** breakpoint of the frame that measured it — geometry from one frame is wrong at another breakpoint */
  breakpoint: string;
  /** 1-based column start of the selected cell (rendered) */
  start: number;
  /** rendered column span */
  span: number;
  /** 1-based row start (rendered) */
  rowStart: number;
  /** rendered row span */
  rowSpan: number;
  /** parent grid column track count */
  parentCols: number;
  /** parent grid row track count */
  parentRows: number;
}

let state: SelectedCellGeometry | null = null;
const listeners = new Set<() => void>();

function cellEqual(a: SelectedCellGeometry | null, b: SelectedCellGeometry | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.breakpoint === b.breakpoint
    && a.start === b.start && a.span === b.span && a.rowStart === b.rowStart
    && a.rowSpan === b.rowSpan && a.parentCols === b.parentCols && a.parentRows === b.parentRows;
}

export function setSelectedCellGeometry(next: SelectedCellGeometry | null): void {
  // Skip the notify (and the DesignBar re-render) when the cell is unchanged —
  // GRID_GEOMETRY_RESPONSE fires on selection + many edits, often with identical geometry.
  if (cellEqual(state, next)) return;
  state = next;
  for (const l of listeners) l();
}

export function clearSelectedCellGeometry(): void {
  setSelectedCellGeometry(null);
}

export function subscribeSelectedCellGeometry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot: same reference until `setSelectedCellGeometry` changes it. */
export function getSelectedCellGeometrySnapshot(): SelectedCellGeometry | null {
  return state;
}

export function useSelectedCellGeometry(): SelectedCellGeometry | null {
  return useSyncExternalStore(subscribeSelectedCellGeometry, getSelectedCellGeometrySnapshot, getSelectedCellGeometrySnapshot);
}

/**
 * Staleness gate: the stored cell only applies to the element key it was
 * measured for AND the breakpoint of the frame that measured it. A
 * Layers-panel selection (no canvas roundtrip) or a DesignBar breakpoint
 * switch must fall back to class-derived data, never show another
 * element's / another frame's cell (task-090 review).
 */
export function selectedCellFor(key: string | null, breakpoint: string): SelectedCellGeometry | null {
  if (!state || !key) return null;
  return state.key === key && state.breakpoint === breakpoint ? state : null;
}
