/**
 * task-149 STEP 6 — key parsing with a placement segment.
 *
 * Local-mode element keys gain an optional `~p<16 hex>` tail (before the
 * existing `#N` repeat suffix). Five shipped consumers assume a bare
 * `file:line:col`; this pins the two that actually parse it.
 *
 * `parseKey` already "worked" on suffixed keys purely because
 * `parseInt('1~pa663…', 10)` returns 1. That accident is deliberately replaced
 * with an explicit strip: a future consumer reaching for `Number()` would get
 * NaN and silently drop every placement-scoped override.
 */
import { describe, it, expect } from 'vitest';
import { parseKey } from '../types';
import { matchPredictedKey } from '@/utils/localStructural';

const PL = 'pa66310c83f2a91c4';
const FILE = 'src/components/Card.astro';

describe('parseKey with placement segments', () => {
  const cases: Array<[string, ReturnType<typeof parseKey>]> = [
    // bare — unchanged
    [`${FILE}:4:19`, { type: 'source', file: FILE, line: 4, col: 19 }],
    // repeat suffix only — unchanged
    [`${FILE}:4:19#2`, { type: 'source', file: FILE, line: 4, col: 19 }],
    // placement
    [`${FILE}:4:19~${PL}`, { type: 'source', file: FILE, line: 4, col: 19, placement: PL }],
    // placement + repeat
    [`${FILE}:4:19~${PL}#2`, { type: 'source', file: FILE, line: 4, col: 19, placement: PL }],
    // a path containing '@' must not be mangled
    ['src/components/@ui/Btn.astro:1:1', { type: 'source', file: 'src/components/@ui/Btn.astro', line: 1, col: 1 }],
    [
      `src/components/@ui/Btn.astro:1:1~${PL}`,
      { type: 'source', file: 'src/components/@ui/Btn.astro', line: 1, col: 1, placement: PL },
    ],
    // non-source keys are untouched
    ['el-x:h2-0', { type: 'instance-child', instanceId: 'el-x', selector: 'h2-0' }],
    ['el-x', { type: 'instance-root', instanceId: 'el-x' }],
    ['dynamic:div:3@abc', { type: 'instance-root', instanceId: 'dynamic:div:3@abc' }],
  ];

  for (const [key, expected] of cases) {
    it(`parses ${key}`, () => {
      expect(parseKey(key)).toEqual(expected);
    });
  }

  it('leaves `placement` absent (not undefined-valued) on unsuffixed source keys', () => {
    const parsed = parseKey(`${FILE}:4:19`);
    expect(parsed).not.toHaveProperty('placement');
  });

  it('does not treat a `~` inside a path as a placement', () => {
    expect(parseKey('src/~drafts/Card.astro:4:19')).toEqual({
      type: 'source',
      file: 'src/~drafts/Card.astro',
      line: 4,
      col: 19,
    });
  });

  it('does not accept a malformed placement tail', () => {
    // Wrong length / non-hex must stay part of the file segment rather than
    // being silently swallowed.
    expect(parseKey(`${FILE}:4:19~pZZZ`)).toEqual({ type: 'source', file: FILE, line: 4, col: 19 });
  });
});

describe('localStructural key parsing accepts placement segments', () => {
  // NOTE (verified, not assumed): these two were GREEN before the fix.
  // matchPredictedKey's first branch is a literal `startsWith(file + ':' + line
  // + ':')`, which a placement-scoped key satisfies, so its private parseKey
  // fallback is not reachable from here. The fallback's regex was still widened
  // to accept `~p…` — a strict superset, defence-in-depth for any future caller
  // — but there is no red-first test for that branch because no caller can
  // reach it today. These cases pin the behaviour that DOES matter: a freshly
  // inserted element in local mode is still re-selectable after the rescan.
  it('matches a predicted insert key whose fresh scan key carries a placement', () => {
    const predicted = 'src/pages/index.astro:12:';
    const fresh = [`src/pages/index.astro:12:3~${PL}`, 'src/pages/index.astro:20:1'];
    expect(matchPredictedKey(predicted, fresh)).toBe(`src/pages/index.astro:12:3~${PL}`);
  });

  it('still skips instance-suffixed repeats when a placement is present', () => {
    const fresh = [
      `src/pages/index.astro:12:3~${PL}#1`,
      `src/pages/index.astro:12:3~${PL}`,
    ];
    expect(matchPredictedKey('src/pages/index.astro:12:', fresh)).toBe(
      `src/pages/index.astro:12:3~${PL}`,
    );
  });
});
