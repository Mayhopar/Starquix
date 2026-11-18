/** instant-edit P0b: the parent's bookkeeping of class intents (pure module: no yjs, no db). */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClassIntentsForTests, clearIntentProject, frameUnderstandsIntents, intentOfOrigin, noteClassIntent, noteIntentAccepted,
  registerIntentOp, releaseIntentOp, reserveIntentSeq, setFrameIntentVersion, settledIntents, unlandedIntents, planSettleMessage, dropClassIntent, notePaintedKey,
} from '../classIntents';

beforeEach(() => _resetClassIntentsForTests());
const entry = (key: string, seq: number, rev: number, classes: string | null = 'w-1') => ({ key, epoch: 'e', seq, classes, rev });

describe('seq', () => {
  it('is monotone in call order and shares one epoch for the module lifetime', () => {
    const a = reserveIntentSeq(), b = reserveIntentSeq(), c = reserveIntentSeq();
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(new Set([a.epoch, b.epoch, c.epoch]).size).toBe(1);
  });
});

describe('op registry (what the doc observer reads synchronously inside the accepted apply)', () => {
  it('returns the seq, the accepted revision and the held keys of the op behind a durable-edit origin', () => {
    registerIntentOp('p', 'op-1', { epoch: 'e', seq: 7 });
    noteIntentAccepted('p', 'op-1', 12, new Set(['k1']));
    const tag = intentOfOrigin('p', 'durable-edit:op-1')!;
    expect(tag).toMatchObject({ op: 'op-1', epoch: 'e', seq: 7, rev: 12 });
    expect(tag.holdKeys!.has('k1')).toBe(true);
    expect(tag.holdKeys!.has('k2')).toBe(false);
  });
  it('a writer that reports no keys holds nothing', () => {
    registerIntentOp('p', 'op-2', { epoch: 'e', seq: 1 });
    noteIntentAccepted('p', 'op-2', 3, undefined);
    expect(intentOfOrigin('p', 'durable-edit:op-2')!.holdKeys).toBeNull();
  });
  it('ignores non-durable origins, unknown ops and other projects', () => {
    registerIntentOp('p', 'op-3', { epoch: 'e', seq: 1 });
    expect(intentOfOrigin('p', 'sync')).toBeUndefined();
    expect(intentOfOrigin('p', { not: 'a string' })).toBeUndefined();
    expect(intentOfOrigin('p', 'durable-edit:other')).toBeUndefined();
    expect(intentOfOrigin('q', 'durable-edit:op-3')).toBeUndefined();
    expect(intentOfOrigin(null, 'durable-edit:op-3')).toBeUndefined();
  });
  it('an op id that itself contains a prefix colon (class-edit:uuid, undo:uuid) round-trips', () => {
    registerIntentOp('p', 'class-edit:abc', { epoch: 'e', seq: 2 });
    expect(intentOfOrigin('p', 'durable-edit:class-edit:abc')?.op).toBe('class-edit:abc');
  });
  it('releases the op once it has been observed', () => {
    registerIntentOp('p', 'op-4', { epoch: 'e', seq: 1 });
    releaseIntentOp('p', 'op-4');
    expect(intentOfOrigin('p', 'durable-edit:op-4')).toBeUndefined();
  });
});

describe('per-key entries and settling', () => {
  it('the newest seq wins per key; hold:false drops the entry', () => {
    noteClassIntent('p', entry('k', 5, 10, 'new'), true);
    noteClassIntent('p', entry('k', 4, 9, 'older'), true);
    expect(unlandedIntents('p', 0)).toEqual([expect.objectContaining({ seq: 5, classes: 'new' })]);
    noteClassIntent('p', entry('k', 6, 11), false);
    expect(unlandedIntents('p', 0)).toEqual([]);
  });
  it('splits settled (rev <= materialized) from unlanded', () => {
    noteClassIntent('p', entry('a', 1, 5), true);
    noteClassIntent('p', entry('b', 2, 8), true);
    expect(settledIntents('p', 5, 1000).map(e => e.key)).toEqual(['a']);
    expect(unlandedIntents('p', 5).map(e => e.key)).toEqual(['b']);
    expect(settledIntents('p', 9, 1000).map(e => e.key).sort()).toEqual(['a', 'b']);
  });
  it('a settled entry stays readable (six canvases each post it once) for 30 s, then is dropped', () => {
    noteClassIntent('p', entry('a', 1, 5), true);
    expect(settledIntents('p', 5, 1000)).toHaveLength(1);
    expect(settledIntents('p', 5, 20_000)).toHaveLength(1);
    expect(settledIntents('p', 5, 32_000)).toHaveLength(0);
    expect(unlandedIntents('p', 0)).toHaveLength(0);
  });
  it('is scoped by project: project A never leaks into B, and clearing A leaves B', () => {
    noteClassIntent('A', entry('k', 1, 5), true);
    noteClassIntent('B', entry('k', 1, 5), true);
    expect(unlandedIntents('B', 0)).toHaveLength(1);
    clearIntentProject('A');
    expect(unlandedIntents('A', 0)).toEqual([]);
    expect(unlandedIntents('B', 0)).toHaveLength(1);
  });
});

