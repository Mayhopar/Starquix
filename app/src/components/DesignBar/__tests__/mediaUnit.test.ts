/**
 * task-206: resolveMediaUnit — the ONE place that decides what a Media
 * selection is. Input is the scanned element (or null); output:
 *   null                      → not a media selection at all
 *   { write: {bodyLine,bodyEnd} } → editable Media unit (stamps present)
 *   { write: null }           → Media selection WITHOUT a write target
 *                               (no rehype stamps, e.g. WC post pages) —
 *                               MediaBlock renders read-only chrome.
 */
import { describe, it, expect } from 'vitest';
import { resolveMediaUnit, isMediaComponentPath } from '../mediaUnit';
import { resolveComponentUnit } from '../componentUnit';

describe('resolveMediaUnit', () => {
  it('element with mediaUnit stamps → write target', () => {
    expect(resolveMediaUnit({ mediaUnit: { bodyLine: 12, bodyEnd: 14 } }))
      .toEqual({ write: { bodyLine: 12, bodyEnd: 14 } });
  });

  it('sq/Media.astro source without stamps → media selection, write null', () => {
    expect(resolveMediaUnit({ astroSource: 'src/components/sq/Media.astro:40:9' }))
      .toEqual({ write: null });
  });

  it('zeroed stamps are not a write target', () => {
    // A 0-line stamp cannot address a body line (lines are 1-based).
    expect(resolveMediaUnit({
      mediaUnit: { bodyLine: 0, bodyEnd: 0 },
      astroSource: 'src/components/sq/Media.astro:40:9',
    })).toEqual({ write: null });
  });

  it('null / unrelated element → null', () => {
    expect(resolveMediaUnit(null)).toBeNull();
    expect(resolveMediaUnit({})).toBeNull();
    expect(resolveMediaUnit({ astroSource: 'src/components/Hero.astro:5:1' })).toBeNull();
  });
});

/**
 * task-207 block-routing regression: isSystemComponentPath matched EVERY sq/
 * path, so a promoted (non-Media) component selection resolved as a MEDIA
 * unit — DesignBar rendered MediaBlock (whose count/width knobs would corrupt
 * the foreign invocation) and SystemComponentBlock was unreachable in every
 * runtime. Only the system Media is a media unit.
 */
describe('resolveMediaUnit: promoted sq/ components are NOT media', () => {
  const CREDIT = 'src/components/sq/Credit.astro:4:1';

  it('stamped promoted component → null (falls through to resolveComponentUnit)', () => {
    expect(resolveMediaUnit({ mediaUnit: { bodyLine: 25, bodyEnd: 28 }, astroSource: CREDIT }))
      .toBeNull();
  });

  it('unstamped promoted component → null (never the read-only Media panel)', () => {
    expect(resolveMediaUnit({ astroSource: CREDIT })).toBeNull();
  });

  it('WC system Media path (src/components/Media.astro, D6 — no sq/ copy) is still media', () => {
    expect(resolveMediaUnit({ astroSource: 'src/components/Media.astro' }))
      .toEqual({ write: null });
    expect(resolveMediaUnit({ astroSource: 'src/components/Media.astro:10:3' }))
      .toEqual({ write: null });
  });

  it('block routing: the same Credit selection resolves as a COMPONENT unit', () => {
    // DesignBar's gate is `!mediaSelection && componentUnit` — for a promoted
    // component the pair must be (null, unit) so SystemComponentBlock renders.
    const sel = { mediaUnit: { bodyLine: 25, bodyEnd: 28 }, astroSource: CREDIT };
    expect(resolveMediaUnit(sel)).toBeNull();
    expect(resolveComponentUnit(sel)).toEqual({
      path: 'src/components/sq/Credit.astro', name: 'Credit',
      write: { bodyLine: 25, bodyEnd: 28 },
    });
  });

  it('isMediaComponentPath: Media system paths only, suffix-tolerant', () => {
    expect(isMediaComponentPath('src/components/sq/Media.astro')).toBe(true);
    expect(isMediaComponentPath('src/components/sq/Media.astro:40:9')).toBe(true);
    expect(isMediaComponentPath('src/components/Media.astro')).toBe(true);
    expect(isMediaComponentPath('src/components/sq/Credit.astro')).toBe(false);
    expect(isMediaComponentPath('src/components/Hero.astro')).toBe(false);
    expect(isMediaComponentPath(null)).toBe(false);
  });
});
