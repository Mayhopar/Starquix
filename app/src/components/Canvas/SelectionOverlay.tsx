import { useRef, useState, useCallback, useEffect, memo, useSyncExternalStore } from 'react';
import type { ElementRect } from './ViewportFrame';
import { hoverRectStore } from './hoverRectStore';
import { altKeyStore } from './altKeyStore';
import type { GridGeometry } from '@/store/types';
import { getTrackBoundaries, snapToNearestBoundary, computeSpanFromSize } from '@/utils/gridGeometry';
import { Badge } from '@/components/ui/Badge';
import { MeasureOverlay } from './MeasureOverlay';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type CornerHandle = 'nw' | 'ne' | 'se' | 'sw';
type EdgeHandle = 'n' | 'e' | 's' | 'w';

function hasDirection(handle: ResizeHandle): { east: boolean; west: boolean; south: boolean; north: boolean } {
  return {
    east: handle === 'e' || handle === 'ne' || handle === 'se',
    west: handle === 'w' || handle === 'nw' || handle === 'sw',
    south: handle === 's' || handle === 'se' || handle === 'sw',
    north: handle === 'n' || handle === 'ne' || handle === 'nw',
  };
}

const cursorMap: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', ne: 'nesw-resize', se: 'nwse-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

const cornerHandlePositions: Record<CornerHandle, React.CSSProperties> = {
  nw: { top: '-4px', left: '-4px', cursor: 'nwse-resize' },
  ne: { top: '-4px', right: '-4px', cursor: 'nesw-resize' },
  se: { bottom: '-4px', right: '-4px', cursor: 'nwse-resize' },
  sw: { bottom: '-4px', left: '-4px', cursor: 'nesw-resize' },
};

const edgeStyles: Record<EdgeHandle, React.CSSProperties> = {
  n: { top: '-3px', left: '8px', right: '8px', height: '6px', cursor: 'ns-resize' },
  e: { right: '-3px', top: '8px', bottom: '8px', width: '6px', cursor: 'ew-resize' },
  s: { bottom: '-3px', left: '8px', right: '8px', height: '6px', cursor: 'ns-resize' },
  w: { left: '-3px', top: '8px', bottom: '8px', width: '6px', cursor: 'ew-resize' },
};

const CORNER_HANDLES: CornerHandle[] = ['nw', 'ne', 'se', 'sw'];
const EDGE_HANDLES: EdgeHandle[] = ['n', 'e', 's', 'w'];

export type SelectionVariant = 'normal' | 'component' | 'blog' | 'slot';

// All variants use theme.css tokens so light/dark overrides propagate.
// `blog` reuses the selection-yellow overlay token, `slot` the
// component-cyan overlay token (task-125 design-system unification).
export const VARIANT_BORDER: Record<SelectionVariant, string> = {
  normal: 'border-stroke-active',
  component: 'border-stroke-component',
  blog: 'border-overlay-selection',
  slot: 'border-overlay-component',
};

function blockIframes(): void {
  document.querySelectorAll('iframe').forEach((iframe) => {
    (iframe as HTMLIFrameElement).style.pointerEvents = 'none';
  });
}

function unblockIframes(): void {
  document.querySelectorAll('iframe').forEach((iframe) => {
    (iframe as HTMLIFrameElement).style.pointerEvents = '';
  });
}

