interface ViewportWheelOptions {
  onZoom?: (screenX: number, screenY: number, deltaY: number) => void;
  onPan?: (deltaX: number, deltaY: number) => void;
}

/**
 * Wheel over the frame in design mode: ⌘/ctrl zooms at the pointer, anything
 * else pans the canvas. Never forwarded into the iframe — design mode does not
 * scroll (owner ruling 2026-09-10); the bridge pins vh so the frame fits the
 * whole page instead. Preview mode has no overlay and scrolls natively.
 */
export function handleViewportWheel(event: WheelEvent, options: ViewportWheelOptions): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.ctrlKey || event.metaKey) {
    options.onZoom?.(event.clientX, event.clientY, event.deltaY);
    return;
  }
  options.onPan?.(event.deltaX, event.deltaY);
}
