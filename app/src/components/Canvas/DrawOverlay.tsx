import { useCallback, useRef, useState, memo } from 'react';
import { useTool, type DrawTool } from '@/context/ToolContext';
import { findInsertionTarget } from '@/utils/smartInsertion';
import { buildShape, SHAPE_KINDS, type ShapeKind } from './shapeMarkup';
import { screenToIframe as screenToIframeShared } from './canvasCoords';
import { useScannedElementsRef } from '@/context/SelectionContext';

const isShapeTool = (t: DrawTool): t is ShapeKind => (SHAPE_KINDS as readonly string[]).includes(t);

interface DrawRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface DrawnElementResult {
  tag: string;
  classes: string;
  textContent: string;
  parentKey: string | null;
  insertIndex: number;
  /** Vector shapes: inline SVG markup (task-106). */
  staticMarkup?: string;
  /** Vector shapes: PenPath JSON — same contract as pen commits (task-109). */
  penPath?: string;
  /** The box as drawn (screen px) + its look: held on screen until the page shows the element. */
  preview?: { left: number; top: number; width: number; height: number; className: string };
}

// ponytail: box preview for lines; live line preview when someone complains
export function previewClassFor(tool: string): string {
  return tool === 'frame' ? 'border-2 border-dashed border-accent-strong bg-accent-strong/5'
    : tool === 'slot' ? 'border-2 border-dashed border-overlay-component bg-overlay-component/5'
    : tool === 'blog' ? 'border-2 border-dashed border-overlay-selection bg-overlay-selection/5'
    : tool === 'ellipse' ? 'border-2 border-dashed border-overlay-ai bg-overlay-ai/5 rounded-full'
    : 'border-2 border-dashed border-overlay-ai bg-overlay-ai/5';
}

interface DrawOverlayProps {
  scale: number;
  position: { x: number; y: number };
  canvasWidth: number;
  viewportWidth: number;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  onElementCreated: (result: DrawnElementResult) => void;
  /**
   * When true (real pages), component/theme instances can't parent a drawn
   * element — a draw over one lands on the nearest non-instance ancestor or
   * page root (task-069 A3). False in the component editor, where the master
   * source CAN receive drops. Defaults to off.
   */
  lockInstanceParenting?: boolean;
}

function getTag(tool: DrawTool): string {
  if (tool === 'text') return 'p';
  return 'div'; // frame, slot, blog all use div (slot/blog get converted to section at root level)
}

