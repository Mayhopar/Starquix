import { useEffect, useRef } from 'react';

// Figma-style pixel grid: 1px pitch in local (design) px, visible only at high
// zoom. Spacing scales via the #canvas-content CSS transform; thickness and
// opacity must track LIVE scale, so applyPixelGridStyle is called both from
// this component's effect (debounced React flush) and from the coalesced rAF
// in Canvas.tsx scheduleTransformUpdate (mid-gesture), like zoomLabelRef.
// Design: docs/plans/2026-07-24-pixel-grid-design.md

export const PIXEL_GRID_ID = 'sq-pixel-grid';
/** Fade-in starts here; fully opaque at PIXEL_GRID_MAX_SCALE (= the 400% ladder step). */
export const PIXEL_GRID_MIN_SCALE = 3;
export const PIXEL_GRID_MAX_SCALE = 4;
/** ponytail: single neutral works over arbitrary site bg; per-theme variants if it ever reads wrong */
export const PIXEL_GRID_COLOR = 'rgba(127,127,127,0.22)';

export function gridOpacityForScale(scale: number): number {
  if (scale < PIXEL_GRID_MIN_SCALE) return 0;
  return Math.min(
    1,
    (scale - PIXEL_GRID_MIN_SCALE) / (PIXEL_GRID_MAX_SCALE - PIXEL_GRID_MIN_SCALE),
  );
}

/** Single write path for the grid's zoom-dependent styles (React effect + rAF). */
export function applyPixelGridStyle(el: HTMLElement, scale: number): void {
  const opacity = gridOpacityForScale(scale);
  if (opacity === 0) {
    el.style.display = 'none';
    return;
  }
  const w = 1 / scale; // hairline: 1 screen px regardless of zoom
  el.style.display = 'block';
  el.style.opacity = String(opacity);
  el.style.backgroundImage =
    `linear-gradient(to right, ${PIXEL_GRID_COLOR} ${w}px, transparent ${w}px), ` +
    `linear-gradient(to bottom, ${PIXEL_GRID_COLOR} ${w}px, transparent ${w}px)`;
  el.style.backgroundSize = '1px 1px';
}

/** Mounted always (cheap display:none below threshold) so the rAF path can
 *  write to it mid-gesture before React's 150ms-debounced flush. */
export function PixelGridOverlay({ scale }: { scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) applyPixelGridStyle(ref.current, scale);
  }, [scale]);
  return (
    <div
      id={PIXEL_GRID_ID}
      ref={ref}
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{ display: 'none' }}
    />
  );
}
