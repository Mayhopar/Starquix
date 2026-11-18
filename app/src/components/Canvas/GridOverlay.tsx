import { useRef, useEffect, memo } from 'react';
import type { GridGeometry } from '@/store/types';
import { getCellRect, getGapPositions, getTrackTotal } from '@/utils/gridGeometry';

const GRID_LINE_COLOR = 'rgba(59, 130, 246, 0.3)';
const GRID_FILL_COLOR = 'rgba(59, 130, 246, 0.08)';
const DASHED_BORDER = `1px dashed ${GRID_LINE_COLOR}`;

const HIGHLIGHT_STYLE: React.CSSProperties = {
  position: 'absolute',
  display: 'none',
  backgroundColor: 'rgba(59, 130, 246, 0.15)',
  borderRadius: '2px',
  transition: 'left 0.1s ease, top 0.1s ease, width 0.1s ease, height 0.1s ease',
  pointerEvents: 'none',
};

interface GapLineProps {
  axis: 'column' | 'row';
  position: number;
  gap: number;
}

/** Renders a single gap region (filled strip when gap > 0) or a dashed line (gap === 0). */
function GapLine({ axis, position, gap }: GapLineProps): React.JSX.Element {
  const isColumn = axis === 'column';
  const hasFill = gap > 0;

  const style: React.CSSProperties = {
    position: 'absolute',
    ...(isColumn
      ? { left: `${position}px`, top: 0, width: hasFill ? `${gap}px` : 0, height: '100%' }
      : { top: `${position}px`, left: 0, height: hasFill ? `${gap}px` : 0, width: '100%' }),
    ...(hasFill && { backgroundColor: GRID_FILL_COLOR }),
  };

  if (isColumn) {
    style.borderLeft = DASHED_BORDER;
    if (hasFill) style.borderRight = DASHED_BORDER;
  } else {
    style.borderTop = DASHED_BORDER;
    if (hasFill) style.borderBottom = DASHED_BORDER;
  }

  return <div style={style} />;
}

interface GridOverlayProps {
  geometry: GridGeometry;
  containerOffset: { x: number; y: number };
  /** Highlighted cell span (col, row, colSpan, rowSpan) or null */
  highlightedSpan?: { col: number; row: number; colSpan: number; rowSpan: number } | null;
}

export const GridOverlay = memo(function GridOverlay({
  geometry,
  containerOffset,
  highlightedSpan,
}: GridOverlayProps) {
  const highlightRef = useRef<HTMLDivElement>(null);
  const { containerRect, columns, rows, columnGap, rowGap, explicitRowCount } = geometry;

  // Update highlight position via ref (no re-render during drag).
  useEffect(() => {
    if (!highlightRef.current) return;

    if (!highlightedSpan) {
      highlightRef.current.style.display = 'none';
      return;
    }

    const rect = getCellRect(
      geometry,
      highlightedSpan.col,
      highlightedSpan.row,
      highlightedSpan.colSpan,
      highlightedSpan.rowSpan,
    );
    highlightRef.current.style.display = 'block';
    highlightRef.current.style.left = `${rect.left}px`;
    highlightRef.current.style.top = `${rect.top}px`;
    highlightRef.current.style.width = `${rect.width}px`;
    highlightRef.current.style.height = `${rect.height}px`;
  }, [geometry, highlightedSpan]);

  const colGapPositions = getGapPositions(columns, columnGap);
  const totalWidth = getTrackTotal(columns, columnGap);
  const totalHeight = getTrackTotal(rows, rowGap);

  // Only show row gap lines when 2+ explicit rows are defined
  const rowGapPositions = explicitRowCount >= 2 ? getGapPositions(rows, rowGap) : [];

  // Use container height when rows are all implicit (totalHeight may be 0 or inaccurate)
  const overlayHeight = totalHeight > 0 ? totalHeight : containerRect.height;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${containerRect.left + containerOffset.x}px`,
        top: `${containerRect.top + containerOffset.y}px`,
        width: `${totalWidth}px`,
        height: `${overlayHeight}px`,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {colGapPositions.map((x, i) => (
        <GapLine key={`col-${i}`} axis="column" position={x} gap={columnGap} />
      ))}

      {rowGapPositions.map((y, i) => (
        <GapLine key={`row-${i}`} axis="row" position={y} gap={rowGap} />
      ))}

      {/* Cell highlight */}
      <div ref={highlightRef} style={HIGHLIGHT_STYLE} />
    </div>
  );
});