export const DrawOverlay = memo(function DrawOverlay({
  scale,
  position,
  canvasWidth,
  viewportWidth,
  iframeRef,
  onElementCreated,
  lockInstanceParenting = false,
}: DrawOverlayProps) {
  const { scannedElementsRef } = useScannedElementsRef();
  const { activeTool, setActiveTool } = useTool();
  const [drawRect, setDrawRect] = useState<DrawRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Convert screen coordinates to iframe document coordinates (shared
  // transform in canvasCoords.ts). Rect draws clamp to the page box — a drag
  // that starts off-page must still produce an on-page element.
  const screenToIframe = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const overlayEl = overlayRef.current;
      if (!overlayEl) return { x: 0, y: 0 };
      const p = screenToIframeShared(screenX, screenY, overlayEl.getBoundingClientRect(), {
        scale,
        position,
        canvasWidth,
        viewportWidth,
      });
      return { x: Math.max(0, p.x), y: Math.max(0, p.y) };
    },
    [scale, position, canvasWidth, viewportWidth]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === 'select') return;
      e.preventDefault();
      e.stopPropagation();

      setDrawRect({
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      });
    },
    [activeTool]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawRect) return;
      e.preventDefault();

      setDrawRect((prev) =>
        prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null
      );
    },
    [drawRect]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drawRect || activeTool === 'select') return;
      e.preventDefault();

      // Calculate rect in screen space
      const left = Math.min(drawRect.startX, drawRect.currentX);
      const top = Math.min(drawRect.startY, drawRect.currentY);
      const width = Math.abs(drawRect.currentX - drawRect.startX);
      const height = Math.abs(drawRect.currentY - drawRect.startY);

      // Minimum 10x10 draw area — lines/arrows only need ONE long axis
      // (a 200×3 drag is a valid horizontal line)
      const tooSmall = activeTool === 'line' || activeTool === 'arrow'
        ? Math.max(width, height) < 10
        : width < 10 || height < 10;
      if (tooSmall) {
        setDrawRect(null);
        return;
      }

      // Convert corners to iframe coordinates
      const topLeft = screenToIframe(left, top);
      const bottomRight = screenToIframe(left + width, top + height);
      const iframeWidth = bottomRight.x - topLeft.x;
      const iframeHeight = bottomRight.y - topLeft.y;

      // Smart insertion
      const iframeRect = {
        top: topLeft.y,
        left: topLeft.x,
        width: iframeWidth,
        height: iframeHeight,
      };
      const insertion = findInsertionTarget(iframeRect, scannedElementsRef.current, lockInstanceParenting);

      // Layout <slot> tags aren't in scannedElements (they're DOM-only fixtures
      // from a dropped layout's compiled markup). If the draw rect lands inside
      // one, parent the new drawn element to that slot's data-key directly so
      // the bridge's findElementByKey lookup nests it inside the slot at render.
      //
      // PAGE view only (lockInstanceParenting): in the MASTER editor a draw is
      // layout CHROME — a sibling of the <slot>, never its content. Parenting
      // it into the literal slot nested it in the DOM, so the selection walk
      // always resolved clicks to the slot (the chrome was unreachable without
      // ⌘-click) and the master Layers showed it under the slot (2026-08-26).
      let parentKey = insertion.parentKey;
      const iframeDoc = lockInstanceParenting ? iframeRef?.current?.contentDocument : null;
      if (iframeDoc) {
        const cx = iframeRect.left + iframeRect.width / 2;
        const cy = iframeRect.top + iframeRect.height / 2;
        const hit = iframeDoc.elementFromPoint(cx, cy) as HTMLElement | null;
        const slotKey = hit?.closest?.('slot[data-key]')?.getAttribute('data-key');
        if (slotKey) parentKey = slotKey;
      }

      // Build Tailwind classes — all drawn elements use static positioning
      const w = Math.max(Math.round(iframeWidth), 2);
      const h = Math.max(Math.round(iframeHeight), 2);
      let classes: string;
      let staticMarkup: string | undefined;
      let penPath: string | undefined;
      if (activeTool === 'frame') {
        classes = `w-[${w}px] h-[${h}px] border border-dashed border-gray-300 bg-white`; // ui-lint-line: generated user-document classes, not chrome
      } else if (activeTool === 'blog' || activeTool === 'slot') {
        classes = 'w-full';
      } else if (isShapeTool(activeTool)) {
        // downSlope: drag direction TL→BR / BR→TL (line slopes down)
        const downSlope =
          (drawRect.currentX - drawRect.startX) * (drawRect.currentY - drawRect.startY) >= 0;
        const shape = buildShape(activeTool, w, h, downSlope);
        classes = shape.classes;
        staticMarkup = shape.staticMarkup;
        penPath = shape.penPath;
      } else {
        classes = `w-[${w}px] h-[${h}px]`;
      }

      const tag = getTag(activeTool);
      const textContent = activeTool === 'text' ? 'Type here' : '';

      onElementCreated({
        tag,
        classes,
        textContent,
        parentKey,
        insertIndex: insertion.insertIndex,
        staticMarkup,
        penPath,
        preview: {
          left: Math.min(drawRect.startX, drawRect.currentX), top: Math.min(drawRect.startY, drawRect.currentY),
          width: Math.abs(drawRect.currentX - drawRect.startX), height: Math.abs(drawRect.currentY - drawRect.startY),
          className: previewClassFor(activeTool),
        },
      });

      setDrawRect(null);
      setActiveTool('select');
    },
    [drawRect, activeTool, screenToIframe, scannedElementsRef, onElementCreated, setActiveTool, lockInstanceParenting, iframeRef, scale, position, canvasWidth, viewportWidth]
  );

  // Don't render if in select or AI mode (AI mode needs direct iframe clicks).
  // Pen has its own overlay (PenOverlay) — rect-drag semantics don't apply.
  if (activeTool === 'select' || activeTool === 'ai' || activeTool === 'pen') return null;

  // Calculate preview rect position (in screen space, fixed positioning)
  const previewPosStyle: React.CSSProperties | undefined = drawRect
    ? {
        position: 'fixed',
        left: Math.min(drawRect.startX, drawRect.currentX),
        top: Math.min(drawRect.startY, drawRect.currentY),
        width: Math.abs(drawRect.currentX - drawRect.startX),
        height: Math.abs(drawRect.currentY - drawRect.startY),
        zIndex: 9999,
      }
    : undefined;
  const previewToolClass = previewClassFor(activeTool);

  return (
    <>
      {/* Transparent overlay to capture mouse events */}
      <div
        ref={overlayRef}
        className="absolute inset-0 z-40"
        style={{ cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />

      {/* Preview rectangle */}
      {drawRect && previewPosStyle && (
        <div className={`pointer-events-none ${previewToolClass}`} style={previewPosStyle}>
          {activeTool === 'text' && (
            <span className="absolute top-1 left-1 text-xs text-overlay-ai pointer-events-none select-none">T</span>
          )}
          {activeTool === 'slot' && (
            <span className="absolute top-1 left-1 text-xs text-overlay-component pointer-events-none select-none">Slot</span>
          )}
          {activeTool === 'blog' && (
            <span className="absolute top-1 left-1 text-xs text-overlay-selection pointer-events-none select-none">Blog</span>
          )}
        </div>
      )}
    </>
  );
});
