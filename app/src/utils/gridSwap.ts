import type { GridGeometry } from '@/store/types';

type Cell = GridGeometry['cells'][number];
type Box = { col: number; row: number; colSpan: number; rowSpan: number };

function overlapArea(a: Box, b: Box): number {
  const cols = Math.min(a.col + a.colSpan, b.col + b.colSpan) - Math.max(a.col, b.col);
  const rows = Math.min(a.row + a.rowSpan, b.row + b.rowSpan) - Math.max(a.row, b.row);
  return cols > 0 && rows > 0 ? cols * rows : 0;
}

/**
 * What happens to the siblings a dropped grid child lands on, most covered
 * first. The first takes the cell the dragged child left (`to`) when it fits
 * inside that footprint, clear of the new one. Every other one — and a first
 * that does not fit — goes back to auto-flow (`to: null`): the grid re-places
 * it, so no two children share a cell and no span runs past the last track.
 */
export function planDisplaced(cells: Cell[], draggedKey: string, target: Box): Array<{ cell: Cell; to: { col: number; row: number } | null }> {
  const dragged = cells.find(c => c.key === draggedKey);
  return cells
    .filter(c => c.key !== draggedKey && overlapArea(target, c) > 0)
    .sort((a, b) => overlapArea(target, b) - overlapArea(target, a))
    .map((cell, i) => {
      const fits = !!dragged && i === 0 && cell.colSpan <= dragged.colSpan && cell.rowSpan <= dragged.rowSpan
        && overlapArea(target, { ...cell, col: dragged.col, row: dragged.row }) === 0;
      return { cell, to: fits ? { col: dragged.col, row: dragged.row } : null };
    });
}
