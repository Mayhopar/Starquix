/**
 * task-159 — the placement site string must survive a LINE SHIFT.
 *
 * The owner's defect, reproduced on real served bytes before this test was
 * written (rig: a layout placing `<SiteNav/>` twice, `astro dev` 4.16.19):
 *
 *   before   top=pe6f8cae40c888072   bottom=p93bc2faa3a8ad14c
 *   +2 lines top=p93bc2faa3a8ad14c   bottom=p0bea0b737f73ea97
 *            ^^^^^^^^^^^^^^^^^^^^ the BOTTOM nav's old id
 *
 * The top nav then renders the bottom nav's overrides, the panel claims edits
 * on a placement nobody touched, and Push writes the wrong bytes into the
 * shared component. Silently.
 *
 * The cause is that the hashed site string was `<file>:<line>:<col>` — a
 * coordinate, and coordinates move. It is now a COMPILE-TIME ORDINAL derived
 * from the AST: `<file>|<import specifier><member path>#<n>`, where n counts
 * taggable invocations of that specifier within that file, in source order.
 *
 * That is NOT the banned live-DOM ordinal (§Dead ends / §Rejected in
 * docs/archive/plans/2026-08-03-local-instance-overrides-ledger.md): the number is
 * frozen into a string literal in the emitted module before the browser sees
 * it, so a conditional, hydration, View Transitions or a `.map()` cannot
 * re-index it. Pinned by the `{show && <Card/>}` case at the bottom.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@astrojs/compiler';
// eslint-disable-next-line import/no-relative-packages
import { transformCompiledOutput } from '../../../../preview-template/src/plugins/sq-tagging.js';
import goldens from './fixtures/sq-tagging-goldens.json';

interface Golden {
  name: string;
  source: string;
  filePath: string;
  compiled: string;
}
const CORPUS = goldens as unknown as Golden[];
const byName = (n: string) => CORPUS.find((g) => g.name === n)!;

async function sitesOf(source: string, g: Golden): Promise<string[]> {
  const out = await transformCompiledOutput(
    g.compiled,
    source,
    g.filePath,
    '/proj',
    'relative',
    parse,
    { placements: true },
  );
  expect(out).toBeTruthy();
  const code = (out as { code: string }).code;
  return [...code.matchAll(/\$\$sqSite\(\$\$props,"([^"]+)"/g)].map((m) => m[1]);
}

/** Insert `n` blank/comment lines into the frontmatter — an import, a comment,
 *  anything. Every template line below shifts down by `n`; nothing else moves. */
function shiftFrontmatter(source: string, n: number): string {
  const lines = source.split('\n');
  const closeIdx = lines.indexOf('---', 1);
  const filler = Array.from({ length: n }, (_, i) => `// added line ${i + 1}`);
  return [...lines.slice(0, closeIdx), ...filler, ...lines.slice(closeIdx)].join('\n');
}

/** Re-indent every template line by two spaces (prettier, an editor, a wrap). */
function reindent(source: string): string {
  const lines = source.split('\n');
  const closeIdx = lines.indexOf('---', 1);
  return [
    ...lines.slice(0, closeIdx + 1),
    ...lines.slice(closeIdx + 1).map((l) => (l.trim() ? `  ${l}` : l)),
  ].join('\n');
}

describe('placement site strings survive line shifts (task-159)', () => {
  const page = byName('page');

  it('ONE line added above the invocations changes nothing', async () => {
    const before = await sitesOf(page.source, page);
    const after = await sitesOf(shiftFrontmatter(page.source, 1), page);
    expect(after).toEqual(before);
  });

  it('TWO lines added above the invocations changes nothing (the owner’s case)', async () => {
    const before = await sitesOf(page.source, page);
    const after = await sitesOf(shiftFrontmatter(page.source, 2), page);
    expect(after).toEqual(before);
  });

  it('re-indenting the whole template changes nothing', async () => {
    const before = await sitesOf(page.source, page);
    const after = await sitesOf(reindent(page.source), page);
    expect(after).toEqual(before);
  });

  it('two placements of ONE component stay DISTINCT', async () => {
    const sites = await sitesOf(page.source, page);
    const cards = sites.filter((s) => s.includes('Card'));
    expect(cards).toHaveLength(2);
    expect(cards[0]).not.toBe(cards[1]);
  });

  it('the site string carries no line:col coordinate at all', async () => {
    // A coordinate is the defect. If one is still in the string, the shift
    // cases above are passing for the wrong reason.
    for (const s of await sitesOf(page.source, page)) {
      expect(s).not.toMatch(/:\d+:\d+/);
    }
  });

  it('holds across the whole golden corpus', async () => {
    for (const g of CORPUS) {
      const before = await sitesOf(g.source, g);
      if (before.length === 0) continue;
      expect(await sitesOf(shiftFrontmatter(g.source, 3), g)).toEqual(before);
    }
  });
});
