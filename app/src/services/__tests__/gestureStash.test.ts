/** instant-edit P2: the synchronous safety net under the typed settle window and the stepper idle. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STASH_TTL_MS, _resetGestureStashForTests, stashClear, stashEntries, stashHas, stashPut } from '../gestureStash';

beforeEach(() => { _resetGestureStashForTests(); vi.restoreAllMocks(); });
const put = (over: Partial<Parameters<typeof stashPut>[0]> = {}) => stashPut({ projectId: 'p', key: 'k', classes: 'w-[3px]', baseline: 'w-full', origin: { armed: false, pageFile: 'src/pages/a.astro' }, opId: null, ...over });

describe('gesture stash', () => {
  it('stores synchronously and keeps the FIRST baseline of a pending chain of intents', () => {
    put({ classes: 'w-[3px]', baseline: 'w-full' });
    put({ classes: 'w-[30px]', baseline: 'w-[3px]' });   // a later keystroke read the draft as its baseline: the chain's baseline stays
    put({ classes: 'w-[300px]', baseline: 'w-[30px]' });
    const [entry] = stashEntries('p');
    expect(entry).toMatchObject({ classes: 'w-[300px]', baseline: 'w-full', key: 'k' });
    expect(stashEntries('p')).toHaveLength(1);
  });

  it('is scoped by project and key', () => {
    put({ projectId: 'p', key: 'a' }); put({ projectId: 'p', key: 'b' }); put({ projectId: 'q', key: 'a' });
    expect(stashEntries('p').map(e => e.key).sort()).toEqual(['a', 'b']);
    expect(stashEntries('q').map(e => e.key)).toEqual(['a']);
    expect(stashHas('p', 'a')).toBe(true);
    expect(stashHas('r', 'a')).toBe(false);
  });

  it('is cleared by the op that carries the value; a newer intent of the key stays', () => {
    put({ opId: 'op-1', classes: 'one' });
    put({ opId: 'op-2', classes: 'two' });
    stashClear('p', 'k', 'op-1');                       // op-1 was accepted, but op-2 is newer
    expect(stashEntries('p')[0].classes).toBe('two');
    stashClear('p', 'k', 'op-2');
    expect(stashEntries('p')).toEqual([]);
  });

  it('clears unconditionally without an opId (a rejected draft, an aborted gesture)', () => {
    put({ opId: 'op-1' });
    stashClear('p', 'k');
    expect(stashHas('p', 'k')).toBe(false);
  });

  it('drops entries older than the TTL and orders the rest by time', () => {
    put({ key: 'old', ts: 1 }); put({ key: 'b', ts: 2_000_000 }); put({ key: 'a', ts: 1_000_000 });
    expect(stashEntries('p', 1 + STASH_TTL_MS + 1).map(e => e.key)).toEqual(['a', 'b']);
    expect(stashHas('p', 'old')).toBe(false);
  });

  it('survives corrupt storage and a storage that refuses writes (the lane still accepts; only the net is missing)', () => {
    localStorage.setItem('sq:gesture-stash:v1', '{not json');
    expect(stashEntries('p')).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => put()).not.toThrow();
  });
});
