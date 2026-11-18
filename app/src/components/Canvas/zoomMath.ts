// Pure zoom/pan view math for Canvas.tsx. No React, no DOM — unit-tested in
// __tests__/zoomMath.test.ts. Both gesture zoom (zoomAtPoint) and programmatic
// zoom (zoomCommands.ts) MUST go through these functions so the math never forks.

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

/** Fixed steps for Cmd+= / Cmd+- and the chip menu (Figma-style ladder). */
export const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10];

/** pt-8 on the canvas content layer (Canvas.tsx) — frame top in content space. */
export const FRAME_TOP_PADDING = 32;

/** Default whitespace around the frame for zoom-to-fit. */
export const FIT_MARGIN = 48;

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

const STEP_EPS = 1e-3;

/** Next/previous fixed zoom level relative to `current` (epsilon-tolerant). */
export function stepScale(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (const level of ZOOM_LEVELS) {
      if (level > current + STEP_EPS) return level;
    }
    return MAX_SCALE;
  }
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (ZOOM_LEVELS[i] < current - STEP_EPS) return ZOOM_LEVELS[i];
  }
  return MIN_SCALE;
}

/**
 * Scale the view to `targetScale` keeping the content point under `anchor`
 * (canvas-relative px) fixed on screen. Extracted from Canvas.tsx zoomAtPoint —
 * the single zoom formula for gestures AND programmatic zoom.
 */
export function zoomAroundPoint(
  view: ViewTransform,
  anchor: { x: number; y: number },
  targetScale: number,
): ViewTransform {
  const scale = clampScale(targetScale);
  const contentX = (anchor.x - view.x) / view.scale;
  const contentY = (anchor.y - view.y) / view.scale;
  return {
    scale,
    x: anchor.x - contentX * scale,
    y: anchor.y - contentY * scale,
  };
}

export interface FitInput {
  canvasWidth: number;   // canvasEl.clientWidth
  canvasHeight: number;  // canvasEl.clientHeight
  viewportWidth: number; // BREAKPOINTS[currentBreakpoint]
  /** Frame height in CONTENT px (screen px ÷ current scale). <2 → width-only fit. */
  frameHeight: number;
  margin?: number;
}

/**
 * Fit the viewport frame inside the canvas with a margin.
 * Content-space frame rect (Canvas.tsx layer: w-full flex justify-center pt-8,
 * transformOrigin 0 0): left = (canvasWidth - viewportWidth)/2, top = 32.
 * Centred both axes; top-aligned at `margin` when the height doesn't fit
 * (scale clamped at MIN_SCALE) or is unmeasurable.
 */
export function fitView(input: FitInput): ViewTransform {
  const m = input.margin ?? FIT_MARGIN;
  const availW = Math.max(input.canvasWidth - 2 * m, 1);
  const availH = Math.max(input.canvasHeight - 2 * m, 1);
  const widthOnly = input.frameHeight < 2;
  const raw = widthOnly
    ? availW / input.viewportWidth
    : Math.min(availW / input.viewportWidth, availH / input.frameHeight);
  const scale = clampScale(raw);

  const frameLeft = (input.canvasWidth - input.viewportWidth) / 2;
  const x = (input.canvasWidth - input.viewportWidth * scale) / 2 - frameLeft * scale;

  const heightFits = !widthOnly && input.frameHeight * scale <= availH + STEP_EPS;
  const y = heightFits
    ? (input.canvasHeight - input.frameHeight * scale) / 2 - FRAME_TOP_PADDING * scale
    : m - FRAME_TOP_PADDING * scale;

  return { scale, x, y };
}

/** Scale factor for one ctrl/⌘+wheel event. Chromium turns a trackpad pinch into
 *  ctrl+wheel with scale = e^(−deltaY/100), so this tracks the fingers 1:1 (the old
 *  e^(−deltaY/200) zoomed √ of the pinch — "zoom is slow"). A mouse notch (±100) is
 *  clamped to ±50: the same ~1.65× per notch as before. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-Math.max(-50, Math.min(50, deltaY)) / 100);
}
