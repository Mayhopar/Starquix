/**
 * THE screen↔iframe coordinate transform for canvas overlays (task-107).
 * One source for the pan/zoom/centering math and the pt-8 top padding —
 * previously copied (and hand-inverted) across DrawOverlay and PenOverlay.
 */

/** pt-8 padding above the viewport frame inside the canvas content. */
export const CANVAS_TOP_PADDING = 32;

export interface CanvasView {
  scale: number;
  position: { x: number; y: number };
  canvasWidth: number;
  viewportWidth: number;
}

const viewportOffsetX = (v: CanvasView) => ((v.canvasWidth - v.viewportWidth) / 2) * v.scale;

/**
 * Client (screen) coords → iframe document coords. UNCLAMPED — points left of
 * or above the page come back negative; clamp at the call site if needed.
 */
export function screenToIframe(
  clientX: number,
  clientY: number,
  overlayRect: { left: number; top: number },
  view: CanvasView,
): { x: number; y: number } {
  const relX = clientX - overlayRect.left;
  const relY = clientY - overlayRect.top;
  return {
    x: (relX - view.position.x - viewportOffsetX(view)) / view.scale,
    y: (relY - view.position.y - CANVAS_TOP_PADDING * view.scale) / view.scale,
  };
}

/** Iframe document coords → overlay-local px (the exact inverse, minus the overlay origin). */
export function iframeToOverlay(p: { x: number; y: number }, view: CanvasView): { x: number; y: number } {
  return {
    x: p.x * view.scale + view.position.x + viewportOffsetX(view),
    y: p.y * view.scale + view.position.y + CANVAS_TOP_PADDING * view.scale,
  };
}
