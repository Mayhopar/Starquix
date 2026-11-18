/**
 * C7 (2026-08-26, both runtimes): typing a multi-digit inset ("200") committed
 * a class change PER KEYSTROKE — three undo steps for one edit (S1: one ⌘Z
 * after typing 200 landed on 20; S2: three ⌘Z, each intermediate on disk).
 * The inset fields must coalesce a typing burst into ONE commit, so one undo
 * reverts one edit in every runtime.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PositionBlock } from './PositionBlock';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PositionBlock inset typing', () => {
  it('a typing burst commits ONCE, with the final value', () => {
    const onClassesChange = vi.fn();
    render(<PositionBlock classes="fixed" onClassesChange={onClassesChange} />);

    const left = screen.getByLabelText('Left inset');
    fireEvent.change(left, { target: { value: '2' } });
    fireEvent.change(left, { target: { value: '20' } });
    fireEvent.change(left, { target: { value: '200' } });

    // Nothing committed mid-burst — no per-keystroke undo entries.
    expect(onClassesChange).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(onClassesChange).toHaveBeenCalledTimes(1);
    expect(onClassesChange.mock.calls[0][0]).toMatch(/left-/);
    expect(onClassesChange.mock.calls[0][0]).not.toMatch(/left-.*left-/);
  });

  it('the input shows the typed value immediately (no laggy echo)', () => {
    const onClassesChange = vi.fn();
    render(<PositionBlock classes="fixed" onClassesChange={onClassesChange} />);
    const left = screen.getByLabelText('Left inset') as HTMLInputElement;
    fireEvent.change(left, { target: { value: '16' } });
    expect(left.value).toBe('16');
  });

  it('switching sides mid-burst flushes the pending side first, in order', () => {
    const onClassesChange = vi.fn();
    render(<PositionBlock classes="fixed" onClassesChange={onClassesChange} />);

    fireEvent.change(screen.getByLabelText('Left inset'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('Top inset'), { target: { value: '16' } });

    act(() => { vi.advanceTimersByTime(1000); });
    // Two sides = two commits — the left edit is not lost.
    expect(onClassesChange).toHaveBeenCalledTimes(2);
    expect(onClassesChange.mock.calls[0][0]).toMatch(/left-/);
    expect(onClassesChange.mock.calls[1][0]).toMatch(/top-/);
  });

  it('unmount flushes a pending commit (deselect right after typing loses nothing)', () => {
    const onClassesChange = vi.fn();
    const { unmount } = render(<PositionBlock classes="fixed" onClassesChange={onClassesChange} />);
    fireEvent.change(screen.getByLabelText('Left inset'), { target: { value: '16' } });
    unmount();
    expect(onClassesChange).toHaveBeenCalledTimes(1);
    expect(onClassesChange.mock.calls[0][0]).toMatch(/left-/);
  });
});

// instant-edit P2: under a value gesture host the field coalesces (settle / Enter / blur) and PositionBlock's own 500 ms
// coalescer steps aside — one more half second on top of the settle window would be a lag, not a safety net.
import { GestureHostContext, getGestureScope, type GestureHost } from '@/components/ui/valueGesture';

describe('PositionBlock under a value gesture host', () => {
  const host: GestureHost = { pin: 'k', hold: () => () => {}, undo: vi.fn(), abort: vi.fn() };
  it('typed 200 is ONE commit at the settle window, not 500 ms later; keystrokes only reach the stash scope', () => {
    const seen: Array<{ classes: string; scope: string }> = [];
    const onClassesChange = (classes: string) => seen.push({ classes, scope: getGestureScope() });
    render(<GestureHostContext.Provider value={host}><PositionBlock classes="fixed" onClassesChange={onClassesChange} /></GestureHostContext.Provider>);
    const left = screen.getByLabelText('Left inset');
    fireEvent.change(left, { target: { value: '2' } });
    fireEvent.change(left, { target: { value: '20' } });
    fireEvent.change(left, { target: { value: '200' } });
    expect(seen.map(s => s.scope)).toEqual(['stash', 'stash', 'stash']);
    act(() => { vi.advanceTimersByTime(221); });
    const commits = seen.filter(s => s.scope === 'commit');
    expect(commits).toHaveLength(1);
    expect(commits[0].classes).toMatch(/left-/);
  });
});
