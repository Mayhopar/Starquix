/** P0a (instant-edit): a held ArrowUp in W/H stepped from the RENDERED value, so key repeat faster than React's
 * re-render emitted the same number again (3-11 of 61 increments lost on an aged project). */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/context/SelectionContext', () => ({ useSelectedRectOptional: () => null }));
vi.mock('@/assets/icons', () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => null), has: () => true }));

import { SizeInput } from '../LayoutAppearanceBlock';

const props = (value: number | null, onValueChange = vi.fn()) => ({
  dimension: 'w' as const, state: { mode: 'fixed' as const, value, minValue: null, maxValue: null }, onModeChange: vi.fn(), onValueChange,
  onConstraintChange: vi.fn(), onAddConstraint: vi.fn(), onRemoveConstraint: vi.fn(),
  mixed: { size: false, min: false, max: false },   // dev's multi-select contract: the prop is required
});

describe('SizeInput arrow stepping', () => {
  it('steps from its own running value when key events outrun the re-render', () => {
    const onValueChange = vi.fn();
    const { container } = render(<SizeInput {...props(100, onValueChange)} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onValueChange.mock.calls.map(c => c[0])).toEqual([101, 102, 112, 111]);
  });

  it('forgets the running value on blur and when the rendered value catches up', () => {
    const onValueChange = vi.fn();
    const { container, rerender } = render(<SizeInput {...props(100, onValueChange)} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });                       // 101
    rerender(<SizeInput {...props(101, onValueChange)} />);
    fireEvent.keyDown(input, { key: 'ArrowUp' });                       // 102 from the caught-up value
    fireEvent.blur(input);
    rerender(<SizeInput {...props(50, onValueChange)} />);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });                       // 51 from the new rendered value
    expect(onValueChange.mock.calls.map(c => c[0])).toEqual([101, 102, 51]);
  });

  it('never steps below 1', () => {
    const onValueChange = vi.fn();
    const { container } = render(<SizeInput {...props(2, onValueChange)} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onValueChange.mock.calls.map(c => c[0])).toEqual([1, 1]);
  });

  it('typing replaces the running value', () => {
    const onValueChange = vi.fn();
    const { container, rerender } = render(<SizeInput {...props(100, onValueChange)} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });                       // 101, running
    fireEvent.change(input, { target: { value: '40' } });               // typed 40
    rerender(<SizeInput {...props(40, onValueChange)} />);
    fireEvent.keyDown(input, { key: 'ArrowUp' });                       // 41, not 102
    expect(onValueChange.mock.calls.map(c => c[0])).toEqual([101, 40, 41]);
  });
});

// instant-edit P2: SizeInput under a value gesture host (the DesignBar provides one).
import { GestureHostContext, getGestureScope, type GestureHost } from '@/components/ui/valueGesture';

describe('SizeInput under a value gesture host', () => {
  const host = (): GestureHost => ({ pin: 'k', hold: () => () => {}, undo: vi.fn(), abort: vi.fn() });
  const withHost = (h: GestureHost, node: React.ReactNode) => <GestureHostContext.Provider value={h}>{node}</GestureHostContext.Provider>;

  it('typed 300 is one commit-scope onValueChange after the settle window; keystrokes are stash-scope only', () => {
    vi.useFakeTimers();
    try {
      const seen: Array<{ v: number | null; scope: string }> = [];
      const onValueChange = (v: number | null) => seen.push({ v, scope: getGestureScope() });
      const { container } = render(withHost(host(), <SizeInput {...props(100, onValueChange)} />));
      const input = container.querySelector('input')!;
      fireEvent.focus(input);
      for (const t of ['3', '30', '300']) { fireEvent.change(input, { target: { value: t } }); vi.advanceTimersByTime(90); }
      expect(input.value).toBe('300');
      expect(seen.filter(s => s.scope === 'commit')).toEqual([]);
      vi.advanceTimersByTime(200);
      expect(seen.filter(s => s.scope === 'commit')).toEqual([{ v: 300, scope: 'commit' }]);
    } finally { vi.useRealTimers(); }
  });

  it('an ArrowUp burst previews, then commits once; Esc after a burst shows the committed value again', () => {
    vi.useFakeTimers();
    try {
      const seen: Array<{ v: number | null; scope: string }> = [];
      const h = host();
      const onValueChange = (v: number | null) => seen.push({ v, scope: getGestureScope() });
      const { container } = render(withHost(h, <SizeInput {...props(100, onValueChange)} />));
      const input = container.querySelector('input')!;
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowUp' }); fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(seen).toEqual([{ v: 101, scope: 'preview' }, { v: 102, scope: 'preview' }]);
      vi.advanceTimersByTime(500);
      expect(seen[2]).toEqual({ v: 102, scope: 'commit' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      fireEvent.keyDown(input, { key: 'Escape' });
      vi.advanceTimersByTime(1000);
      expect(seen.filter(s => s.scope === 'commit')).toHaveLength(1);
      expect(h.abort).toHaveBeenCalledTimes(1);
      expect(input.value).toBe('102');                       // the last COMMITTED text, not the aborted tick
    } finally { vi.useRealTimers(); }
  });
});
