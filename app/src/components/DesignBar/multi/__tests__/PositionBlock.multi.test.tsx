/**
 * Position while ≥2 are selected (design C6, C13, D6, §2): position and the four insets read "Mixed"
 * by their own readers, insets show only when the merged position is not static, a Mixed inset shows
 * what is being typed until its debounced commit, and every write's `owns` accepts that control's
 * tokens (negative insets included) and rejects every other control's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderInMulti } from './renderInMulti';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
import { PositionBlock } from '../../blocks/PositionBlock';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const INSETS = ['Top inset', 'Left inset', 'Bottom inset', 'Right inset'];
const A = 'absolute top-4 left-2 bottom-1 right-3';
const B = 'absolute top-8 left-6 bottom-5 right-7';
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('PositionBlock while several are selected', () => {
  it('Mixed position: no segment active, insets hidden (C13)', () => {
    renderInMulti(<PositionBlock classes="" onClassesChange={vi.fn()} />, ['relative top-4', 'absolute top-4']);
    for (const t of ['Static', 'Other']) expect(screen.getByTitle(t).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByLabelText('Top inset')).toBeNull();
  });

  it('shared position: each inset reads "Mixed"', () => {
    renderInMulti(<PositionBlock classes="absolute" onClassesChange={vi.fn()} />, [A, B]);
    for (const label of INSETS) {
      expect(input(label).value).toBe('');
      expect(input(label).placeholder).toBe('Mixed');
    }
  });

  it('a Mixed inset shows what is typed until the commit, then commits once', () => {
    const spy = vi.fn();
    renderInMulti(<PositionBlock classes="absolute" onClassesChange={spy} />, [A, B]);
    fireEvent.change(input('Top inset'), { target: { value: '2' } });
    expect(input('Top inset').value).toBe('2');
    fireEvent.change(input('Top inset'), { target: { value: '20' } });
    expect(input('Top inset').value).toBe('20');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('absolute top-5');
  });

  it('control: one element shows its own values', () => {
    render(<PositionBlock classes={A} onClassesChange={vi.fn()} />);
    expect(input('Top inset').value).toBe('16');
    expect(screen.getByTitle('Absolute').getAttribute('aria-pressed')).toBe('true');
  });

  /** Tokens each control owns; every token another control owns (and NOBODY's) must be rejected. */
  const OWNED = {
    position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    top: ['top-4', '-top-4', 'top-[10px]', 'top-auto'],
    left: ['left-4', '-left-4'],
    bottom: ['bottom-4', '-bottom-4'],
    right: ['right-4', '-right-4'],
  } as const;
  const NOBODY = ['inset-0', 'inset-x-2', 'z-10', 'p-4', 'translate-x-2', 'block', 'hidden'];
  type Control = keyof typeof OWNED;
  const inset = (label: string) => () => {
    fireEvent.change(input(label), { target: { value: '-16' } });
    act(() => { vi.advanceTimersByTime(1000); });
  };
  const EDITS: Record<Control, { members: string[]; merged: string; edit: () => void }> = {
    position: { members: ['relative', 'absolute'], merged: '', edit: () => fireEvent.click(screen.getByTitle('Static')) },
    top: { members: [A, B], merged: 'absolute', edit: inset('Top inset') },
    left: { members: [A, B], merged: 'absolute', edit: inset('Left inset') },
    bottom: { members: [A, B], merged: 'absolute', edit: inset('Bottom inset') },
    right: { members: [A, B], merged: 'absolute', edit: inset('Right inset') },
  };

  it.each(Object.keys(OWNED) as Control[])('%s: its write owns its own tokens and no other control\'s', control => {
    const spy = vi.fn();
    const { members, merged, edit } = EDITS[control];
    renderInMulti(<PositionBlock classes={merged} onClassesChange={spy} />, members);
    edit();
    expect(spy).toHaveBeenCalled();
    const owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(typeof owns).toBe('function');
    const mine: readonly string[] = OWNED[control];
    for (const t of mine) expect(owns(t), `${control} must own ${t}`).toBe(true);
    const others = [...Object.values(OWNED).flat(), ...NOBODY].filter(t => !mine.includes(t));
    for (const t of others) expect(owns(t), `${control} must not own ${t}`).toBe(false);
  });
});
