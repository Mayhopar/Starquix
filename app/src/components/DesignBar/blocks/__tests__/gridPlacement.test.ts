import { describe, it, expect } from 'vitest';
import { deriveAxisPlacement, buildAxisClasses, buildAxisEdit } from '../gridPlacement';
import { normalizeGridClasses } from '@/utils/gridGeometry';

// rendered = bridge geometry fallback for this cell on this axis
const render = (start: number, span: number) => ({ renderedStart: start, renderedSpan: span, parentSize: 12, sizeIsExact: true });

describe('deriveAxisPlacement (col)', () => {
  it('#1 auto-placed (no classes) → start/span from rendered cell', () => {
    expect(deriveAxisPlacement('flex flex-col', 'col', render(1, 1))).toEqual({ start: '1', span: '1' });
  });

  it('#2 col-span only (no start) → start from rendered cell, span from class', () => {
    // the proven live case: md:col-span-6, rendered at col 0 (=>1)
    expect(deriveAxisPlacement('col-span-6', 'col', render(1, 6))).toEqual({ start: '1', span: '6' });
  });

  it('#3 col-start only → start from class, span 1', () => {
    expect(deriveAxisPlacement('col-start-3', 'col', render(3, 1))).toEqual({ start: '3', span: '1' });
  });

  it('#4 col-start + col-span → both explicit', () => {
    expect(deriveAxisPlacement('col-start-2 col-span-3', 'col', render(2, 3))).toEqual({ start: '2', span: '3' });
  });

  it('#5 col-start + col-end → span derived from end-start', () => {
    expect(deriveAxisPlacement('col-start-2 col-end-6', 'col', render(2, 4))).toEqual({ start: '2', span: '4' });
  });

  it('#6 col-span-full → span = parentSize, start 1', () => {
    expect(deriveAxisPlacement('col-span-full', 'col', render(1, 12))).toEqual({ start: '1', span: '12' });
  });

  it('explicit class beats rendered fallback', () => {
    expect(deriveAxisPlacement('col-start-4 col-span-2', 'col', render(1, 1))).toEqual({ start: '4', span: '2' });
  });

  it('no geometry + no classes → empty (cannot infer)', () => {
    expect(deriveAxisPlacement('flex', 'col', { renderedStart: null, renderedSpan: null, parentSize: 0, sizeIsExact: false }))
      .toEqual({ start: '', span: '' });
  });
});

describe('deriveAxisPlacement (row)', () => {
  it('row-span only → start from rendered, span from class', () => {
    expect(deriveAxisPlacement('row-span-2', 'row', { renderedStart: 1, renderedSpan: 2, parentSize: 3, sizeIsExact: true }))
      .toEqual({ start: '1', span: '2' });
  });
});

describe('buildAxisClasses', () => {
  it('span only (no explicit start) → just col-span-N', () => {
    expect(buildAxisClasses('col', { start: null, span: 6 }, 12)).toEqual(['col-span-6']);
  });
  it('start + span → col-start-A col-span-N', () => {
    expect(buildAxisClasses('col', { start: 2, span: 3 }, 12)).toEqual(['col-start-2', 'col-span-3']);
  });
  it('clamps span to grid bound', () => {
    expect(buildAxisClasses('col', { start: 10, span: 6 }, 12)).toEqual(['col-start-10', 'col-span-3']);
  });
  it('span 1 with no start → no tokens (auto/default)', () => {
    expect(buildAxisClasses('col', { start: null, span: 1 }, 12)).toEqual([]);
  });
  it('round-trips through normalizeGridClasses (idempotent vs drag path)', () => {
    const tokens = buildAxisClasses('col', { start: 2, span: 3 }, 12);
    const normalized = normalizeGridClasses(tokens.join(' '));
    // normalize must not churn the canonical form back into something the parser misreads
    expect(normalizeGridClasses(normalized)).toBe(normalized);
  });
  it('clamps a span-only placement to the track count (no start known)', () => {
    expect(buildAxisClasses('col', { start: null, span: 50 }, 12)).toEqual(['col-span-12']);
  });
});

