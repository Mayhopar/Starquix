import { describe, it, expect } from 'vitest';
import { parseSourceLocationFromKey } from './sourceLocationKey';

describe('parseSourceLocationFromKey', () => {
  it('parses a well-formed file:line:column key', () => {
    expect(parseSourceLocationFromKey('src/Hero.astro:5:1')).toEqual({
      file: 'src/Hero.astro',
      line: 5,
      column: 1,
    });
  });

  it('returns null for malformed input', () => {
    expect(parseSourceLocationFromKey('not-a-source-key')).toBeNull();
    expect(parseSourceLocationFromKey('src/Hero.astro:abc:1')).toBeNull();
    expect(parseSourceLocationFromKey('')).toBeNull();
  });

  it('keeps colons inside the file portion', () => {
    expect(parseSourceLocationFromKey('weird:path.astro:10:3')).toEqual({
      file: 'weird:path.astro',
      line: 10,
      column: 3,
    });
  });

  /**
   * SILENT DATA LOSS, found 2026-08-05.
   *
   * A source key has three legal tails (store/types.ts `PLACEMENT_TAIL`,
   * bridge/parts/head.ts `PLACEMENT_KEY_PATTERN`): `~<pqs><16 hex>` (the
   * task-149/159/160 placement — WHICH invocation of the component this element
   * belongs to), `#N` (the scanner's intra-placement repeat counter), or both.
   *
   * This helper's own regex ended at `:(\d+)$`, so EVERY key carrying either
   * tail parsed as null. Its only load-bearing consumer is
   * `hooks/useSourceImageSync.ts` (lines 33 and 89), where `null` is an early
   * `return` — so in local mode, where every component-owned element carries a
   * placement, an image edit was accepted by the UI, stored in the doc, and
   * NEVER written to the user's file. No error, no toast, no log.
   *
   * The grammar is pinned in three places already; this file must not add a
   * fourth — it delegates to `parseKey`, which owns the tails.
   */
  it('parses a placement-scoped key — all three id schemes', () => {
    for (const scheme of ['p', 'q', 's']) {
      expect(
        parseSourceLocationFromKey(`src/components/Hero.astro:5:1~${scheme}0188f2e85ea7b276`),
      ).toEqual({ file: 'src/components/Hero.astro', line: 5, column: 1 });
    }
  });

  it('parses a repeat-suffixed key, with and without a placement', () => {
    expect(parseSourceLocationFromKey('src/components/Hero.astro:5:1#2')).toEqual({
      file: 'src/components/Hero.astro',
      line: 5,
      column: 1,
    });
    expect(
      parseSourceLocationFromKey('src/components/Hero.astro:5:1~p0188f2e85ea7b276#3'),
    ).toEqual({ file: 'src/components/Hero.astro', line: 5, column: 1 });
  });

  it('still rejects a non-source key, and a bogus tail is not a placement', () => {
    // `~` is legal in a path; only `~<pqs><16 hex>` at the tail is a placement.
    expect(parseSourceLocationFromKey('src/a~b.astro:5:1')).toEqual({
      file: 'src/a~b.astro',
      line: 5,
      column: 1,
    });
    expect(parseSourceLocationFromKey('el-abc123')).toBeNull();
    expect(parseSourceLocationFromKey('el-abc123:h1-0')).toBeNull();
    expect(parseSourceLocationFromKey('drawn-xyz')).toBeNull();
  });
});
