/** task-120 (4.4) — REQUEST_GRID_GEOMETRY only fires for grid-relevant selections. */
import { describe, it, expect } from 'vitest';
import { isGridRelevantSelection } from '../gridRequestGate';

describe('isGridRelevantSelection', () => {
  it('unknown (unscanned) element → post, bridge decides', () => {
    expect(isGridRelevantSelection(undefined)).toBe(true);
  });

  it('grid child (parentDisplay grid) → post', () => {
    expect(isGridRelevantSelection({ classes: 'p-4', parentDisplay: 'grid' })).toBe(true);
    expect(isGridRelevantSelection({ classes: '', parentDisplay: 'inline-grid' })).toBe(true);
  });

  it('own grid container token → post (incl. breakpoint prefixes)', () => {
    expect(isGridRelevantSelection({ classes: 'grid grid-cols-3', parentDisplay: 'block' })).toBe(true);
    expect(isGridRelevantSelection({ classes: 'md:grid gap-4', parentDisplay: 'flex' })).toBe(true);
    expect(isGridRelevantSelection({ classes: 'inline-grid', parentDisplay: 'block' })).toBe(true);
  });

  it('plain elements → no probe', () => {
    expect(isGridRelevantSelection({ classes: 'p-4 text-xl', parentDisplay: 'block' })).toBe(false);
    expect(isGridRelevantSelection({ classes: 'flex gap-2', parentDisplay: 'flex' })).toBe(false);
    // grid-cols without the bare grid token is not a container by itself
    expect(isGridRelevantSelection({ classes: 'grid-cols-3', parentDisplay: 'block' })).toBe(false);
  });
});
