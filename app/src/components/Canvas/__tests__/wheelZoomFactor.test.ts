import { it, expect } from 'vitest';
import { wheelZoomFactor } from '../zoomMath';

it('a trackpad pinch (Chromium: scale = e^(−ΣdeltaY/100)) zooms the canvas 1:1 with the fingers', () => {
  const deltas = Array.from({ length: 20 }, () => -100 * Math.log(2) / 20); // a 2× pinch, split like a gesture
  expect(deltas.reduce((s, d) => s * wheelZoomFactor(d), 1)).toBeCloseTo(2, 6);
});
it('a mouse ctrl+wheel notch keeps ~1.65× per notch', () => {
  expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.5), 6);
  expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.5), 6);
});
