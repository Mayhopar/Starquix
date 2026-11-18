/**
 * task-207 Task 9. Write-target cases from the ledger's B-rows, re-decided
 * against the D8 probe: the target is the rehype wrapper's body-line stamp,
 * available for EVERY component invocation including non-spreading ones.
 */
import { describe, it, expect } from 'vitest';
import { resolveComponentUnit, componentPathOf, componentNameOf } from '../componentUnit';
import { resolveMediaUnit } from '../mediaUnit';

const MEDIA = 'src/components/sq/Media.astro:75:1';
const CREDIT = 'src/components/sq/Credit.astro:4:1';

describe('componentPathOf / componentNameOf', () => {
  it('strips the line:col and keeps sq/ paths only', () => {
    expect(componentPathOf(CREDIT)).toBe('src/components/sq/Credit.astro');
    expect(componentPathOf('src/components/SingleImage.astro:5:1')).toBeNull();
    expect(componentPathOf(null)).toBeNull();
    expect(componentPathOf(undefined)).toBeNull();
  });

  it('names the component from its file', () => {
    expect(componentNameOf('src/components/sq/Credit.astro')).toBe('Credit');
    expect(componentNameOf(null)).toBeNull();
  });
});

describe('resolveComponentUnit', () => {
  it('stamped + sq/ source → writable, identified', () => {
    expect(resolveComponentUnit({ mediaUnit: { bodyLine: 25, bodyEnd: 28 }, astroSource: CREDIT }))
      .toEqual({
        path: 'src/components/sq/Credit.astro', name: 'Credit',
        write: { bodyLine: 25, bodyEnd: 28 },
      });
  });

  it('sq/ source with NO stamp → read-only, still identified (B9, WC canvas)', () => {
    expect(resolveComponentUnit({ astroSource: MEDIA }))
      .toEqual({ path: 'src/components/sq/Media.astro', name: 'Media', write: null });
  });

  it('a zero/inverted stamp is not a write target', () => {
    expect(resolveComponentUnit({ mediaUnit: { bodyLine: 0, bodyEnd: 0 }, astroSource: MEDIA })?.write)
      .toBeNull();
    expect(resolveComponentUnit({ mediaUnit: { bodyLine: 9, bodyEnd: 4 }, astroSource: MEDIA })?.write)
      .toBeNull();
  });

  it('neither stamp nor sq/ source → not a system component at all', () => {
    expect(resolveComponentUnit({ astroSource: 'src/components/SingleImage.astro:5:1' })).toBeNull();
    expect(resolveComponentUnit(null)).toBeNull();
  });

  it('a stamp with a non-sq source is writable but unidentified (older payloads)', () => {
    const unit = resolveComponentUnit({ mediaUnit: { bodyLine: 3, bodyEnd: 3 }, astroSource: null });
    expect(unit).toEqual({ path: null, name: null, write: { bodyLine: 3, bodyEnd: 3 } });
  });
});

/** The Media path must keep answering exactly as task-206 pinned it. */
describe('resolveMediaUnit still agrees with the generalized resolver', () => {
  const cases = [
    { mediaUnit: { bodyLine: 19, bodyEnd: 19 }, astroSource: MEDIA },
    { astroSource: MEDIA },
    { mediaUnit: { bodyLine: 0, bodyEnd: 0 }, astroSource: MEDIA },
  ];
  it.each(cases)('write target matches for %o', (sel) => {
    expect(resolveMediaUnit(sel)?.write ?? null).toEqual(resolveComponentUnit(sel)?.write ?? null);
  });
});
