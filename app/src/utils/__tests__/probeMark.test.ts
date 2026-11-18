import { afterEach, describe, expect, it, vi } from 'vitest';
import { pm, probeClassWrites, probeStack } from '../probeMark';

type Hook = (what: string, data?: Record<string, unknown>) => void;
const g = globalThis as unknown as { __sqProbeMark?: Hook; __sqProbeStacks?: boolean };
afterEach(() => { delete g.__sqProbeMark; delete g.__sqProbeStacks; });

describe('probe marks: strictly inert without the recorder hook', () => {
  it('does nothing and never evaluates lazy data when globalThis.__sqProbeMark is absent', () => {
    const lazy = vi.fn(() => ({ big: 'computed' }));
    expect(pm('acc:enter', lazy)).toBeUndefined();
    expect(pm('acc:enter', { op: 'x' })).toBeUndefined();
    expect(pm('acc:enter')).toBeUndefined();
    expect(lazy).not.toHaveBeenCalled();
  });

  it('stops recording the moment the recorder removes its hook', () => {
    const seen: string[] = [];
    g.__sqProbeMark = what => { seen.push(what); };
    pm('a');
    delete g.__sqProbeMark;
    pm('b');
    expect(seen).toEqual(['a']);
  });
});

describe('probe marks: with the recorder hook', () => {
  it('forwards the name and plain data', () => {
    const hook = vi.fn<Hook>();
    g.__sqProbeMark = hook;
    pm('acc:staged', { bytes: 12 });
    pm('acc:lane');
    expect(hook.mock.calls).toEqual([['acc:staged', { bytes: 12 }], ['acc:lane', undefined]]);
  });

  it('evaluates lazy data exactly once, only when a hook is present', () => {
    const hook = vi.fn<Hook>();
    const lazy = vi.fn(() => ({ n: 3 }));
    g.__sqProbeMark = hook;
    pm('ps:rows', lazy);
    expect(lazy).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith('ps:rows', { n: 3 });
  });

  it('never lets a failing hook or failing lazy data change what the app does', () => {
    g.__sqProbeMark = () => { throw new Error('recorder broke'); };
    expect(() => pm('acc:enter', { op: 'x' })).not.toThrow();
    g.__sqProbeMark = vi.fn();
    expect(() => pm('acc:enter', () => { throw new Error('bad data'); })).not.toThrow();
  });
});

describe('probeStack', () => {
  it('is undefined unless the recorder asked for stacks', () => {
    expect(probeStack()).toBeUndefined();
    g.__sqProbeMark = vi.fn();
    expect(probeStack()).toBeUndefined();
  });

  it('returns the caller frames, trimmed, when the recorder asked for stacks', () => {
    g.__sqProbeStacks = true;
    const frames = probeStack();
    expect(Array.isArray(frames)).toBe(true);
    expect(frames!.length).toBeGreaterThan(0);
    expect(frames!.length).toBeLessThanOrEqual(8);
    for (const f of frames!) expect(f).toBe(f.trim());
  });
});

describe('probeClassWrites (the V2 writer probe, mark v2:write)', () => {
  const entry = (classes: string | undefined) => ({ get: (k: string) => (k === 'classes' ? classes : undefined) });
  const event = (path: Array<string | number>, target: { get(k: string): unknown }, keys: Record<string, { action: string; oldValue?: unknown }>) =>
    ({ path, target, changes: { keys: new Map(Object.entries(keys)) } });

  it('reports a class write on an entry: its old and new value, and the transaction origin shortened to its type and operation tail', () => {
    const out = probeClassWrites([event(['src/pages/index.astro:34:7'], entry('w-[30px]'), { classes: { action: 'update', oldValue: 'w-[3px]' } })],
      { origin: 'durable-edit:class-edit:0b6f6b2a-1111-2222-3333-444455abcdef', local: false });
    expect(out).toEqual({ origin: 'durable-edit:class-edit:…abcdef', local: false, w: [{ key: 'src/pages/index.astro:34:7', act: 'update', old: 'w-[3px]', now: 'w-[30px]' }] });
  });

  it('an entry added to the map is a write of its first class, a removed one is a delete, short origins stay whole', () => {
    const entries = { get: (k: string) => (k === 'a' ? entry('w-full') : undefined) };
    const out = probeClassWrites([event([], entries, { a: { action: 'add' }, b: { action: 'delete' } })], { origin: 'sync', local: true });
    expect(out.origin).toBe('sync');
    expect(out.w).toEqual([{ key: 'a', act: 'entry-add', now: 'w-full' }, { key: 'b', act: 'entry-delete' }]);
  });

  it('an event that changed another field of an entry still reports the class the entry holds now', () => {
    const out = probeClassWrites([event(['k'], entry('w-[300px]'), { sourceLocation: { action: 'update' }, edited: { action: 'add' } })], { origin: null });
    expect(out.origin).toBe('null');
    expect(out.w).toEqual([{ key: 'k', act: 'other', now: 'w-[300px]' }]);
  });

  it('skips nested types (the entry\'s sourceLocation map), clips long class strings, and tolerates the initial call without events', () => {
    const long = `w-[300px] ${'x'.repeat(200)}`;
    const out = probeClassWrites([event(['k', 'sourceLocation'], entry(undefined), { line: { action: 'update' } }), event(['k'], entry(long), { classes: { action: 'add' } })], undefined);
    expect(out.w).toEqual([{ key: 'k', act: 'add', now: long.slice(-60) }]);
    expect(probeClassWrites(undefined, undefined).w).toEqual([]);
  });

  it('is evaluated only through pm\'s lazy data: absent the recorder hook nothing runs', () => {
    const spy = vi.fn(() => probeClassWrites([], undefined));
    pm('v2:write', spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
