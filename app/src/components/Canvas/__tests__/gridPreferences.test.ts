import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_GRID, GRID_LIMITS, getGrid, _resetGridCacheForTests, setGrid, useGrid } from '../gridPreferences';

const KEY = 'sq:grid';
beforeEach(() => { localStorage.removeItem(KEY); _resetGridCacheForTests(); });
afterEach(() => vi.restoreAllMocks());

describe('grid preferences', () => {
  it('starts off, with defaults that fit the 320px xs artboard', () => {
    expect(getGrid('p')).toEqual({ on: false, type: 'columns', count: 12, gutter: 16, margin: 16, size: 8 });
    const { count, gutter, margin } = DEFAULT_GRID;
    expect(2 * margin + gutter * (count - 1)).toBeLessThan(320);
  });

  it('is per project; no project id shares one bucket', () => {
    setGrid('one', { on: true, count: 6 });
    expect(getGrid('one')).toMatchObject({ on: true, count: 6 });
    expect(getGrid('two')).toEqual(DEFAULT_GRID);
    setGrid(null, { size: 16 });
    expect(getGrid(null).size).toBe(16);
    expect(getGrid('one').size).toBe(8);
  });

  it('writes through to localStorage and a cold read gets it back', () => {
    setGrid('p', { on: true, type: 'square', size: 4 });
    expect(JSON.parse(localStorage.getItem(KEY)!).p).toMatchObject({ on: true, type: 'square', size: 4 });
    _resetGridCacheForTests();
    expect(getGrid('p')).toMatchObject({ on: true, type: 'square', size: 4 });
  });

  it.each([
    ['count', 0, GRID_LIMITS.count[0]],
    ['count', -3, GRID_LIMITS.count[0]],
    ['count', 99, GRID_LIMITS.count[1]],
    ['count', 7.6, 8],
    ['gutter', -1, 0],
    ['gutter', 5000, GRID_LIMITS.gutter[1]],
    ['margin', 5000, GRID_LIMITS.margin[1]],
    ['size', 1, GRID_LIMITS.size[0]],
    ['size', 100000, GRID_LIMITS.size[1]],
  ] as const)('%s = %s is stored as %s', (key, typed, stored) => {
    setGrid('p', { [key]: typed });
    expect(getGrid('p')[key]).toBe(stored);
  });

  it('a non-finite number falls back to the default, never NaN', () => {
    setGrid('p', { count: NaN, gutter: Infinity });
    expect(getGrid('p')).toMatchObject({ count: DEFAULT_GRID.count, gutter: DEFAULT_GRID.gutter });
  });

  it.each([
    ['not json', '{nope'],
    ['null', 'null'],
    ['an array', '[1,2]'],
    ['a number', '42'],
    ['a string', '"x"'],
  ])('survives corrupt storage: %s', (_, raw) => {
    localStorage.setItem(KEY, raw);
    _resetGridCacheForTests();
    expect(getGrid('p')).toEqual(DEFAULT_GRID);
    setGrid('p', { on: true });
    expect(getGrid('p').on).toBe(true);
  });

  it('repairs a stored entry field by field: wrong types → default, out of range → clamped', () => {
    localStorage.setItem(KEY, JSON.stringify({
      p: { on: 'yes', type: 'rows', count: '12', gutter: 9999, margin: null, size: 3.4 },
      q: 'nonsense',
    }));
    _resetGridCacheForTests();
    expect(getGrid('p')).toEqual({ ...DEFAULT_GRID, gutter: GRID_LIMITS.gutter[1], size: 3 });
    expect(getGrid('q')).toEqual(DEFAULT_GRID);
  });

  it('a project literally named __proto__ is just a project', () => {
    localStorage.setItem(KEY, '{"__proto__":{"on":true,"count":3}}');
    _resetGridCacheForTests();
    expect(getGrid('__proto__')).toMatchObject({ on: true, count: 3 });
    expect(({} as { on?: boolean }).on).toBeUndefined();
    expect(getGrid('other')).toEqual(DEFAULT_GRID);
  });

  it('keeps working for the session when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => setGrid('p', { on: true, count: 5 })).not.toThrow();
    expect(getGrid('p')).toMatchObject({ on: true, count: 5 });
    setGrid('q', { on: true });
    expect(getGrid('p').count).toBe(5); // an earlier project survives a later blocked write
  });

  it("a write keeps other projects another window stored in the meantime", () => {
    setGrid('a', { count: 5 });
    localStorage.setItem(KEY, JSON.stringify({ a: { ...DEFAULT_GRID, count: 5 }, b: { ...DEFAULT_GRID, count: 3 } }));
    setGrid('a', { on: true });
    expect(JSON.parse(localStorage.getItem(KEY)!).b.count).toBe(3);
  });

  it('returns the same object until something changes (stable for useSyncExternalStore)', () => {
    expect(getGrid('p')).toBe(getGrid('p'));
    setGrid('p', { on: true });
    const after = getGrid('p');
    expect(getGrid('p')).toBe(after);
    expect(getGrid('other')).toBe(getGrid('other'));
  });

  it('useGrid re-renders on a write, for its own project only', () => {
    const mine = renderHook(() => useGrid('p'));
    const other = renderHook(() => useGrid('q'));
    expect(mine.result.current.on).toBe(false);
    act(() => setGrid('p', { on: true }));
    expect(mine.result.current.on).toBe(true);
    expect(other.result.current.on).toBe(false);
  });

  it('a write that changes nothing neither touches storage nor re-renders', () => {
    setGrid('p', { count: 6 });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    let renders = 0;
    renderHook(() => { renders += 1; return useGrid('p'); });
    const before = renders;
    act(() => { setGrid('p', { count: 6 }); setGrid('p', { count: 6.4 }); setGrid('p', {}); }); // same, rounds to the same, empty
    expect(write).not.toHaveBeenCalled();
    expect(renders).toBe(before);
    act(() => setGrid('p', { count: 7 }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(renders).toBeGreaterThan(before);
  });
});
