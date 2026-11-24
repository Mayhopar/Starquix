import { describe, it, expect } from 'vitest';
import {
  MIN_SCALE, MAX_SCALE, ZOOM_LEVELS, FRAME_TOP_PADDING, FIT_MARGIN,
  clampScale, stepScale, zoomAroundPoint, fitView,
} from '../zoomMath';

describe('clampScale', () => {
  it('clamps to 0.1–10', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(20)).toBe(MAX_SCALE);
    expect(clampScale(1.3)).toBe(1.3);
  });
});

describe('stepScale', () => {
  it('steps up to the next fixed level', () => {
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(0.6, 1)).toBe(0.75); // between levels → next above
    expect(stepScale(5, 1)).toBe(6);
    expect(stepScale(6, 1)).toBe(8);
    expect(stepScale(10, 1)).toBe(10);    // clamped at top
  });
  it('steps down to the previous fixed level', () => {
    expect(stepScale(1, -1)).toBe(0.75);
    expect(stepScale(0.6, -1)).toBe(0.5);
    expect(stepScale(0.1, -1)).toBe(0.1); // clamped at bottom
  });
  it('is epsilon-tolerant to float drift from gesture zoom', () => {
    expect(stepScale(1.0000001, 1)).toBe(1.25);
    expect(stepScale(0.9999999, -1)).toBe(0.75);
  });
  it('only ever returns values inside the clamp range', () => {
    for (const l of ZOOM_LEVELS) {
      expect(stepScale(l, 1)).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(stepScale(l, 1)).toBeLessThanOrEqual(MAX_SCALE);
    }
  });
});

describe('zoomAroundPoint', () => {
  it('keeps the content point under the anchor fixed', () => {
    const view = { scale: 1, x: 50, y: -20 };
    const anchor = { x: 400, y: 300 };
    const next = zoomAroundPoint(view, anchor, 2);
    // content point under anchor before:
    const cx = (anchor.x - view.x) / view.scale;
    const cy = (anchor.y - view.y) / view.scale;
    // …must map back to the anchor after:
    expect(cx * next.scale + next.x).toBeCloseTo(anchor.x, 6);
    expect(cy * next.scale + next.y).toBeCloseTo(anchor.y, 6);
    expect(next.scale).toBe(2);
  });
  it('clamps the target scale', () => {
    const next = zoomAroundPoint({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 99);
    expect(next.scale).toBe(MAX_SCALE);
  });
  it('is identity when target equals current scale', () => {
    const view = { scale: 1.5, x: 12, y: 34 };
    const next = zoomAroundPoint(view, { x: 100, y: 100 }, 1.5);
    expect(next.x).toBeCloseTo(view.x, 6);
    expect(next.y).toBeCloseTo(view.y, 6);
  });
});

describe('fitView', () => {
  // Frame geometry (Canvas.tsx content layer): frame left = (canvasWidth - viewportWidth)/2,
  // frame top = FRAME_TOP_PADDING (pt-8 = 32), transformOrigin 0 0.
  it('height-limited fit centres the frame', () => {
    const v = fitView({ canvasWidth: 1200, canvasHeight: 800, viewportWidth: 1024, frameHeight: 2000 });
    // avail = 1104 x 704 → scale = min(1104/1024, 704/2000) = 0.352
    expect(v.scale).toBeCloseTo(0.352, 6);
    // horizontal centre: screenLeft = x + frameLeft*scale = (1200 - 1024*0.352)/2
    const frameLeft = (1200 - 1024) / 2;
    expect(v.x + frameLeft * v.scale).toBeCloseTo((1200 - 1024 * 0.352) / 2, 6);
    // vertical centre: screenTop = y + 32*scale = (800 - 2000*0.352)/2
    expect(v.y + FRAME_TOP_PADDING * v.scale).toBeCloseTo((800 - 2000 * 0.352) / 2, 6);
  });
  it('width-limited fit can exceed 100%', () => {
    const v = fitView({ canvasWidth: 1600, canvasHeight: 1200, viewportWidth: 375, frameHeight: 600 });
    // avail = 1504 x 1104 → min(1504/375 ≈ 4.0107, 1104/600 = 1.84) = 1.84
    expect(v.scale).toBeCloseTo(1.84, 6);
  });
  it('clamps to MIN_SCALE and top-aligns when even MIN does not fit the height', () => {
    const v = fitView({ canvasWidth: 1200, canvasHeight: 400, viewportWidth: 1024, frameHeight: 50000 });
    expect(v.scale).toBe(MIN_SCALE);
    // top-aligned with margin: screenTop = y + 32*scale = FIT_MARGIN
    expect(v.y + FRAME_TOP_PADDING * v.scale).toBeCloseTo(FIT_MARGIN, 6);
  });
  it('falls back to width-only fit (top-aligned) when frame height is unmeasurable', () => {
    const v = fitView({ canvasWidth: 1200, canvasHeight: 800, viewportWidth: 1024, frameHeight: 0 });
    expect(v.scale).toBeCloseTo(1104 / 1024, 6);
    expect(v.y + FRAME_TOP_PADDING * v.scale).toBeCloseTo(FIT_MARGIN, 6);
  });
  it('respects a custom margin', () => {
    const v = fitView({ canvasWidth: 1024, canvasHeight: 800, viewportWidth: 1024, frameHeight: 0, margin: 0 });
    expect(v.scale).toBeCloseTo(1, 6);
    // frameLeft = 0 here, so x must be 0 and y = -32*1 + 0... screenTop = y + 32 = 0
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y + FRAME_TOP_PADDING * v.scale).toBeCloseTo(0, 6);
  });
});

describe('fitView with floating side panels', () => {
  it('fits the frame into the gap between the panels and centres it there', () => {
    const v = fitView({ canvasWidth: 1400, canvasHeight: 900, viewportWidth: 1280, frameHeight: 0, insetLeft: 240, insetRight: 280 });
    const frameLeft = (1400 - 1280) / 2; // the content layer centres the frame in the full canvas width
    const screenLeft = v.x + frameLeft * v.scale, screenRight = screenLeft + 1280 * v.scale;
    expect(screenLeft - 240).toBeCloseTo(1400 - 280 - screenRight); // equal margins inside the gap
    expect(screenLeft).toBeGreaterThan(240);
    expect(screenRight).toBeLessThan(1400 - 280);
  });
  it('without insets it is the plain fit', () => {
    const a = fitView({ canvasWidth: 1400, canvasHeight: 900, viewportWidth: 1280, frameHeight: 0 });
    const b = fitView({ canvasWidth: 1400, canvasHeight: 900, viewportWidth: 1280, frameHeight: 0, insetLeft: 0, insetRight: 0 });
    expect(b).toEqual(a);
  });
});
