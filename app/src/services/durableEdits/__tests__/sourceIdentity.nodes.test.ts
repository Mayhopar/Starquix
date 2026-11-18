/** P0a (instant-edit): nodes() computed every element's line and column by re-splitting the prefix
 * (E x S: 38 ms at E = 509 on a 54 KB page, several times per edit). Now one pass of line starts + a
 * binary search. The answer must be byte-for-byte the old one. */
import { describe, expect, it } from 'vitest';
import { attributeIdentityMap } from '../sourceIdentity';
// @ts-expect-error browser-safe shared transform module
import { scanTopLevelElements, templateStartOffset } from '../../../../../preview-template/src/plugins/sq-source-transforms.js';

/** The pre-change implementation, verbatim, as the reference. */
function referenceCoordinates(source: string): Array<{ line: number; column: number }> {
  const text = source.replace(/\r\n/g, '\n');
  const result: Array<{ line: number; column: number }> = [];
  const walk = (fragment: string, base: number) => {
    for (const span of scanTopLevelElements(fragment)) {
      const start = base + span.start;
      result.push({ line: text.slice(0, start).split('\n').length, column: start - text.lastIndexOf('\n', start - 1) });
      if (span.closeStart !== null && !/^(script|style|textarea)$/i.test(span.tag)) walk(fragment.slice(span.openEnd, span.closeStart), base + span.openEnd);
    }
  };
  const start = templateStartOffset(text);
  walk(text.slice(start), start);
  return result;
}
const actual = (source: string) => attributeIdentityMap(source, source).entries.map(entry => entry.before);

const big = (n: number) => `---\nconst title = 'Gallery';\n---\n<main>\n${Array.from({ length: n }, (_, i) =>
  `  <section class="s-${i}"><img alt="Probe image ${i}" class="w-[${i}px]" /><p>é ü 🙂 ${i}</p></section>`).join('\n')}\n</main>\n`;

describe('nodes(): line and column parity with the quadratic reference', () => {
  const cases: Array<[string, string]> = [
    ['plain LF page', '<div>\n  <p>a</p>\n  <p>b</p>\n</div>\n'],
    ['CRLF line endings', '<div>\r\n  <p>a</p>\r\n  <p>b</p>\r\n</div>\r\n'],
    ['same-line siblings', '<ul><li>1</li><li>2</li><li>3</li></ul>\n<a href="/">x</a><b>y</b>'],
    ['multibyte text before the elements', '<p>héllo wörld 🙂 日本語</p>\n<p>😀😀</p><i>z</i>\n'],
    ['frontmatter then template', '---\nconst x = 1;\nconst y = `\n multi\n`;\n---\n<div><span>q</span></div>\n'],
    ['no trailing newline, element at the very start', '<a><b></b></a>'],
    ['blank lines and leading whitespace', '\n\n   <div>\n\n\n      <p>a</p>\n   </div>'],
    ['an element on the first template line after frontmatter close', '---\n---\n<x />'],
    ['511 elements (the owner copy size)', big(170)],
  ];
  it.each(cases)('%s', (_name, source) => {
    const expected = referenceCoordinates(source);
    expect(expected.length).toBeGreaterThan(0);
    expect(actual(source)).toEqual(expected);
  });
  it('the owner-size case really has about 500 elements', () => {
    expect(referenceCoordinates(big(170)).length).toBeGreaterThanOrEqual(500);
  });
  it('is not quadratic: 20x the elements stay well under a second', () => {
    const source = big(2000);
    const t0 = performance.now();
    expect(actual(source).length).toBeGreaterThan(5000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