// buildAxisEdit — the ONE panel write funnel. Regression pins for the
// task-090 review findings: start edits must preserve the displayed span
// (col-end / col-span-full / geometry), never strip fixed sizes. task-094
// (B1) changed out-of-range handling: numerics CLAMP to the bound (never a
// silent no-op), junk still rejects with null, and the bound comes from
// geometry only (`sizeIsExact`) — a class-fallback count may be the wrong
// breakpoint and is capped at the Tailwind default 12 instead.
describe('buildAxisEdit', () => {
  const geo = (start: number | null, span: number | null, parent = 12, sizeIsExact = true) =>
    ({ renderedStart: start, renderedSpan: span, parentSize: parent, sizeIsExact });

  it('start edit preserves the span shown from col-end (was: collapsed to span 1)', () => {
    const out = buildAxisEdit('col-start-2 col-end-6 flex', 'col', 'start', '3', geo(2, 4));
    expect(out).toContain('col-start-3');
    expect(out).toContain('col-span-4');
    expect(out).not.toContain('col-end-6');
    expect(out).toContain('flex');
  });

  it('start edit converts col-span-full via parentSize (was: collapsed to span 1)', () => {
    const out = buildAxisEdit('col-span-full', 'col', 'start', '3', geo(1, 12));
    expect(out).toContain('col-start-3');
    expect(out).toContain('col-span-10');
    expect(out).not.toContain('col-span-full');
  });

  it('start edit does NOT strip a fixed width (position edit ≠ size intent)', () => {
    const out = buildAxisEdit('col-start-2 w-[300px]', 'col', 'start', '3', geo(2, 1));
    expect(out).toContain('w-[300px]');
    expect(out).toContain('col-start-3');
  });

  it('span edit DOES strip the conflicting fixed width (column-first sizing)', () => {
    const out = buildAxisEdit('col-span-3 w-[390px]', 'col', 'span', '4', geo(1, 3));
    expect(out).not.toMatch(/(?:^|\s)w-\[390px\]/);
    expect(out).toContain('col-span-4');
  });

  it('clamps an out-of-range start instead of clamp-destroying the span (was: rejected with null)', () => {
    // task-090 pinned null-reject so "13" mid-typing couldn't wipe the span;
    // task-094 moves commit to blur (draft buffer), so at commit we clamp.
    const high = buildAxisEdit('col-start-2 col-span-3', 'col', 'start', '13', geo(2, 3))!;
    expect(high.split(/\s+/)).toContain('col-start-12');
    expect(high).not.toMatch(/col-span-\d/); // span clamps to 1 at the right edge → elided
    const low = buildAxisEdit('col-start-2 col-span-3', 'col', 'start', '0', geo(2, 3))!;
    expect(low.split(/\s+/)).toContain('col-start-1');
    expect(low.split(/\s+/)).toContain('col-span-3');
  });

  it('clamps an out-of-range span (no col-span-50 junk in source classes; was: rejected)', () => {
    const out = buildAxisEdit('col-span-3', 'col', 'span', '50', geo(1, 3))!;
    expect(out.split(/\s+/)).toContain('col-span-12');
  });

  it('rejects non-numeric input instead of treating it as clear', () => {
    expect(buildAxisEdit('col-start-2 col-span-3', 'col', 'start', 'abc', geo(2, 3))).toBeNull();
  });

  it('caps at the Tailwind default scale when the parent track count is unknown', () => {
    expect(buildAxisEdit('flex', 'col', 'start', '13', geo(null, null, 0))).toContain('col-start-12');
    expect(buildAxisEdit('flex', 'col', 'start', '5', geo(null, null, 0))).toContain('col-start-5');
  });

  it('start edit on a span-only child keeps the explicit span', () => {
    const out = buildAxisEdit('col-span-3', 'col', 'start', '2', geo(1, 3));
    expect(out).toContain('col-start-2');
    expect(out).toContain('col-span-3');
  });

  it('pinning start on an auto-placed child materializes the DISPLAYED span', () => {
    // span 1 → elided; span 2 (rendered) → written, so the element keeps its shown size
    expect(buildAxisEdit('flex', 'col', 'start', '3', geo(1, 1))).toBe('flex col-start-3');
    const out = buildAxisEdit('flex', 'col', 'start', '3', geo(1, 2));
    expect(out).toContain('col-start-3');
    expect(out).toContain('col-span-2');
  });

  it('clearing start keeps only the class-derived span (no geometry materialization)', () => {
    expect(buildAxisEdit('col-start-2 col-span-3', 'col', 'start', '', geo(2, 3))).toBe('col-span-3');
    // fixed width survives a clear too
    expect(buildAxisEdit('col-start-2 w-[300px]', 'col', 'start', '', geo(2, 1))).toBe('w-[300px]');
  });

  it('span edit never materializes a col-start (auto placement preserved)', () => {
    const out = buildAxisEdit('col-span-3', 'col', 'span', '2', geo(3, 3));
    expect(out).toContain('col-span-2');
    expect(out).not.toMatch(/col-start-\d/);
  });

  it('span edit to 1 removes the span token (canonical elision)', () => {
    expect(buildAxisEdit('col-start-2 col-span-3', 'col', 'span', '1', geo(2, 3))).toBe('col-start-2');
  });

  it('row axis: span edit strips fixed height, start edit keeps it', () => {
    const spanOut = buildAxisEdit('row-span-2 h-[100px]', 'row', 'span', '3', geo(1, 2, 4));
    expect(spanOut).not.toContain('h-[100px]');
    expect(spanOut).toContain('row-span-3');
    const startOut = buildAxisEdit('row-span-2 h-[100px]', 'row', 'start', '2', geo(1, 2, 4));
    expect(startOut).toContain('h-[100px]');
  });
});

