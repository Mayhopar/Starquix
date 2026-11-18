import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTreeMultiSelect } from '../useTreeMultiSelect';

const VISIBLE = ['a', 'b', 'c', 'd'];

describe('useTreeMultiSelect', () => {
  it('plain click selects one and sets the anchor', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('b', {}, VISIBLE));
    expect(result.current.selectedIds).toEqual(['b']);
    expect(result.current.anchorId).toBe('b');
  });

  it('cmd-click toggles membership without moving the anchor', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('a', {}, VISIBLE));
    act(() => result.current.onRowClick('c', { toggle: true }, VISIBLE));
    expect(result.current.selectedIds).toEqual(['a', 'c']);
    act(() => result.current.onRowClick('c', { toggle: true }, VISIBLE));
    expect(result.current.selectedIds).toEqual(['a']);
    expect(result.current.anchorId).toBe('a');
  });

  it('shift-click selects the inclusive range over VISIBLE rows only', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('a', {}, VISIBLE));
    act(() => result.current.onRowClick('c', { range: true }, VISIBLE));
    expect(result.current.selectedIds).toEqual(['a', 'b', 'c']);
  });

  it('shift-click backwards works', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('d', {}, VISIBLE));
    act(() => result.current.onRowClick('b', { range: true }, VISIBLE));
    expect(result.current.selectedIds).toEqual(['b', 'c', 'd']);
  });

  it('shift-click with no anchor falls back to a plain select', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('c', { range: true }, VISIBLE));
    expect(result.current.selectedIds).toEqual(['c']);
  });

  it('shift-click onto a row that is not visible falls back to a plain select', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('a', {}, VISIBLE));
    act(() => result.current.onRowClick('hidden', { range: true }, VISIBLE));
    expect(result.current.selectedIds).toEqual(['hidden']);
  });

  it('clear() empties the selection and the anchor', () => {
    const { result } = renderHook(() => useTreeMultiSelect());
    act(() => result.current.onRowClick('a', {}, VISIBLE));
    act(() => result.current.clear());
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.anchorId).toBeNull();
  });
});