describe('per-document capability', () => {
  it('attaches intents only to a frame whose bridge announced classIntentV >= 1', () => {
    const frame = {}, old = {};
    expect(frameUnderstandsIntents(frame)).toBe(false);
    setFrameIntentVersion(frame, 1);
    setFrameIntentVersion(old, undefined);
    expect(frameUnderstandsIntents(frame)).toBe(true);
    expect(frameUnderstandsIntents(old)).toBe(false);
    expect(frameUnderstandsIntents(null)).toBe(false);
    setFrameIntentVersion(frame, 0);   // a reloaded document of an old bridge
    expect(frameUnderstandsIntents(frame)).toBe(false);
  });
});

describe('planSettleMessage (what one canvas is told)', () => {
  const fresh = () => ({ posted: new Map<string, number>(), lastAlive: 0 });
  it('tells a canvas about each landed key+seq once, and about unlanded ones as alive at most every 10 s', () => {
    noteClassIntent('p', entry('a', 1, 5), true);
    noteClassIntent('p', entry('b', 2, 9), true);
    const state = fresh();
    const first = planSettleMessage('p', 5, 100_000, state)!;
    expect(first.settled.map(i => i.key)).toEqual(['a']);
    expect(first.alive.map(i => i.key)).toEqual(['b']);
    expect(planSettleMessage('p', 5, 101_000, state)).toBeNull();                       // told already; alive not due
    expect(planSettleMessage('p', 5, 111_000, state)!.settled).toEqual([]);             // alive due again
    expect(planSettleMessage('p', 9, 112_000, state)!.settled.map(i => i.key)).toEqual(['b']);
  });
  it('a newer seq of the same key is told again; each canvas has its own memory', () => {
    noteClassIntent('p', entry('a', 1, 5), true);
    const one = fresh(), two = fresh();
    expect(planSettleMessage('p', 5, 1000, one)!.settled).toHaveLength(1);
    expect(planSettleMessage('p', 5, 1000, two)!.settled).toHaveLength(1);
    noteClassIntent('p', entry('a', 3, 7), true);
    expect(planSettleMessage('p', 7, 2000, one)!.settled).toEqual([expect.objectContaining({ key: 'a', seq: 3 })]);
  });
  it('a painted entry that is not accepted yet (rev Infinity) is alive, never settled', () => {
    noteClassIntent('p', entry('a', 1, Infinity), true);
    const plan = planSettleMessage('p', 99, 50_000, fresh())!;
    expect(plan.settled).toEqual([]);
    expect(plan.alive.map(i => i.key)).toEqual(['a']);
  });
});

describe('painted writes and rejection', () => {
  it('records painted keys on the op the observer reads', () => {
    registerIntentOp('p', 'op-9', { epoch: 'e', seq: 1 });
    registerIntentOp('p', 'op-9', { epoch: 'e', seq: 99 });   // idempotent: the lane\'s own call keeps the writer\'s record
    notePaintedKey('p', 'op-9', 'k1');
    const tag = intentOfOrigin('p', 'durable-edit:op-9')!;
    expect(tag.seq).toBe(1);
    expect(tag.painted.has('k1')).toBe(true);
  });
  it('binding the revision of a painted entry keeps the accepted write it replaced', () => {
    noteClassIntent('p', entry('k', 1, 5, 'accepted'), true);                  // accepted, not landed
    noteClassIntent('p', entry('k', 2, Infinity, 'painted'), true);            // the paint
    noteClassIntent('p', entry('k', 2, 8, 'painted'), true);                   // bound at acceptance
    const kept = unlandedIntents('p', 0)[0];
    expect(kept).toMatchObject({ seq: 2, rev: 8 });
    expect(kept.previous).toMatchObject({ seq: 1, classes: 'accepted' });
  });
  it('a rejected paint is dropped; the accepted write under it holds again; a newer paint blocks the restore', () => {
    noteClassIntent('p', entry('k', 1, 5, 'accepted'), true);
    noteClassIntent('p', entry('k', 2, Infinity, 'painted'), true);
    const rolled = dropClassIntent('p', 'k', 2);
    expect(rolled.current).toBe(true);
    expect(rolled.previous).toMatchObject({ seq: 1, classes: 'accepted' });
    expect(unlandedIntents('p', 0)).toEqual([]);
    noteClassIntent('p', entry('k', 3, Infinity, 'older paint'), true);
    noteClassIntent('p', entry('k', 4, Infinity, 'newer paint'), true);
    expect(dropClassIntent('p', 'k', 3).current).toBe(false);                   // a newer paint exists: the canvas stays
    expect(unlandedIntents('p', 0)).toHaveLength(1);
  });
});
