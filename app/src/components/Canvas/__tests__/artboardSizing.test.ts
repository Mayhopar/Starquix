import { describe, expect, it } from 'vitest';
import { ArtboardSizing } from '../artboardSizing';

describe('ArtboardSizing', () => {
  it('rounds up, grows without a cap, shrinks and rejects invalid heights', () => {
    const fit = new ArtboardSizing(800);
    expect(fit.measure({ height: 1600.4 })).toBe(1601);
    expect(fit.measure({ height: 2400 })).toBe(2400);
    expect(fit.measure({ height: 1600.4 })).toBe(1601);
    expect(fit.measure({ height: 700 })).toBe(800); // floor: one full screen
    expect(fit.measure({ height: 120000 })).toBe(120000);
    for (const height of [NaN, Infinity, -1, 0]) expect(fit.measure({ height })).toBe(120000);
  });
  it('fits convergent viewport-dependent layout', () => {
    const fit = new ArtboardSizing(800);
    for (let i = 0; i < 15; i++) fit.measure({ height: fit.height * 0.5 + 500, viewportHeight: fit.height, revision: 0 });
    expect(fit.height).toBeGreaterThanOrEqual(996);
    expect(fit.height).toBeLessThanOrEqual(1000);
  });
  it('stops divergent feedback, stays frozen on repeated reports, and renews after DOM edits', () => {
    const fit = new ArtboardSizing(800);
    for (let i = 0; i < 30; i++) fit.measure({ height: fit.height + 100, viewportHeight: fit.height, revision: 0 });
    expect(fit.height).toBeLessThanOrEqual(1100);
    const frozen = fit.height;
    for (let i = 0; i < 30; i++) expect(fit.measure({ height: frozen + 100, viewportHeight: frozen, revision: 0 })).toBe(frozen);
    expect(fit.measure({ height: 5000, viewportHeight: frozen, revision: 1 })).toBe(5000);
    expect(fit.measure({ height: 700, viewportHeight: 5000, revision: 2 })).toBe(800);
  });
  it('renews a frozen fit when late media changes content at the same viewport', () => {
    const fit = new ArtboardSizing(800);
    for (let i = 0; i < 10; i++) fit.measure({ height: fit.height + 100, viewportHeight: fit.height, revision: 0 });
    expect(fit.measure({ height: 3500, viewportHeight: fit.height, revision: 0 })).toBe(3500);
  });
  it('keeps resize feedback frozen while viewport-driven spacing finishes transitioning', () => {
    const fit = new ArtboardSizing(800);
    fit.measure({ height: 900, viewportHeight: 800, revision: 0 });
    fit.measure({ height: 1000, viewportHeight: 900, revision: 0 });
    expect(fit.measure({ height: 1100, viewportHeight: 1000, revision: 0 })).toBe(800);

    // A transition can keep changing layout after the host stops resizing.
    // No source/content revision occurred; these remain the same feedback.
    expect(fit.measure({ height: 1150, viewportHeight: 800, revision: 0, transitioning: true })).toBe(800);
    expect(fit.measure({ height: 1200, viewportHeight: 800, revision: 0, transitioning: false })).toBe(800);
    expect(fit.measure({ height: 1400, viewportHeight: 800, revision: 0, transitioning: false })).toBe(1400);
  });
  it('rejects old revisions and retired documents but fits a fresh document', () => {
    const fit = new ArtboardSizing(800);
    fit.measure({ height: 1600, viewportHeight: 800, revision: 3, documentId: 'first' });
    expect(fit.measure({ height: 2500, viewportHeight: 1600, revision: 2, documentId: 'first' })).toBe(1600);
    expect(fit.measure({ height: 900, viewportHeight: 1600, revision: 0, documentId: 'second' })).toBe(900);
    expect(fit.measure({ height: 2500, viewportHeight: 900, revision: 4, documentId: 'first' })).toBe(900);
  });
  it('renews fitting while retaining freshness across fallback changes', () => {
    const fit = new ArtboardSizing(800);
    fit.measure({ height: 1600, documentId: 'old', revision: 1 });
    fit.measure({ height: 1600, documentId: 'current', revision: 3 });
    fit.setFallback(1800);
    expect(fit.height).toBe(1800); // the new screen floor is taller than the content
    expect(fit.measure({ height: 9000, viewportHeight: 1800, documentId: 'current', revision: 2 })).toBe(1800);
    expect(fit.measure({ height: 9000, viewportHeight: 1800, documentId: 'old', revision: 4 })).toBe(1800);
  });
  it('bounds slowly divergent adjustments and ignores stale viewport samples', () => {
    const fit = new ArtboardSizing(800);
    for (let i = 0; i < 40; i++) fit.measure({ height: fit.height + 10000 / fit.height, viewportHeight: fit.height, revision: 0 });
    expect(fit.height).toBeLessThan(1100);
    const frozen = fit.height;
    expect(fit.measure({ height: 9000, viewportHeight: 900, revision: 2 })).toBe(frozen);
  });

  // Owner 2026-10-08: the artboard is at least one SCREEN tall (the fallback
  // is the floor) — an empty or short page still shows the whole screen.
  it('floors short content at the screen height and grows past it', () => {
    const fit = new ArtboardSizing(800);
    expect(fit.height).toBe(800);
    expect(fit.measure({ height: 240 })).toBe(800);
    expect(fit.measure({ height: 1200.2 })).toBe(1201);
    expect(fit.measure({ height: 150 })).toBe(800);
  });
  it('a divergent page freezes at the screen height (first screen)', () => {
    const fit = new ArtboardSizing(800);
    for (let i = 0; i < 30; i++) fit.measure({ height: fit.height + 100, viewportHeight: fit.height, revision: 0 });
    expect(fit.height).toBe(800);
  });
  it('setFallback moves the floor under short content', () => {
    const fit = new ArtboardSizing(800);
    fit.measure({ height: 300 });
    fit.setFallback(1024);
    expect(fit.height).toBe(1024);
    fit.setFallback(600);
    expect(fit.height).toBe(600);
  });
});
