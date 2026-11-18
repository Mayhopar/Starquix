/**
 * Grid geometry response from the bridge (REQUEST_GRID_GEOMETRY roundtrip).
 */
import type { GridGeometry } from '@/store/types';
import type { ViewportMessageContext } from './context';
import { setSelectedCellGeometry, clearSelectedCellGeometry } from '@/store/gridGeometryStore';

/** Extract explicit row count from Tailwind grid-rows-N class. */
export function parseExplicitRowCount(classes: string): number {
  const match = classes.match(/grid-rows-(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function handleGridGeometryResponse(ctx: ViewportMessageContext, payload: unknown): void {
  const geo = payload as GridGeometry;

  // Clamp cell positions to minimum 0 — bridge may return -1 when row/col is auto
  for (const cell of geo.cells) {
    cell.row = Math.max(0, cell.row);
    cell.col = Math.max(0, cell.col);
  }

  // Override bridge's explicitRowCount with Tailwind class count (source of truth)
  const curKey = ctx.refs.selectedKey.current;
  if (curKey) {
    geo.explicitRowCount = parseExplicitRowCount(ctx.actions.getClassesFromYjs(curKey));
  }

  ctx.actions.setGridGeometry(geo);

  // Publish the selected child's cell to the DesignBar geometry store so the
  // Layout block's Start+Span inputs can fall back to the rendered position
  // when the child has no explicit col-start/col-span (BUG-B / task-090).
  const cell = curKey ? geo.cells.find((c) => c.key === curKey) : undefined;
  if (cell && curKey) {
    setSelectedCellGeometry({
      // Identity stamp: consumers gate on key + breakpoint so a Layers-panel
      // selection or breakpoint switch can never read stale geometry.
      key: curKey,
      breakpoint: ctx.refs.breakpoint.current,
      start: cell.col + 1,
      span: cell.colSpan,
      rowStart: cell.row + 1,
      rowSpan: cell.rowSpan,
      parentCols: geo.columns.length,
      parentRows: geo.rows.length,
    });
  } else {
    clearSelectedCellGeometry();
  }
}
