/**
 * Stroke while ≥2 are selected (design C6, D6, §2): width / colour (all sides and each side) and style
 * read "Mixed" by their own readers, every write's `owns` accepts that control's tokens and rejects every
 * other control's, and the default `border-black` a width edit adds is never owned (members keep theirs).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderInMulti } from './renderInMulti';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
vi.mock('../../ColorPicker', () => ({
  ColorPicker: (p: { value: string; mixed?: boolean; onChange: (v: string, hex: string) => void }) =>
    <div data-testid="color" onClick={() => p.onChange('border-green-500', '#0f0')}>{p.mixed ? 'Mixed' : p.value || 'none'}</div>,
}));
import { StrokeBlock } from '../../blocks/StrokeBlock';

const A = 'border border-red-500 border-dashed';
const B = 'border-2 border-blue-500 border-dotted';
const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const expand = () => fireEvent.click(screen.getByTitle('Expand to individual sides'));
const expectMixed = (label: string) => {
  expect(input(label).value).toBe('');
  expect(input(label).placeholder).toBe('Mixed');
};

describe('StrokeBlock while several are selected', () => {
  it('every control reads "Mixed" when the members differ in it', () => {
    renderInMulti(<StrokeBlock classes="" onClassesChange={vi.fn()} />, [A, B]);
    expectMixed('Stroke width');
    expect(screen.getByTestId('color').textContent).toBe('Mixed');
    for (const t of ['Solid', 'Dashed', 'Other']) expect(screen.getByTitle(t).getAttribute('aria-pressed')).toBe('false');
    expand();
    for (const side of SIDES) expectMixed(`${side} stroke width`);
    expect(screen.getAllByTestId('color').map(c => c.textContent)).toEqual(['Mixed', 'Mixed', 'Mixed', 'Mixed']);
  });

  it('control: one element shows its own values', () => {
    render(<StrokeBlock classes={A} onClassesChange={vi.fn()} />);
    expect(input('Stroke width').value).toBe('1');
    expect(screen.getByTestId('color').textContent).toBe('border-red-500');
    expect(screen.getByTitle('Dashed').getAttribute('aria-pressed')).toBe('true');
  });

  it('a width edit never owns the default border-black it adds (members keep their colour)', () => {
    const spy = vi.fn();
    renderInMulti(<StrokeBlock classes="" onClassesChange={spy} />, ['border', 'border-2']);
    fireEvent.change(input('Stroke width'), { target: { value: '4' } });
    const [next, owns] = spy.mock.calls.at(-1)!;
    expect(next).toBe('border-4 border-black');
    expect(owns('border-4')).toBe(true);
    expect(owns('border-black')).toBe(false);
  });

  /** Tokens each control owns; every token another control owns (and NOBODY's) must be rejected. */
  const OWNED = {
    width: ['border', 'border-2', 'border-[3px]', 'border-t-2', 'border-r-2', 'border-b-2', 'border-l-2'],
    color: ['border-red-500', 'border-[#ff0000]', 'border-primary', 'border-t-red-500', 'border-r-red-500', 'border-b-red-500', 'border-l-red-500'],
    topWidth: ['border-t-2'], rightWidth: ['border-r-2'], bottomWidth: ['border-b-2'], leftWidth: ['border-l-2'],
    topColor: ['border-t-red-500'], rightColor: ['border-r-red-500'], bottomColor: ['border-b-red-500'], leftColor: ['border-l-red-500'],
    style: ['border-dashed', 'border-none'],
  } as const;
  const NOBODY = ['border-x-2', 'border-collapse', 'rounded-lg', 'p-4', 'shadow', 'text-red-500', 'bg-red-500'];
  type Control = keyof typeof OWNED;
  const side = (i: number, part: 'width' | 'color') => () => {
    expand();
    if (part === 'width') fireEvent.change(input(`${SIDES[i]} stroke width`), { target: { value: '4' } });
    else fireEvent.click(screen.getAllByTestId('color')[i]);
  };
  const EDITS: Record<Control, () => void> = {
    width: () => fireEvent.change(input('Stroke width'), { target: { value: '4' } }),
    color: () => fireEvent.click(screen.getByTestId('color')),
    topWidth: side(0, 'width'), rightWidth: side(1, 'width'), bottomWidth: side(2, 'width'), leftWidth: side(3, 'width'),
    topColor: side(0, 'color'), rightColor: side(1, 'color'), bottomColor: side(2, 'color'), leftColor: side(3, 'color'),
    style: () => fireEvent.click(screen.getByTitle('Solid')),
  };

  it.each(Object.keys(OWNED) as Control[])('%s: its write owns its own tokens and no other control\'s', control => {
    const spy = vi.fn();
    renderInMulti(<StrokeBlock classes="" onClassesChange={spy} />, [A, B]);
    EDITS[control]();
    expect(spy).toHaveBeenCalled();
    const owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(typeof owns).toBe('function');
    const mine: readonly string[] = OWNED[control];
    for (const t of mine) expect(owns(t), `${control} must own ${t}`).toBe(true);
    const others = [...Object.values(OWNED).flat(), ...NOBODY].filter(t => !mine.includes(t));
    for (const t of others) expect(owns(t), `${control} must not own ${t}`).toBe(false);
  });
});
