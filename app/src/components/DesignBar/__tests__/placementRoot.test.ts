/**
 * `isPlacementRoot` — the signal that gives local mode the instance-ROOT
 * concept server/WC mode get for free from the doc's `el-…` ids.
 *
 * Owner ruling 2026-08-03: `↗` / `⋮` belong to the placement root ONLY; inner
 * elements of a placement get the `*` divergence marker and nothing else, which
 * is exactly what server mode does.
 */
import { describe, it, expect } from 'vitest';
import { isPlacementRoot, type PlacementAncestryNode } from '../placementRoot';

const PAGE = 'src/pages/index.astro:5:1';
const HEADER_ROOT = 'src/components/Header.astro:1:1~paaaaaaaaaaaaaaa1';
const HEADER_H2 = 'src/components/Header.astro:3:3~paaaaaaaaaaaaaaa1';
const HEADER_SPAN = 'src/components/Header.astro:4:5~paaaaaaaaaaaaaaa1';

const tree = (pairs: Array<[string, string | null]>) =>
  new Map<string, PlacementAncestryNode>(pairs.map(([k, p]) => [k, { parentKey: p }]));

describe('isPlacementRoot', () => {
  it('the outermost element a component invocation rendered IS the root', () => {
    const scanned = tree([
      [PAGE, null],
      [HEADER_ROOT, PAGE],
      [HEADER_H2, HEADER_ROOT],
    ]);
    expect(isPlacementRoot(HEADER_ROOT, scanned)).toBe(true);
  });

  it('an element INSIDE the placement is not a root — no ↗/⋮ there', () => {
    const scanned = tree([
      [PAGE, null],
      [HEADER_ROOT, PAGE],
      [HEADER_H2, HEADER_ROOT],
      [HEADER_SPAN, HEADER_H2],
    ]);
    expect(isPlacementRoot(HEADER_H2, scanned)).toBe(false);
    expect(isPlacementRoot(HEADER_SPAN, scanned)).toBe(false);
  });

  it('two placements of the SAME component each have their own root', () => {
    const A = 'src/components/Card.astro:1:1~paaaaaaaaaaaaaaa1';
    const B = 'src/components/Card.astro:1:1~pbbbbbbbbbbbbbbb2';
    const scanned = tree([[PAGE, null], [A, PAGE], [B, PAGE]]);
    expect(isPlacementRoot(A, scanned)).toBe(true);
    expect(isPlacementRoot(B, scanned)).toBe(true);
  });

  it('a component nested inside ITSELF: same file, different placement → root', () => {
    // `<Wrapper><Wrapper>…</Wrapper></Wrapper>` — the file is identical on both
    // sides of the boundary, so only the placement segment separates them.
    const OUTER = 'src/components/Wrapper.astro:1:1~paaaaaaaaaaaaaaa1';
    const INNER = 'src/components/Wrapper.astro:1:1~pbbbbbbbbbbbbbbb2';
    const scanned = tree([[PAGE, null], [OUTER, PAGE], [INNER, OUTER]]);
    expect(isPlacementRoot(INNER, scanned)).toBe(true);
  });

  it('an unhashable invocation inherits its caller placement — the FILE is the boundary', () => {
    // The tagger only stamps a placement for an invocation it can resolve to a
    // `.astro` file through an import specifier; a computed one falls back to
    // the ancestor's placement. The file still changes at the boundary.
    const CALLER = 'src/pages/index.astro:5:1';
    const ROOT = 'src/components/Mystery.astro:1:1';
    const INNER = 'src/components/Mystery.astro:2:3';
    const scanned = tree([[CALLER, null], [ROOT, CALLER], [INNER, ROOT]]);
    expect(isPlacementRoot(ROOT, scanned)).toBe(true);
    expect(isPlacementRoot(INNER, scanned)).toBe(false);
  });

  it('a dynamic/untracked wrapper is transparent, not a boundary', () => {
    // A component root spreading `{...Astro.props}` gets no `data-sq-source`
    // (the tag regex cannot match it) — reading it as a boundary would make
    // every child of it a false root.
    const DYN = 'dynamic:div:3@abc';
    const scanned = tree([
      [PAGE, null],
      [HEADER_ROOT, PAGE],
      [DYN, HEADER_ROOT],
      [HEADER_H2, DYN],
    ]);
    expect(isPlacementRoot(HEADER_H2, scanned)).toBe(false);
  });

  it('no source-keyed ancestor at all → root (a layout <html>, or an unseeded scan)', () => {
    expect(isPlacementRoot(HEADER_ROOT, tree([[HEADER_ROOT, null]]))).toBe(true);
    expect(isPlacementRoot(HEADER_ROOT, new Map())).toBe(true);
  });

  it('non-source keys are never placement roots', () => {
    expect(isPlacementRoot('el-abc', new Map())).toBe(false);
    expect(isPlacementRoot('el-abc:h2-0', new Map())).toBe(false);
    expect(isPlacementRoot('drawn-xyz', new Map())).toBe(false);
    expect(isPlacementRoot(null, new Map())).toBe(false);
  });

  it('a cycle among untracked ancestors terminates instead of hanging', () => {
    const scanned = tree([
      [HEADER_H2, 'dynamic:div:1@a'],
      ['dynamic:div:1@a', 'dynamic:div:2@b'],
      ['dynamic:div:2@b', 'dynamic:div:1@a'],
    ]);
    expect(isPlacementRoot(HEADER_H2, scanned)).toBe(true); // no source ancestor found
  });
});
