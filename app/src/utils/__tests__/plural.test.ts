/**
 * Number agreement — the ONE helper every counted string uses.
 *
 * Three copies of `const plural = (n, word) => ...` had grown in
 * InstanceMenu / ComponentUsageBadge / localMasterOverrides, and none of them
 * agreed the VERB. Blind review, 2026-08-04, verbatim: "`1 placement override`
 * and `1 other placement keep` — singular/plural agreement." A noun helper
 * alone cannot fix that: English inflects the noun for n !== 1 and the verb for
 * n === 1, in opposite directions.
 */
import { describe, it, expect } from 'vitest';
import { plural, verb } from '../plural';

describe('plural — noun agreement', () => {
  it('leaves the singular alone at 1', () => {
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(1, 'other placement')).toBe('1 other placement');
  });

  it('adds -s for every other count, zero included', () => {
    expect(plural(0, 'change')).toBe('0 changes');
    expect(plural(2, 'change')).toBe('2 changes');
    expect(plural(11, 'other placement')).toBe('11 other placements');
  });

  it('takes an explicit plural for irregulars', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });
});

describe('verb — subject/verb agreement (inverted from the noun)', () => {
  it('adds -s at 1, because the SUBJECT is singular', () => {
    expect(verb(1, 'override')).toBe('overrides');
    expect(verb(1, 'keep')).toBe('keeps');
    expect(verb(1, 'render')).toBe('renders');
  });

  it('leaves the bare form for every other count', () => {
    expect(verb(0, 'override')).toBe('override');
    expect(verb(2, 'override')).toBe('override');
  });

  it('takes an explicit singular for irregulars', () => {
    expect(verb(1, 'have', 'has')).toBe('has');
    expect(verb(2, 'have', 'has')).toBe('have');
  });
});

describe('the two together produce the strings the review flagged', () => {
  it('`1 placement overrides`, not `1 placement override`', () => {
    const n = 1;
    expect(`${plural(n, 'placement')} ${verb(n, 'override')}`).toBe('1 placement overrides');
  });

  it('`1 other placement keeps`, not `1 other placement keep`', () => {
    const n = 1;
    expect(`${plural(n, 'other placement')} ${verb(n, 'keep')}`).toBe('1 other placement keeps');
  });

  it('and still agree at 2', () => {
    expect(`${plural(2, 'placement')} ${verb(2, 'override')}`).toBe('2 placements override');
  });
});
