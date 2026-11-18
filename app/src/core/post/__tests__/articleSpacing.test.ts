/**
 * Post spacing is decided by SPECIFICITY (owner 2026-09-30: "headings float
 * between sections — horrible"; "images sit lower than the text next to them").
 * Tailwind's output order across arbitrary variants is not reliable, so each
 * rule that must win carries more `&` than the rule it beats. This test
 * computes the real selector specificity of every tier and pins the order.
 */
import { describe, it, expect } from 'vitest';
import { BODY, LINES, HEADER } from '../articleTokens';
import { COLUMN_TEXT_CAP, COLUMN_NESTED, TOP_WIDTH, EDGE_INSET } from '../../stack/stackClasses';

type Spec = [number, number, number];

/** First top-level argument of a functional pseudo-class body. */
function firstArg(s: string): string {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) return s.slice(0, i);
  }
  return s;
}

/** Specificity of a selector as written by our Tailwind variants (enough of the spec for them). */
function specificity(sel: string): Spec {
  let out: Spec = [0, 0, 0];
  const add = (b: Spec) => { out = [out[0] + b[0], out[1] + b[1], out[2] + b[2]]; };
  let rest = sel;
  for (;;) {
    const m = /:(where|is|has|not)\(/.exec(rest);
    if (!m) break;
    let depth = 1, j = m.index + m[0].length;
    for (; j < rest.length && depth; j++) { if (rest[j] === '(') depth++; else if (rest[j] === ')') depth--; }
    const inner = rest.slice(m.index + m[0].length, j - 1);
    if (m[1] !== 'where') add(specificity(firstArg(inner).replace(/^[>+~\s]+/, '')));
    rest = rest.slice(0, m.index) + ' ' + rest.slice(j);
  }
  const attrs = rest.match(/\[[^\]]+\]/g) ?? [];
  rest = rest.replace(/\[[^\]]+\]/g, ' ');
  const classes = rest.match(/\.[\w-]+/g) ?? [];
  const pseudos = rest.match(/:[\w-]+/g) ?? [];
  rest = rest.replace(/\.[\w-]+|:[\w-]+/g, ' ');
  const elements = rest.match(/(^|[\s>+~])[a-z][a-z0-9]*/g) ?? [];
  add([0, attrs.length + classes.length + pseudos.length, elements.length]);
  return out;
}

const tokens = BODY.split(/\s+/);
/** The margin-top rule whose variant equals `variant` exactly (e.g. '&&&_*+:is(p,ul,ol)'). */
function rule(variantPart: string): Spec {
  const t = tokens.find(x => x.replace(/^md:/, '').startsWith(`[${variantPart}]:mt-`));
  if (!t) throw new Error(`no rule for ${variantPart}`);
  const sel = t.replace(/^md:/, '').slice(1, t.replace(/^md:/, '').indexOf(']:mt-')).replace(/_/g, ' ').replace(/&/g, '.c');
  return specificity(sel);
}
const gt = (a: Spec, b: Spec) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
const amps = (n: number) => '&'.repeat(n);

const R = {
  text: rule('&_*+:is(p,ul,ol)'),
  block: rule('&_*+:is(blockquote,pre,figure,table)'),
  mediaBefore: rule('&_*+[data-sq-unit=media]'),
  wrapperBefore: rule('&_*+[data-sq-block]'),
  afterBlock: rule(`${amps(3)}_:is(blockquote,pre,figure,table)+*`),
  afterMedia: rule(`${amps(3)}_[data-sq-unit=media]+*`),
  afterWrapper: rule(`${amps(3)}_[data-sq-block]+*`),
  hrBefore: rule(`${amps(5)}_*+hr`),
  hrAfter: rule(`${amps(5)}_hr+*`),
  h2Before: rule(`${amps(6)}_*+:is(h1,h2)`),
  stackBefore: rule(`${amps(7)}_*+[data-sq-stack]`),
  stackAfter: rule(`${amps(7)}_[data-sq-stack]+*`),
  wrappedStackBefore: rule(`${amps(7)}_*+[data-sq-block]:has(>[data-sq-stack])`),
  wrappedStackAfter: rule(`${amps(7)}_[data-sq-block]:has(>[data-sq-stack])+*`),
  headingAfter: rule(`${amps(10)}_:is(h1,h2)+*`),
  bandsJoin: rule(`${amps(12)}_[data-sq-colored]+[data-sq-colored]`),
  wrappedBandsJoin: rule(`${amps(12)}_[data-sq-block]:has(>[data-sq-colored])+[data-sq-block]:has(>[data-sq-colored])`),
  rowCells: rule(`${amps(14)}_[data-sq-stack=row]>*`),
};

