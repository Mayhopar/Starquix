/**
 * Appearance while ≥2 are selected (design C6, D6, §2): every control reads "Mixed" by its own reader
 * (radius = all four corners), a corner edit emits ONLY that corner's token, the corner toggle is
 * UI-only, and every write's `owns` accepts that control's tokens and rejects every other control's.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderInMulti } from './renderInMulti';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
import { AppearanceBlock } from '../../blocks/AppearanceBlock';

const A = 'opacity-50 z-10 scale-110 rounded-lg invisible overflow-hidden cursor-pointer';
const B = 'opacity-75 z-20 scale-90 rounded-sm hidden overflow-auto cursor-move';
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const CORNERS = ['Top-left radius', 'Top-right radius', 'Bottom-left radius', 'Bottom-right radius'];
const expand = () => fireEvent.click(screen.getByTitle('Expand to individual corners'));
const expectMixed = (label: string) => {
  expect(input(label).value).toBe('');
  expect(input(label).placeholder).toBe('Mixed');
};

describe('AppearanceBlock while several are selected', () => {
  it('every control reads "Mixed" when the members differ in it', () => {
    renderInMulti(<AppearanceBlock classes="" onClassesChange={vi.fn()} />, [A, B]);
    for (const label of ['Opacity', 'Z index', 'Scale', 'Corner radius']) expectMixed(label);
    for (const title of ['Visible', 'Other']) for (const seg of screen.getAllByTitle(title)) expect(seg.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Cursor') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mixed');
    expand();
    for (const label of CORNERS) expectMixed(label);
  });

  it('control: one element shows its own values', () => {
    render(<AppearanceBlock classes={A} onClassesChange={vi.fn()} />);
    expect(input('Opacity').value).toBe('50');
    expect(input('Corner radius').value).toBe('8');
    expect(screen.getAllByTitle('Invisible')[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('a corner edit writes ONLY that corner (no re-normalizing from the shown values)', () => {
    const spy = vi.fn();
    renderInMulti(<AppearanceBlock classes="" onClassesChange={spy} />, ['rounded-lg', 'rounded-sm']);
    expand();
    expect(spy).not.toHaveBeenCalled(); // the toggle is UI-only while ≥2 are selected
    fireEvent.change(input('Top-left radius'), { target: { value: '12' } });
    const [next, owns] = spy.mock.calls.at(-1)!;
    expect(next).toBe('rounded-tl-xl');
    expect(owns('rounded-tl-[3px]')).toBe(true);
    for (const t of ['rounded-lg', 'rounded', 'rounded-tr-xl', 'rounded-t-lg']) expect(owns(t)).toBe(false);
  });

  it('a corner set to 0 stays explicit (a member\'s general radius must not show through)', () => {
    const spy = vi.fn();
    renderInMulti(<AppearanceBlock classes="" onClassesChange={spy} />, ['rounded-lg', 'rounded-sm']);
    expand();
    fireEvent.change(input('Bottom-right radius'), { target: { value: '0' } });
    expect(spy.mock.calls.at(-1)![0]).toBe('rounded-br-none');
  });

  it('control: one element still normalizes its corners when expanding', () => {
    const spy = vi.fn();
    render(<AppearanceBlock classes="rounded-lg" onClassesChange={spy} />);
    expand();
    expect(spy).toHaveBeenCalled();
  });

  it('opacity 100 (the default) on a Mixed field removes it on every member', () => {
    const spy = vi.fn();
    renderInMulti(<AppearanceBlock classes="" onClassesChange={spy} />, [A, B]);
    fireEvent.change(input('Opacity'), { target: { value: '100' } });
    const [next, owns] = spy.mock.calls.at(-1)!;
    expect(next).toBe('');
    expect(owns('opacity-50')).toBe(true);
  });

  /** Tokens each control owns; every token another control owns (and NOBODY's) must be rejected. */
  const OWNED = {
    opacity: ['opacity-50', 'opacity-[0.5]'],
    z: ['z-10', 'z-[5]'],
    scale: ['scale-110', 'scale-[1.2]'],
    radius: ['rounded', 'rounded-lg', 'rounded-[8px]', 'rounded-t-lg', 'rounded-tl-xl', 'rounded-tr-xl', 'rounded-bl-xl', 'rounded-br-xl'],
    tl: ['rounded-tl-xl'],
    tr: ['rounded-tr-xl'],
    bl: ['rounded-bl-xl'],
    br: ['rounded-br-xl'],
    visibility: ['visible', 'invisible', 'hidden'],
    overflow: ['overflow-hidden', 'overflow-clip'],
    cursor: ['cursor-pointer'],
  } as const;
  const NOBODY = ['scale-x-110', 'overflow-x-auto', 'flex', 'block', 'p-4', 'text-red-500', 'border'];
  type Control = keyof typeof OWNED;
  const corner = (i: number) => () => { expand(); fireEvent.change(input(CORNERS[i]), { target: { value: '12' } }); };
  const EDITS: Record<Control, () => void> = {
    opacity: () => fireEvent.change(input('Opacity'), { target: { value: '30' } }),
    z: () => fireEvent.change(input('Z index'), { target: { value: '5' } }),
    scale: () => fireEvent.change(input('Scale'), { target: { value: '120' } }),
    radius: () => fireEvent.change(input('Corner radius'), { target: { value: '8' } }),
    tl: corner(0), tr: corner(1), bl: corner(2), br: corner(3),
    visibility: () => fireEvent.click(screen.getAllByTitle('Visible')[0]),
    overflow: () => fireEvent.click(screen.getAllByTitle('Visible')[1]),
    cursor: () => fireEvent.change(screen.getByLabelText('Cursor'), { target: { value: 'grab' } }),
  };

  it.each(Object.keys(OWNED) as Control[])('%s: its write owns its own tokens and no other control\'s', control => {
    const spy = vi.fn();
    renderInMulti(<AppearanceBlock classes="" onClassesChange={spy} />, [A, B]);
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
