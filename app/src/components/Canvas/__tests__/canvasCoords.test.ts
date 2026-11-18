// task-107: the shared overlay transform must be a true inverse pair — the
// duplicated copies it replaced could (and did) drift.
import { describe, it, expect } from 'vitest';
import { screenToIframe, iframeToOverlay, type CanvasView } from '../canvasCoords';

describe('canvasCoords', () => {
  const views: CanvasView[] = [
    { scale: 1, position: { x: 0, y: 0 }, canvasWidth: 375, viewportWidth: 375 },
    { scale: 0.5, position: { x: 120, y: -40 }, canvasWidth: 940, viewportWidth: 375 },
    { scale: 2, position: { x: -33, y: 7 }, canvasWidth: 800, viewportWidth: 640 },
  ];

  it('iframeToOverlay is the exact inverse of screenToIframe (zero overlay origin)', () => {
    const rect = { left: 0, top: 0 };
    for (const view of views) {
      for (const p of [{ x: 0, y: 0 }, { x: 137.5, y: 42 }, { x: -20, y: 500 }]) {
        const local = iframeToOverlay(p, view);
        const back = screenToIframe(local.x, local.y, rect, view);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('is unclamped: points left of / above the page come back negative', () => {
    const view = views[0];
    const p = screenToIframe(-50, 0, { left: 0, top: 0 }, view);
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0); // above the 32px top padding
  });
});