function rectsMatch(a: ElementRect, b: ElementRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

interface SelectionOverlayProps {
  selectedRect: ElementRect | null;
  scale: number;
  containerOffset: { x: number; y: number };
  /** Whether a drag operation is in progress (hides hover overlay) */
  isDragging?: boolean;
  /** Callback when resize completes with new dimensions */
  onResize?: (width: number, height: number) => void;
  /** Callback during resize drag for live preview */
  onResizeLive?: (width: number, height: number) => void;
  /** Whether the selected element can be moved by dragging (drawn elements) */
  isMovable?: boolean;
  /** Callback when move completes with delta in iframe coordinates */
  onMove?: (deltaX: number, deltaY: number) => void;
  /** Whether the selected element supports flow drag reorder */
  isFlowDraggable?: boolean;
  /** Callback to start a flow drag -- sends coordinates to iframe */
  onFlowDragStart?: (iframeX: number, iframeY: number) => void;
  /** Callback during flow drag -- sends coordinates to iframe */
  onFlowDragMove?: (iframeX: number, iframeY: number) => void;
  /** Callback to end a flow drag -- sends coordinates to iframe */
  onFlowDragEnd?: (iframeX: number, iframeY: number) => void;
  /** Grid geometry for snap behavior during resize */
  gridGeometry?: GridGeometry | null;
  /** Selected element's grid cell info (col, row, colSpan, rowSpan) */
  selectedGridCell?: { col: number; row: number; colSpan: number; rowSpan: number } | null;
  /** Callback when grid span changes */
  onGridSpanChange?: (gridColumn: string, gridRow: string, handle: ResizeHandle) => void;
  /** Callback when resize starts */
  onResizeStart?: () => void;
  /** Callback when resize ends */
  onResizeEnd?: () => void;
  /** Selection color variant — drives outline + handle border color */
  variant?: SelectionVariant;
  /** Double-click on the selection body (pen elements: enter node-edit mode, task-107). */
  onDoubleClick?: () => void;
  /**
   * Lock-tier badge (imported-adoption phase 0, ledger L1–L3). `full`/absent →
   * no badge; `limited`/`locked` → chip above the selection, full copy in the
   * native title tooltip. Derivation lives in DesignBar/lockTier.ts.
   */
  lock?: { tier: 'full' | 'locked'; label?: string | null };
}

// Store all mutable props in a single ref to keep drag handlers stable (zero deps).
// Drag handlers read from this ref at event time instead of closing over props,
// so they never need to be recreated.
type PropsSnapshot = Pick<
  SelectionOverlayProps,
  | 'selectedRect' | 'containerOffset' | 'scale'
  | 'onResize' | 'onResizeLive' | 'onMove'
  | 'onFlowDragStart' | 'onFlowDragMove' | 'onFlowDragEnd'
  | 'gridGeometry' | 'selectedGridCell' | 'onGridSpanChange'
>;


export const SelectionOverlay = memo(function SelectionOverlay({
  selectedRect,
  scale,
  containerOffset,
  isDragging = false,
  onResize,
  onResizeLive,
  isMovable = false,
  onMove,
  isFlowDraggable = false,
  onFlowDragStart,
  onFlowDragMove,
  onFlowDragEnd,
  gridGeometry,
  selectedGridCell,
  onGridSpanChange,
  onResizeStart,
  onResizeEnd,
  variant = 'normal',
  onDoubleClick,
  lock,
}: SelectionOverlayProps): React.ReactNode {
  const overlayRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  const isDraggingRef = useRef(false);
  const currentSizeRef = useRef<{ width: number; height: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const rafIdRef = useRef<number>(0);
  // task-120 (5.1): rAF id for coalesced flow-drag move dispatches.
  const flowRafRef = useRef<number>(0);

  // Single ref for all props that drag handlers need at event time
  const propsRef = useRef<PropsSnapshot>({
    selectedRect, containerOffset, scale,
    onResize, onResizeLive, onMove, onFlowDragStart, onFlowDragMove, onFlowDragEnd,
    gridGeometry, selectedGridCell, onGridSpanChange,
  });
  propsRef.current = {
    selectedRect, containerOffset, scale,
    onResize, onResizeLive, onMove, onFlowDragStart, onFlowDragMove, onFlowDragEnd,
    gridGeometry, selectedGridCell, onGridSpanChange,
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      unblockIframes();
      isDraggingRef.current = false;
      currentSizeRef.current = null;
    };
  }, []);

  // Sets up a drag session: blocks iframes, sets body styles, registers
  // mousemove/mouseup on document, and stores a cleanup function.
  // All teardown happens automatically on mouseup or via cleanupRef for unmount safety.
  const startDragSession = useCallback(
    (options: {
      cursor?: string;
      onDragMove: (e: MouseEvent) => void;
      onDragEnd: (e: MouseEvent) => void;
    }) => {
      isDraggingRef.current = true;

      document.body.style.cursor = options.cursor ?? '';
      document.body.style.userSelect = 'none';
      blockIframes();

      const onMove = options.onDragMove;

      const onUp = (e: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        cleanupRef.current = null;

        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        unblockIframes();

        options.onDragEnd(e);
        isDraggingRef.current = false;
      };

      cleanupRef.current = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [],
  );

  // Handle resize drag -- uses direct DOM manipulation for performance.
  // Zero deps: reads all mutable state from propsRef at event time.
  const handleResizeMouseDown = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const { selectedRect: rect } = propsRef.current;
      if (!rect || isDraggingRef.current) return;

      setIsResizing(true);
      onResizeStart?.();

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = Math.round(rect.width);
      const startHeight = Math.round(rect.height);

      currentSizeRef.current = { width: startWidth, height: startHeight };
      const dir = hasDirection(handle);

      startDragSession({
        cursor: cursorMap[handle],
        onDragMove(moveEvent) {
          if (!isDraggingRef.current) return;

          const p = propsRef.current;
          const deltaX = (moveEvent.clientX - startX) / p.scale;
          const deltaY = (moveEvent.clientY - startY) / p.scale;

          let newWidth = startWidth;
          let newHeight = startHeight;
          let offsetX = 0;
          let offsetY = 0;

          if (dir.east) newWidth = Math.max(20, startWidth + deltaX);
          if (dir.west) {
            const growth = Math.min(deltaX, startWidth - 20);
            newWidth = startWidth - growth;
            offsetX = growth;
          }
          if (dir.south) newHeight = Math.max(20, startHeight + deltaY);
          if (dir.north) {
            const growth = Math.min(deltaY, startHeight - 20);
            newHeight = startHeight - growth;
            offsetY = growth;
          }

          // Grid snap: snap resize edge to nearest grid column/row boundary
          const geo = p.gridGeometry;
          if (geo) {
            const cell = p.selectedGridCell;
            const startCol = Math.max(0, cell?.col ?? 0);
            const startRow = Math.max(0, cell?.row ?? 0);

            if (dir.east) {
              newWidth = snapToNearestBoundary(
                newWidth,
                getTrackBoundaries(geo.columns, geo.columnGap, startCol, geo.columns.length),
              );
            }

            if (dir.west) {
              const rightEdge = startCol + (cell?.colSpan ?? 1);
              const reversed = geo.columns.slice(0, rightEdge).reverse();
              const snapped = snapToNearestBoundary(newWidth, getTrackBoundaries(reversed, geo.columnGap, 0, rightEdge));
              if (snapped !== newWidth) {
                newWidth = snapped;
                offsetX = startWidth - newWidth;
              }
            }

            if (dir.south) {
              newHeight = snapToNearestBoundary(
                newHeight,
                getTrackBoundaries(geo.rows, geo.rowGap, startRow, geo.rows.length),
              );
            }

            if (dir.north) {
              const bottomEdge = startRow + (cell?.rowSpan ?? 1);
              const reversed = geo.rows.slice(0, bottomEdge).reverse();
              const snapped = snapToNearestBoundary(newHeight, getTrackBoundaries(reversed, geo.rowGap, 0, bottomEdge));
              if (snapped !== newHeight) {
                newHeight = snapped;
                offsetY = startHeight - newHeight;
              }
            }
          }

          const w = Math.round(newWidth);
          const h = Math.round(newHeight);
          currentSizeRef.current = { width: w, height: h };

          // Direct DOM update -- no React re-render
          if (overlayRef.current) {
            overlayRef.current.style.width = `${w}px`;
            overlayRef.current.style.height = `${h}px`;
            overlayRef.current.style.left = `${rect.left + offsetX + p.containerOffset.x}px`;
            overlayRef.current.style.top = `${rect.top + offsetY + p.containerOffset.y}px`;
          }
          if (tooltipRef.current) {
            tooltipRef.current.textContent = `${w} \u00d7 ${h}`;
          }

          // Live preview: throttle to one postMessage per animation frame
          if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = 0;
            p.onResizeLive?.(w, h);
          });
        },
        onDragEnd() {
          const finalSize = currentSizeRef.current;
          const p = propsRef.current;
          const geo = p.gridGeometry;

          // Cancel any pending rAF from live resize
          if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
          }

          // Grid span mode: determine col/row span from final size
          if (geo && finalSize && p.onGridSpanChange) {
            const cell = p.selectedGridCell;
            const startCol = Math.max(0, cell?.col ?? 0);
            const startRow = Math.max(0, cell?.row ?? 0);

            const colBoundaries = dir.west
              ? getTrackBoundaries(
                  geo.columns.slice(0, startCol + (cell?.colSpan ?? 1)).reverse(),
                  geo.columnGap, 0, startCol + (cell?.colSpan ?? 1),
                )
              : getTrackBoundaries(geo.columns, geo.columnGap, startCol, geo.columns.length);

            const rowBoundaries = dir.north
              ? getTrackBoundaries(
                  geo.rows.slice(0, startRow + (cell?.rowSpan ?? 1)).reverse(),
                  geo.rowGap, 0, startRow + (cell?.rowSpan ?? 1),
                )
              : getTrackBoundaries(geo.rows, geo.rowGap, startRow, geo.rows.length);

            const colSpan = computeSpanFromSize(finalSize.width, colBoundaries);
            const rowSpan = computeSpanFromSize(finalSize.height, rowBoundaries);

            p.onGridSpanChange(`col-span-${colSpan}`, `row-span-${rowSpan}`, handle);
          } else if (finalSize && p.onResize) {
            p.onResize(finalSize.width, finalSize.height);
          }

          setIsResizing(false);
          onResizeEnd?.();
          currentSizeRef.current = null;
        },
      });
    },
    [selectedRect, containerOffset, onResize, gridGeometry, selectedGridCell, onGridSpanChange, onResizeStart, onResizeEnd, startDragSession],
  );

  // Handle move drag -- click and drag the selection body to reposition.
  // Zero deps beyond startDragSession: reads selectedRect, scale, etc. from propsRef.
  const handleMoveMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // a right-click opens the layer menu instead
      e.preventDefault();
      e.stopPropagation();

      const { selectedRect: rect } = propsRef.current;
      if (!rect || isDraggingRef.current) return;

      const startX = e.clientX;
      const startY = e.clientY;

      startDragSession({
        cursor: 'default',
        onDragMove(moveEvent) {
          if (!isDraggingRef.current) return;

          const p = propsRef.current;
          const deltaX = (moveEvent.clientX - startX) / p.scale;
          const deltaY = (moveEvent.clientY - startY) / p.scale;

          if (overlayRef.current) {
            overlayRef.current.style.left = `${rect.left + deltaX + p.containerOffset.x}px`;
            overlayRef.current.style.top = `${rect.top + deltaY + p.containerOffset.y}px`;
          }
        },
        onDragEnd(upEvent) {
          const p = propsRef.current;
          const deltaX = (upEvent.clientX - startX) / p.scale;
          const deltaY = (upEvent.clientY - startY) / p.scale;

          if (p.onMove && (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1)) {
            p.onMove(Math.round(deltaX), Math.round(deltaY));
          }
        },
      });
    },
    [startDragSession],
  );

  // Handle flow drag -- initiates iframe-orchestrated drag after 8px threshold
  const handleFlowDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // a right-click opens the layer menu instead
      e.preventDefault();
      e.stopPropagation();

      if (!propsRef.current.selectedRect || isDraggingRef.current) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let hasStarted = false;
      // task-120 (5.1): the iframe's rect is stable for the drag's duration —
      // cache it instead of querySelector + getBoundingClientRect per move.
      let iframeRect: DOMRect | null = null;
      const cachedCoords = (clientX: number, clientY: number, scale: number) => {
        if (!iframeRect) {
          const iframe = document.querySelector('iframe[data-viewport]') as HTMLIFrameElement | null;
          iframeRect = iframe?.getBoundingClientRect() ?? null;
        }
        if (!iframeRect) return { x: 0, y: 0 };
        return { x: (clientX - iframeRect.left) / scale, y: (clientY - iframeRect.top) / scale };
      };

      startDragSession({
        onDragMove(moveEvent) {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          if (!hasStarted) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            hasStarted = true;
            isDraggingRef.current = true;
            if (overlayRef.current) {
              overlayRef.current.style.opacity = '0';
            }
            const p = propsRef.current;
            const coords = cachedCoords(startX, startY, p.scale);
            p.onFlowDragStart?.(coords.x, coords.y);
          }

          // task-120 (5.1): coalesce move dispatches to one per animation
          // frame — same pattern as onResizeLive above. The bridge does rect
          // math per message; mousemove outpaces paint.
          if (flowRafRef.current) cancelAnimationFrame(flowRafRef.current);
          const { clientX, clientY } = moveEvent;
          flowRafRef.current = requestAnimationFrame(() => {
            flowRafRef.current = 0;
            const p = propsRef.current;
            const coords = cachedCoords(clientX, clientY, p.scale);
            p.onFlowDragMove?.(coords.x, coords.y);
          });
        },
        onDragEnd(upEvent) {
          // Flush ordering: a pending coalesced MOVE must not land after END.
          if (flowRafRef.current) {
            cancelAnimationFrame(flowRafRef.current);
            flowRafRef.current = 0;
          }
          const p = propsRef.current;
          if (hasStarted) {
            const coords = cachedCoords(upEvent.clientX, upEvent.clientY, p.scale);
            p.onFlowDragEnd?.(coords.x, coords.y);
            if (overlayRef.current) {
              overlayRef.current.style.opacity = '';
            }
          } else {
            // Drag never started -- forward click to iframe for selection/context entry
            const iframe = document.querySelector('iframe[data-viewport]') as HTMLIFrameElement | null;
            if (iframe?.contentWindow) {
              const coords = cachedCoords(upEvent.clientX, upEvent.clientY, p.scale);
              iframe.contentWindow.postMessage({
                type: 'SIMULATE_CLICK',
                payload: {
                  x: coords.x,
                  y: coords.y,
                  metaKey: upEvent.metaKey,
                  ctrlKey: upEvent.ctrlKey,
                  shiftKey: upEvent.shiftKey,
                  isDoubleClick: false,
                },
              }, '*');
            }
          }
        },
      });

      // Override: flow drag should not mark isDraggingRef until threshold is met.
      // startDragSession sets it to true, so we reset it here.
      isDraggingRef.current = false;
    },
    [startDragSession],
  );

  // -- Render --

  // task-120 (4.2): hover rect comes from the external store — pointer-rate
  // updates re-render this small overlay only, never ViewportFrame.
  const hoveredInfo = useSyncExternalStore(hoverRectStore.subscribe, hoverRectStore.get);
  const hoveredRect = hoveredInfo?.rect ?? null;
  const altDown = useSyncExternalStore(altKeyStore.subscribe, altKeyStore.get);

  const showHover = !isDragging
    && hoveredRect != null
    && !(selectedRect != null && rectsMatch(hoveredRect, selectedRect));

  if (!selectedRect && !showHover) return null;

  const strokeClass = VARIANT_BORDER[variant];

  let overlayMouseDown: ((e: React.MouseEvent) => void) | undefined;
  if (isMovable) {
    overlayMouseDown = handleMoveMouseDown;
  } else if (isFlowDraggable) {
    overlayMouseDown = handleFlowDragMouseDown;
  }

  return (
    <>
      {showHover && hoveredRect && (
        <div
          className={`absolute pointer-events-none border ${strokeClass} z-[999]`} // ui-lint-line: overlay stacking order (hover below selection)
          style={{
            left: hoveredRect.left + containerOffset.x,
            top: hoveredRect.top + containerOffset.y,
            width: hoveredRect.width,
            height: hoveredRect.height,
          }}
        />
      )}

      {selectedRect && (
        <div
          ref={overlayRef}
          className={`absolute border ${strokeClass} z-[1000] ${(isMovable || isFlowDraggable) ? 'pointer-events-auto' : 'pointer-events-none'}`} // ui-lint-line: overlay stacking order (selection above hover + scroll overlay)
          style={{
            left: selectedRect.left + containerOffset.x,
            top: selectedRect.top + containerOffset.y,
            width: selectedRect.width,
            height: selectedRect.height,
            cursor: isFlowDraggable ? 'default' : undefined,
          }}
          onMouseDown={overlayMouseDown}
          onDoubleClick={onDoubleClick}
        >
          {CORNER_HANDLES.map((handle) => (
            <div
              key={handle}
              className={`absolute w-2 h-2 bg-white border ${strokeClass} rounded-sm pointer-events-auto cursor-pointer`}
              style={cornerHandlePositions[handle]}
              data-handle={handle}
              onMouseDown={(e) => handleResizeMouseDown(handle, e)}
            />
          ))}

          {EDGE_HANDLES.map((edge) => (
            <div
              key={edge}
              className="absolute pointer-events-auto"
              style={edgeStyles[edge]}
              data-handle={edge}
              onMouseDown={(e) => handleResizeMouseDown(edge, e)}
            />
          ))}

          {isResizing && (
            <div
              ref={tooltipRef}
              className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-black/80 text-white py-0.5 px-1.5 rounded text-xs font-mono whitespace-nowrap pointer-events-none"
            >
              {Math.round(selectedRect.width)} &times; {Math.round(selectedRect.height)}
            </div>
          )}

          {/* Lock-tier badge (ledger L1–L3): the parent div is pointer-events-none
              in the common case, so the badge re-enables events on itself for the
              title tooltip to work. Anchored like the resize tooltip above. */}
          {lock && lock.tier !== 'full' && (
            <div className="absolute -top-6 left-0 pointer-events-auto">
              <Badge
                variant="warning"
                size="sm"
                title={lock.label ?? undefined}
              >
                Not editable
              </Badge>
            </div>
          )}
        </div>
      )}

      {altDown && showHover && hoveredRect && selectedRect && (
        <MeasureOverlay selected={selectedRect} hovered={hoveredRect} offset={containerOffset} />
      )}
    </>
  );
});