describe('post spacing priority (specificity, never order)', () => {
  it('the calculator agrees with known values', () => {
    expect(specificity('.c *+p')).toEqual([0, 1, 1]);
    expect(specificity('.c.c [data-sq-block]:has(>[data-sq-stack])+*')).toEqual([0, 4, 0]);
    expect(specificity('.c :where(p,ul)')).toEqual([0, 1, 0]);
  });
  it('a heading sits closest to what it introduces — beats every "before X" rule', () => {
    for (const k of ['text', 'block', 'mediaBefore', 'wrapperBefore', 'hrBefore', 'stackBefore', 'wrappedStackBefore'] as const) {
      expect(gt(R.headingAfter, R[k]), k).toBe(true);
    }
  });
  it('a layout keeps its section gap before a heading; a heading keeps its gap after a block/rule', () => {
    expect(gt(R.stackAfter, R.h2Before)).toBe(true);
    expect(gt(R.wrappedStackAfter, R.h2Before)).toBe(true);
    for (const k of ['afterBlock', 'afterMedia', 'afterWrapper', 'hrAfter'] as const) expect(gt(R.h2Before, R[k]), k).toBe(true);
  });
  it('after a block beats text-before; a divider beats blocks; layouts beat dividers', () => {
    expect(gt(R.afterBlock, R.text)).toBe(true);
    expect(gt(R.afterWrapper, R.mediaBefore)).toBe(true);
    expect(gt(R.hrBefore, R.afterMedia)).toBe(true);
    expect(gt(R.stackBefore, R.hrAfter)).toBe(true);
  });
  it('colored bands join over any layout gap; row cells are never spaced (images top-align)', () => {
    expect(gt(R.bandsJoin, R.stackBefore)).toBe(true);
    expect(gt(R.wrappedBandsJoin, R.wrappedStackBefore)).toBe(true);
    for (const [k, v] of Object.entries(R)) if (k !== 'rowCells' && !k.includes('Join')) expect(gt(R.rowCells, v), k).toBe(true);
  });
  it('no collapse-based margins remain (every flow margin is a margin-top)', () => {
    const vertical = tokens.filter(t => /:(mb|my)-/.test(t));
    const allowed = /^\[&_(:where\(|\[data-sq-stack\]\]|\[data-sq-block\]>\[data-sq-stack\]\]|li\]|li>|blockquote>p)/;
    expect(vertical.filter(t => !allowed.test(t))).toEqual([]);
  });
});

describe('alignment lines', () => {
  it('text cap = the measure; wide = the classic cover; nested/edge content = the wide line', () => {
    expect(COLUMN_TEXT_CAP).toContain(`max-w-[${LINES.measureRem}rem]`);
    expect(HEADER.coverWide).toContain(`w-[min(${LINES.wideRem}rem,calc(100vw-2.5rem))] sm:w-[min(${LINES.wideRem}rem,calc(100vw-3rem))]`);
    // wide box = wide content + one gutter each side
    expect(TOP_WIDTH.wide).toContain(`w-[min(${LINES.wideRem + 2 * LINES.gutterRem[0]}rem,100vw)] sm:w-[min(${LINES.wideRem + 2 * LINES.gutterRem[1]}rem,100vw)] px-5 sm:px-6`);
    expect(COLUMN_NESTED).toContain(`max-w-[${LINES.wideRem}rem]`);
    expect(EDGE_INSET).toContain(`(100vw-${LINES.wideRem}rem)/2`);
  });
});
