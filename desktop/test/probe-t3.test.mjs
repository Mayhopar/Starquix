// T3 "no late change" analysis of the probe harness (desktop/probe/t3.mjs): class-attribute mutations per element, counted at CLASS level (any string
// change, token sets decide what the "final value" is) and at VISIBLE-FRAME level (the wrong value stood across a frame tick). Never reads rects:
// a user CSS transition cannot fake a late change. Design: docs/plans/2026-11-17-instant-edit-design.md 4.2 / 4.3 (G-T3).
import { describe, expect, it } from 'vitest';
import { canon, classTimelines } from '../probe/t3.mjs';

const rec = (id, t, old, val, extra = {}) => ({ t, id, n: extra.n ?? id, eid: extra.eid ?? '', tag: 'IMG', old, val });
const ticks = (from, to, step = 16) => { const out = []; for (let t = from; t <= to; t += step) out.push(t); return out; };
// image 1 typed 3, 30, 300 (keys at 10, 100, 190) and painted at 100, 190, 280
const TYPED = [rec(1, 100, 'w-full rounded', 'w-[3px] rounded'), rec(1, 190, 'w-[3px] rounded', 'w-[30px] rounded'), rec(1, 280, 'w-[30px] rounded', 'w-[300px] rounded')];
const KEYS = [{ n: 1, t: 10 }, { n: 1, t: 100 }, { n: 1, t: 190 }];
const only = r => r.elements[0];

describe('canon: the token set of a class string, bridge-owned sq-ai tokens left out', () => {
  it('sorts, de-duplicates and drops sq-ai-* tokens', () => {
    expect(canon('b a a sq-ai-appear  c')).toBe('a b c');
    expect(canon('w-[300px] rounded')).toBe(canon('rounded w-[300px]'));
    expect(canon(null)).toBe('');
    expect(canon(undefined)).toBe('');
  });
});

