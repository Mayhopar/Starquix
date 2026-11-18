import { describe, it, expect } from 'vitest';
import {
  gridOpacityForScale,
  applyPixelGridStyle,
  PIXEL_GRID_MIN_SCALE,
} from '../PixelGridOverlay';

describe('gridOpacityForScale', () => {
  it('is 0 below the threshold', () => {
    expect(gridOpacityForScale(1)).toBe(0);
    expect(gridOpacityForScale(2.99)).toBe(0);
  });
  it('ramps linearly from threshold to max', () => {
    expect(gridOpacityForScale(PIXEL_GRID_MIN_SCALE)).toBe(0);
    expect(gridOpacityForScale(3.5)).toBeCloseTo(0.5);
  });
  it('is fully opaque at the 400% ladder step and above', () => {
    expect(gridOpacityForScale(4)).toBe(1);
    expect(gridOpacityForScale(99)).toBe(1);
  });
});

describe('applyPixelGridStyle', () => {
  it('hides the node below threshold', () => {
    const el = document.createElement('div');
    applyPixelGridStyle(el, 2);
    expect(el.style.display).toBe('none');
  });
  it('shows hairline-corrected grid above threshold', () => {
    const el = document.createElement('div');
    applyPixelGridStyle(el, 5);
    expect(el.style.display).toBe('block');
    expect(el.style.opacity).toBe('1');
    expect(el.style.backgroundImage).toContain('0.2px'); // 1/5
    expect(el.style.backgroundSize).toBe('1px 1px');
  });
});
