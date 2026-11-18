/**
 * instant-edit P2: a number field under a GestureHost commits ONCE per gesture. Before: every keystroke was a durable edit
 * (3, 30, 300 = three rows, three undo steps, three partial paints) and a held ArrowUp was 61 rows.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/assets/icons', () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => null), has: () => true }));

import { Field } from '../Field';
import { GestureHostContext, MAX_HOLD_MS, STEP_COMMIT_IDLE_MS, TYPED_SETTLE_MS, getGestureScope, type GestureHost } from '../valueGesture';

type Call = { text: string; scope: string };
let calls: Call[];
let host: GestureHost & { release: ReturnType<typeof vi.fn>; push?: () => void };
const onChange = (text: string) => { calls.push({ text, scope: getGestureScope() }); };
const mkHost = (pin = 'k|base|light|default'): typeof host => {
  const release = vi.fn();
  const h = { pin, release, hold: vi.fn((push: () => void) => { h.push = push; return release; }), undo: vi.fn(), abort: vi.fn() } as unknown as typeof host;
  return h;
};
const ui = (h = host, change = onChange, props: Record<string, unknown> = {}) => (
  <GestureHostContext.Provider value={h}><Field type="number" value="100" onChange={change} aria-label="W" {...props} /></GestureHostContext.Provider>
);
const input = () => screen.getByLabelText('W') as HTMLInputElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const commits = () => calls.filter(c => c.scope === 'commit').map(c => c.text);

beforeEach(() => { vi.useFakeTimers(); calls = []; host = mkHost(); });
afterEach(() => { vi.useRealTimers(); });

describe('typed numbers', () => {
  it('300 typed digit by digit is ONE commit after the settle window; the keystrokes only feed the stash', () => {
    render(ui());
    type('3'); act(() => { vi.advanceTimersByTime(90); });
    type('30'); act(() => { vi.advanceTimersByTime(90); });
    type('300');
    expect(input().value).toBe('300');                       // the draft lives in the input
    expect(commits()).toEqual([]);
    expect(calls.map(c => c.scope)).toEqual(['stash', 'stash', 'stash']);
    act(() => { vi.advanceTimersByTime(TYPED_SETTLE_MS - 1); });
    expect(commits()).toEqual([]);
    act(() => { vi.advanceTimersByTime(2); });
    expect(commits()).toEqual(['300']);
  });

  it('Enter and blur commit at once, Tab too', () => {
    render(ui());
    type('42'); fireEvent.keyDown(input(), { key: 'Enter' });
    expect(commits()).toEqual(['42']);
    type('43'); fireEvent.blur(input());
    expect(commits()).toEqual(['42', '43']);
    type('44'); fireEvent.keyDown(input(), { key: 'Tab' });
    expect(commits()).toEqual(['42', '43', '44']);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(commits()).toHaveLength(3);                       // the settle timer died with each commit
  });

  it('Esc aborts: no commit, the host restores, the input shows the committed value again', () => {
    render(ui());
    type('999');
    fireEvent.keyDown(input(), { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(commits()).toEqual([]);
    expect(host.abort).toHaveBeenCalledTimes(1);
    expect(input().value).toBe('100');
  });

  it('registers a hold while a draft is pending (barriers push it) and releases it at the commit', () => {
    render(ui());
    expect(host.hold).not.toHaveBeenCalled();
    type('7');
    expect(host.hold).toHaveBeenCalledTimes(1);
    act(() => { host.push!(); });                            // a page switch / Cmd-S / undo barrier
    expect(commits()).toEqual(['7']);
    expect(host.release).toHaveBeenCalledTimes(1);
  });

  it('a keystroke with nothing typed (empty) never reaches the stash', () => {
    render(ui());
    type('');
    expect(calls).toEqual([]);
    act(() => { vi.advanceTimersByTime(TYPED_SETTLE_MS + 1); });
    expect(commits()).toEqual(['']);                         // the empty string commits (auto) only at settle
  });

  it('unmount commits the pending draft, never cancels it', () => {
    const { unmount } = render(ui());
    type('55');
    unmount();
    expect(commits()).toEqual(['55']);
  });

  it('a selection change (the pin) under a pending draft commits with the closure the gesture BEGAN with', () => {
    const first = vi.fn(), second = vi.fn();
    const mine = (change: (t: string) => void) => (text: string) => { change(`${getGestureScope()}:${text}`); };
    const { rerender } = render(ui(host, mine(first)));
    type('12');
    first.mockClear();
    rerender(ui(mkHost('other|base|light|default'), mine(second)));
    expect(first).toHaveBeenCalledWith('commit:12');
    expect(second).not.toHaveBeenCalled();
  });
});

describe('stepper', () => {
  it('ticks preview (no commit) from a running value; ONE commit after the idle window', () => {
    render(ui());
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'ArrowUp', shiftKey: true });
    expect(calls).toEqual([{ text: '101', scope: 'preview' }, { text: '102', scope: 'preview' }, { text: '112', scope: 'preview' }]);
    expect(input().value).toBe('112');
    act(() => { vi.advanceTimersByTime(STEP_COMMIT_IDLE_MS - 1); });
    expect(commits()).toEqual([]);
    act(() => { vi.advanceTimersByTime(2); });
    expect(commits()).toEqual(['112']);
    expect(input().value).toBe('100');                       // the committed value is the prop again until the parent re-renders
  });

  it('every tick restarts the idle window, so a held key is one gesture', () => {
    render(ui());
    for (let i = 0; i < 20; i++) { fireEvent.keyDown(input(), { key: 'ArrowUp' }); act(() => { vi.advanceTimersByTime(33); }); }
    expect(commits()).toEqual([]);
    act(() => { vi.advanceTimersByTime(STEP_COMMIT_IDLE_MS + 1); });
    expect(commits()).toEqual(['120']);
  });

  it('a hold longer than the ceiling commits a checkpoint and keeps stepping', () => {
    render(ui());
    const press = () => { fireEvent.keyDown(input(), { key: 'ArrowUp' }); act(() => { vi.advanceTimersByTime(33); }); };
    for (let t = 0; t <= MAX_HOLD_MS + 200; t += 33) press();
    expect(commits().length).toBe(1);                        // the checkpoint
    const checkpoint = Number(commits()[0]);
    act(() => { vi.advanceTimersByTime(STEP_COMMIT_IDLE_MS + 1); });
    expect(commits().length).toBe(2);
    expect(Number(commits()[1])).toBeGreaterThan(checkpoint);
  });

  it('Esc aborts a stepping burst: no commit, the host restores the canvas', () => {
    render(ui());
    fireEvent.keyDown(input(), { key: 'ArrowUp' }); fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(commits()).toEqual([]);
    expect(host.abort).toHaveBeenCalledTimes(1);
    expect(input().value).toBe('100');
  });

  it('honours min and max', () => {
    render(ui(host, onChange, { min: 99, max: 101 }));
    fireEvent.keyDown(input(), { key: 'ArrowUp' }); fireEvent.keyDown(input(), { key: 'ArrowUp' }); fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(calls.map(c => c.text)).toEqual(['101', '101', '101']);
    fireEvent.keyDown(input(), { key: 'ArrowDown', shiftKey: true });
    expect(calls[3].text).toBe('99');
  });
});

describe('Cmd-Z, IME and opt-outs', () => {
  it('Cmd/Ctrl-Z aborts a pending draft; with nothing pending it is the editor undo', () => {
    render(ui());
    type('5');
    fireEvent.keyDown(input(), { key: 'z', metaKey: true });
    expect(host.abort).toHaveBeenCalledTimes(1);
    expect(host.undo).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'z', ctrlKey: true });
    expect(host.undo).toHaveBeenCalledTimes(1);
    expect(commits()).toEqual([]);
  });

  it('ignores Enter, Esc and the settle timer while an IME composition is open', () => {
    render(ui());
    fireEvent.compositionStart(input());
    type('3');
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.keyDown(input(), { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(TYPED_SETTLE_MS * 3); });
    expect(commits()).toEqual([]);
    expect(host.abort).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input());
    act(() => { vi.advanceTimersByTime(TYPED_SETTLE_MS + 1); });
    expect(commits()).toEqual(['3']);
  });

  it('a field with its own onKeyDown keeps per-event commit (it opts in later)', () => {
    render(ui(host, onChange, { onKeyDown: () => {} }));
    type('8');
    expect(calls).toEqual([{ text: '8', scope: 'commit' }]);
  });

  it('with no host the field commits per event exactly as before', () => {
    render(<Field type="number" value="100" onChange={onChange} aria-label="W" />);
    type('3');
    expect(calls).toEqual([{ text: '3', scope: 'commit' }]);
  });
});
