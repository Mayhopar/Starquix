/** useMultiStyleEdit — merged view in, owned (or group-diffed) edits out, ONE batch per change (design §2). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  scanned: new Map<string, { key: string; tagName: string; classes: string }>(),
  setClassesMany: vi.fn(async (_edits: Array<{ key: string; classes: string }>) => true),
}));
vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ getStoredClasses: (k: string) => h.stored.get(k) ?? null, setClassesMany: h.setClassesMany }),
}));
vi.mock('@/context/SelectionContext', () => ({ useScannedElements: () => ({ scannedByKey: h.scanned }) }));
import { useMultiStyleEdit } from '../useMultiStyleEdit';

const base = { breakpoint: 'xs', theme: 'light', state: 'default' } as const;
const sorted = (s: string) => s.split(/\s+/).filter(Boolean).sort();
const seed = (rows: Array<[key: string, tag: string, classes: string]>) => {
  h.stored.clear(); h.scanned.clear();
  for (const [key, tagName, classes] of rows) { h.scanned.set(key, { key, tagName, classes }); h.stored.set(key, classes); }
};
const lastEdits = () => h.setClassesMany.mock.calls.at(-1)![0];

beforeEach(() => h.setClassesMany.mockClear());

describe('useMultiStyleEdit (design §2)', () => {
  it('merged view, member classes, count, allText (worked example)', () => {
    seed([['a', 'p', 'p-4 text-red-500 text-lg font-bold'], ['b', 'h2', 'p-2 text-blue-500 text-lg']]);
    const { result } = renderHook(() => useMultiStyleEdit(['a', 'b'], base));
    expect(result.current.count).toBe(2);
    expect(result.current.currentClasses).toBe('text-lg');
    expect(result.current.memberClasses).toEqual(['p-4 text-red-500 text-lg font-bold', 'p-2 text-blue-500 text-lg']);
    expect(result.current.allText).toBe(true);
  });

  it('an owned edit writes every member in ONE batch; only owned tokens change', () => {
    seed([['a', 'p', 'p-4 text-red-500 text-lg font-bold'], ['b', 'p', 'p-2 text-blue-500 text-lg']]);
    const { result } = renderHook(() => useMultiStyleEdit(['a', 'b'], base));
    act(() => result.current.handleClassesChange('text-lg text-green-500', t => /^text-(red|blue|green)-\d+$/.test(t)));
    expect(h.setClassesMany).toHaveBeenCalledTimes(1);
    expect(lastEdits().map(e => [e.key, sorted(e.classes)])).toEqual([
      ['a', sorted('p-4 text-green-500 text-lg font-bold')],
      ['b', sorted('p-2 text-green-500 text-lg')],
    ]);
  });

  it('without owns: group diff against what the blocks were shown', () => {
    seed([['a', 'p', 'p-4 font-bold'], ['b', 'p', 'p-2']]);
    const { result } = renderHook(() => useMultiStyleEdit(['a', 'b'], base));
    act(() => result.current.handleClassesChange('font-medium'));
    expect(lastEdits().map(e => [e.key, sorted(e.classes)])).toEqual([['a', sorted('p-4 font-medium')], ['b', sorted('p-2 font-medium')]]);
  });

  it('a member missing from the scan drops out (C11)', () => {
    seed([['a', 'p', 'p-4'], ['b', 'p', 'p-2']]);
    h.scanned.delete('b');
    expect(renderHook(() => useMultiStyleEdit(['a', 'b'], base)).result.current.count).toBe(1);
  });

  it('a member the store never saw reads its scanned classes — never empty', () => {
    seed([['a', 'p', 'p-4 text-red-500'], ['b', 'p', 'p-2 text-blue-500']]);
    h.stored.delete('b');
    const { result } = renderHook(() => useMultiStyleEdit(['a', 'b'], base));
    act(() => result.current.handleClassesChange('text-green-500', t => /^text-/.test(t)));
    expect(sorted(lastEdits().find(e => e.key === 'b')!.classes)).toEqual(sorted('p-2 text-green-500'));
  });

  it('section −: removes from every member; members with nothing to remove are not written', () => {
    seed([['a', 'div', 'bg-red-500 p-1'], ['b', 'div', 'p-2']]);
    const { result } = renderHook(() => useMultiStyleEdit(['a', 'b'], base));
    expect(result.current.hasFill).toBe(true);
    act(() => result.current.removeMatching([/^bg-/]));
    expect(lastEdits()).toEqual([{ key: 'a', classes: 'p-1' }]);
  });

  it('section +: the default joins only members lacking that property', () => {
    seed([['a', 'div', 'bg-red-500 p-1'], ['b', 'div', 'p-2']]);
    const { result } = renderHook(() => useMultiStyleEdit(['a', 'b'], base));
    act(() => result.current.addDefault('bg-white'));
    expect(lastEdits()).toEqual([{ key: 'b', classes: 'p-2 bg-white' }]);
  });
});