describe('classTimelines: the final value and what happens after it', () => {
  it('a clean typed run has no late change: 3, 30, 300 and nothing after the final value', () => {
    const r = classTimelines({ records: TYPED, inputs: KEYS, ticks: ticks(0, 2000), tEnd: 2000 });
    expect(r.elements).toHaveLength(1);
    expect(only(r)).toMatchObject({ n: 1, label: 1, edited: true, initial: 'rounded w-full', final: 'rounded w-[300px]', lastInputAt: 190, reachedAt: 280, neverReached: false, mutations: 3,
      late: { mutations: 0, valueChanges: 0, other: 0, wrongStates: 0, visibleWrong: 0, dwellMs: 0, noop: 0 }, collateral: 0 });
    expect(only(r).states.map(s => s.key)).toEqual(['rounded w-[3px]', 'rounded w-[30px]', 'rounded w-[300px]']);
    expect(r.totals).toMatchObject({ lateMutations: 0, lateWrongStates: 0, lateVisible: 0, collateral: 0, dwellMs: 0, maxDwellMs: 0 });
  });

  it('a stale class written after the final value is a late mutation, a wrong state and its restore a second mutation; dwell is the time on the wrong value', () => {
    const records = [...TYPED, rec(1, 1200, 'w-[300px] rounded', 'w-[30px] rounded'), rec(1, 1240, 'w-[30px] rounded', 'w-[300px] rounded')];
    const r = classTimelines({ records, inputs: KEYS, ticks: ticks(0, 2000), tEnd: 2000 });
    expect(only(r).late).toMatchObject({ mutations: 2, valueChanges: 2, other: 0, wrongStates: 1, visibleWrong: 1, dwellMs: 40, maxDwellMs: 40 });
    expect(r.totals).toMatchObject({ lateMutations: 2, lateOnEdited: 2, lateWrongStates: 1, lateVisible: 1, dwellMs: 40, maxDwellMs: 40 });
  });

  it('class level versus visible level: a wrong value that no frame tick stood on is counted, but not as visible', () => {
    const records = [...TYPED, rec(1, 1200, 'w-[300px] rounded', 'w-[30px] rounded'), rec(1, 1205, 'w-[30px] rounded', 'w-[300px] rounded')];
    const none = classTimelines({ records, inputs: KEYS, ticks: [1000, 1100, 1210, 1300], tEnd: 2000 });
    expect(only(none).late).toMatchObject({ mutations: 2, wrongStates: 1, visibleWrong: 0, dwellMs: 5 });
    const seen = classTimelines({ records, inputs: KEYS, ticks: [1000, 1203, 1300], tEnd: 2000 });
    expect(only(seen).late).toMatchObject({ mutations: 2, wrongStates: 1, visibleWrong: 1 });
    const noTicks = classTimelines({ records, inputs: KEYS, tEnd: 2000 });
    expect(only(noTicks).late.visibleWrong).toBe(0);
  });

  it('a reordered but equal class is a mutation (planAttrPatch compares strings) and not a wrong value; so is a sq-ai flash class', () => {
    const records = [...TYPED, rec(1, 1500, 'w-[300px] rounded', 'rounded w-[300px]'), rec(1, 1600, 'rounded w-[300px]', 'rounded w-[300px] sq-ai-appear'), rec(1, 1900, 'rounded w-[300px] sq-ai-appear', 'rounded w-[300px]')];
    const r = classTimelines({ records, inputs: KEYS, ticks: ticks(0, 2000), tEnd: 2000 });
    expect(only(r).late).toMatchObject({ mutations: 3, valueChanges: 0, other: 3, wrongStates: 0, dwellMs: 0 });
  });

  it('a write of the same string is no change: counted apart as noop', () => {
    const records = [...TYPED, rec(1, 1500, 'w-[300px] rounded', 'w-[300px] rounded')];
    const r = classTimelines({ records, inputs: KEYS, ticks: ticks(0, 2000), tEnd: 2000 });
    expect(only(r).late).toMatchObject({ mutations: 0, noop: 1 });
    expect(only(r).mutations).toBe(3);
    expect(r.totals.noop).toBe(1);
  });

  it('a revisit (100, 150, 100 in three gestures) is not late: the final value counts from its first arrival AFTER the last input', () => {
    const records = [rec(1, 100, 'w-48 rounded', 'w-[100px] rounded'), rec(1, 700, 'w-[100px] rounded', 'w-[150px] rounded'), rec(1, 1300, 'w-[150px] rounded', 'w-[100px] rounded')];
    const r = classTimelines({ records, inputs: [{ n: 1, t: 90 }, { n: 1, t: 690 }, { n: 1, t: 1290 }], ticks: ticks(0, 2000), tEnd: 2000 });
    expect(only(r)).toMatchObject({ reachedAt: 1300, neverReached: false, late: { mutations: 0, wrongStates: 0 } });
    // the same states with a hold bug: 150 is painted again after the last gesture's value
    const bug = classTimelines({ records: [...records, rec(1, 1500, 'w-[100px] rounded', 'w-[150px] rounded'), rec(1, 1540, 'w-[150px] rounded', 'w-[100px] rounded')], inputs: [{ n: 1, t: 90 }, { n: 1, t: 690 }, { n: 1, t: 1290 }], ticks: ticks(0, 2000), tEnd: 2000 });
    expect(only(bug).late).toMatchObject({ mutations: 2, wrongStates: 1, dwellMs: 40 });
  });

  it('an element with no input at all is collateral: every class change on it is unexpected, whatever it was', () => {
    const records = [...TYPED, rec(2, 500, 'w-48 rounded', 'w-1/2 rounded', { n: 2 }), rec(2, 900, 'w-1/2 rounded', 'w-48 rounded', { n: 2 })];
    const r = classTimelines({ records, inputs: KEYS, ticks: ticks(0, 2000), tEnd: 2000 });
    const other = r.elements.find(e => e.n === 2);
    expect(other).toMatchObject({ edited: false, collateral: 2, late: { mutations: 0 } });
    expect(r.totals).toMatchObject({ collateral: 2, lateOnEdited: 0, lateMutations: 2 });
  });

  it('elements without a probe number (the #fx frame, any page element) are matched to inputs by their id', () => {
    const records = [{ t: 300, id: 7, n: null, eid: 'fx', tag: 'DIV', old: 'h-40 bg-cover', val: 'h-40 bg-contain' }, { t: 900, id: 7, n: null, eid: 'fx', tag: 'DIV', old: 'h-40 bg-contain', val: 'h-40 bg-cover' }];
    const r = classTimelines({ records, inputs: [{ n: 'fx', t: 250 }], ticks: ticks(0, 1500), tEnd: 1500 });
    expect(r.elements[0]).toMatchObject({ label: '#fx', edited: true, reachedAt: 900, neverReached: false });
    const bare = classTimelines({ records: [{ t: 300, id: 9, n: null, eid: '', tag: 'P', old: 'a', val: 'b' }], inputs: [], tEnd: 1500 });
    expect(bare.elements[0]).toMatchObject({ label: 'p@9', edited: false, collateral: 1 });
  });

  it('an element whose final value never arrived after its last input says so instead of counting anything late', () => {
    const r = classTimelines({ records: [rec(1, 100, 'w-full', 'w-[3px]')], inputs: [{ n: 1, t: 500 }], ticks: ticks(0, 1000), tEnd: 1000 });
    expect(only(r)).toMatchObject({ neverReached: true, reachedAt: null, late: { mutations: 0 } });
    expect(r.totals.neverReached).toBe(1);
  });

  it('sums every edited element, keeps the worst dwell and ignores records out of order', () => {
    const r1 = [...TYPED, rec(1, 1200, 'w-[300px] rounded', 'w-[30px] rounded'), rec(1, 1300, 'w-[30px] rounded', 'w-[300px] rounded')];
    const r2 = [rec(2, 120, 'w-48', 'w-[2px]', { n: 2 }), rec(2, 210, 'w-[2px]', 'w-[20px]', { n: 2 }), rec(2, 300, 'w-[20px]', 'w-[200px]', { n: 2 }), rec(2, 1250, 'w-[200px]', 'w-[20px]', { n: 2 }), rec(2, 1290, 'w-[20px]', 'w-[200px]', { n: 2 })];
    const r = classTimelines({ records: [...r2, ...r1].reverse(), inputs: [...KEYS, { n: 2, t: 210 }], ticks: ticks(0, 2000), tEnd: 2000 });
    expect(r.elements.map(e => e.n)).toEqual([1, 2]);
    expect(r.totals).toMatchObject({ lateMutations: 4, lateWrongStates: 2, dwellMs: 140, maxDwellMs: 100, edited: 2 });
  });

  it('an expected final token names the final value: a capture that ends on a stale class (truncated hold) still counts it as late', () => {
    const climb = Array.from({ length: 6 }, (_, i) => rec(1, 100 + i * 33, i ? `w-[${100 + i}px] rounded` : 'w-[100px] rounded', `w-[${101 + i}px] rounded`));
    const records = [...climb, rec(1, 1200, 'w-[106px] rounded', 'w-[104px] rounded')]; // the climb reached 106, then a stale morph wrote 104 and the capture ended
    const inputs = [{ n: 1, t: 260 }];
    const blind = classTimelines({ records, inputs, ticks: ticks(0, 1300), tEnd: 1300 });
    expect(only(blind)).toMatchObject({ final: 'rounded w-[104px]', late: { mutations: 0 } }); // the observed last state is taken for the final value
    const told = classTimelines({ records, inputs, ticks: ticks(0, 1300), tEnd: 1300, expect: { 1: 'w-[106px]' } });
    expect(only(told)).toMatchObject({ final: 'rounded w-[106px]', reachedAt: 265, late: { mutations: 1, wrongStates: 1, dwellMs: 100, visibleWrong: 1 } });
    // a capture that ends on the stale class: its last frames (recorded just after the stop mark) are the ones that stood on it
    const censored = classTimelines({ records, inputs, ticks: ticks(0, 1320), tEnd: 1210, expect: { 1: 'w-[106px]' } });
    expect(only(censored).late).toMatchObject({ wrongStates: 1, visibleWrong: 1 });
    expect(only(censored).late.dwellMs).toBeGreaterThan(100);
    // an expected token that never appeared leaves the observed last state as the final value (the final-value checks flag that run, not this one)
    const never = classTimelines({ records, inputs, ticks: ticks(0, 1300), tEnd: 1300, expect: { 1: 'w-[161px]' } });
    expect(only(never).final).toBe('rounded w-[104px]');
  });

  it('an expected class value (an undo to the pre-edit class) names the final value even when the capture ends on something else: the lost undo is late wrong states, not the final', () => {
    // image 2: edited to w-1, undone to w-48 at 2167, then the replay flashes the edit value back and the canvas ENDS on it
    const records = [rec(2, 1187, 'w-48 rounded', 'rounded w-1', { n: 2 }), rec(2, 2167, 'rounded w-1', 'w-48 rounded', { n: 2 }), rec(2, 2374, 'w-48 rounded', 'rounded w-1', { n: 2 }), rec(2, 4220, 'rounded w-1', 'w-48 rounded', { n: 2 }), rec(2, 4224, 'w-48 rounded', 'rounded w-1', { n: 2 })];
    const inputs = [{ n: 2, t: 1180 }, { n: 2, t: 2150 }]; // the edit, then Cmd-Z
    const blind = classTimelines({ records, inputs, ticks: ticks(0, 5000), tEnd: 5000 });
    expect(only(blind)).toMatchObject({ final: 'rounded w-1', last: 'rounded w-1', late: { mutations: 2, wrongStates: 1 } }); // the observed end is taken for the final value: the CORRECT class looks wrong
    const told = classTimelines({ records, inputs, ticks: ticks(0, 5000), tEnd: 5000, expect: { 2: { eq: 'rounded w-48' } } });
    expect(only(told)).toMatchObject({ final: 'rounded w-48', last: 'rounded w-1', reachedAt: 2167, late: { mutations: 3, wrongStates: 2, visibleWrong: 2 } }); // `last` = where the canvas really ended
    expect(only(told).late.dwellMs).toBeGreaterThan(700); // 2374 -> 4220 is not on the pre-edit class... and the capture ends on the edit value
    // has / not: a class that carries and lacks tokens (the undo of a second edit: back to the first edit's value)
    const mid = [rec(1, 100, 'w-full', 'w-[3px]'), rec(1, 700, 'w-[3px]', 'w-[5px]'), rec(1, 3000, 'w-[5px]', 'w-[3px]'), rec(1, 3500, 'w-[3px]', 'w-[5px]')];
    const m = classTimelines({ records: mid, inputs: [{ n: 1, t: 2990 }], ticks: ticks(0, 4000), tEnd: 4000, expect: { 1: { has: ['w-[3px]'], not: ['w-[5px]'] } } });
    expect(only(m)).toMatchObject({ final: 'w-[3px]', reachedAt: 3000, late: { mutations: 1, wrongStates: 1 } });
  });

  it('keeps an element\'s states in time order and caps nothing: the analyzer compacts them, not this function', () => {
    const many = Array.from({ length: 200 }, (_, i) => rec(1, 100 + i * 10, `w-[${i}px]`, `w-[${i + 1}px]`));
    const r = classTimelines({ records: many, inputs: [{ n: 1, t: 50 }], ticks: [], tEnd: 3000 });
    expect(only(r).states).toHaveLength(200);
    expect(only(r).states.map(s => s.t)).toEqual([...only(r).states.map(s => s.t)].sort((a, b) => a - b));
  });
});