describe('buildAxisEdit clamping (task-094 B1)', () => {
  const g = (parentSize: number, sizeIsExact = true) =>
    ({ renderedStart: null, renderedSpan: null, parentSize, sizeIsExact });

  it('clamps an out-of-range start to the geometry bound instead of rejecting', () => {
    const r = buildAxisEdit('col-span-6', 'col', 'start', '99', g(6))!;
    expect(r.split(/\s+/)).toContain('col-start-6');
  });

  it('clamps 0 to 1', () => {
    const r = buildAxisEdit('', 'col', 'start', '0', g(6))!;
    expect(r.split(/\s+/)).toContain('col-start-1');
  });

  it('still rejects junk input with null', () => {
    expect(buildAxisEdit('col-span-6', 'col', 'span', 'abc', g(6))).toBeNull();
  });

  it('uses 12 as the bound when parentSize is not exact (wrong-breakpoint class fallback)', () => {
    // B1: grid-cols-1 md:grid-cols-6 parent read at xs gave bound=1 and killed every edit ≥2
    const r = buildAxisEdit('', 'col', 'start', '2', g(1, false))!;
    expect(r).not.toBeNull();
    expect(r.split(/\s+/)).toContain('col-start-2');
  });

  it('trusts an exact (geometry-sourced) parentSize as the bound', () => {
    const r = buildAxisEdit('', 'col', 'start', '9', g(6, true))!;
    expect(r.split(/\s+/)).toContain('col-start-6'); // clamped to 6
  });

  it('span edit under a non-exact parent bound never clamp-destroys the span at write time', () => {
    // the write path (buildAxisClasses) must use the effective bound too,
    // not the raw non-exact parentSize=1, or span 10 collapses to 1 → elided
    const r = buildAxisEdit('col-span-6', 'col', 'span', '10', g(1, false))!;
    expect(r.split(/\s+/)).toContain('col-span-10');
  });
});
