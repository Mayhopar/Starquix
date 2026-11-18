/**
 * Effects while ≥2 are selected (design C6, C12, D6, §2): rows are the UNION of the members' effect types,
 * every control reads "Mixed" by its own reader (checkboxes → indeterminate), and every write's `owns`
 * accepts that control's tokens and rejects every other control's.
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
    <div data-testid="color" onClick={() => p.onChange('shadow-green-500', '#0f0')}>{p.mixed ? 'Mixed' : p.value || 'none'}</div>,
}));
import { EffectsBlock } from '../../blocks/EffectsBlock';

const A = 'shadow-sm shadow-red-500 blur-sm backdrop-blur-sm grayscale brightness-50 contrast-50 saturate-50';
const B = 'shadow-lg shadow-blue-500 blur-lg backdrop-blur-lg invert sepia brightness-75 contrast-75 saturate-150';
const UNION = `${A} ${B}`;
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const SELECTS = ['Shadow size', 'Blur size', 'Background blur size', 'Brightness', 'Contrast', 'Saturate'];

describe('EffectsBlock while several are selected', () => {
  it('rows are the union of the members\' effect types (C12)', () => {
    renderInMulti(<EffectsBlock classes="" fullClasses="shadow-sm blur-sm" onClassesChange={vi.fn()} />, ['shadow-sm', 'blur-sm']);
    expect(screen.getAllByLabelText('Effect type').map(s => (s as HTMLSelectElement).value)).toEqual(['shadow', 'blur']);
  });

  it('every control reads "Mixed" when the members differ in it', () => {
    renderInMulti(<EffectsBlock classes="" fullClasses={UNION} onClassesChange={vi.fn()} />, [A, B]);
    expect(screen.getByTestId('color').textContent).toBe('Mixed');
    for (const label of SELECTS) expect(select(label).selectedOptions[0].textContent).toBe('Mixed');
    for (const label of ['Grayscale', 'Invert', 'Sepia']) {
      expect(box(label).indeterminate).toBe(true);
      expect(box(label).checked).toBe(false);
    }
  });

  it('control: one element shows its own values', () => {
    render(<EffectsBlock classes={A} onClassesChange={vi.fn()} />);
    expect(screen.getByTestId('color').textContent).toBe('shadow-red-500');
    expect(select('Blur size').value).toBe('sm');
    expect(select('Brightness').value).toBe('50');
    expect(box('Grayscale').checked).toBe(true);
    expect(box('Grayscale').indeterminate).toBe(false);
  });

  /** Tokens each control owns; every token another control owns (and NOBODY's) must be rejected. */
  const SHADOW_SIZE = ['shadow', 'shadow-lg'];
  const SHADOW_COLOR = ['shadow-red-500', 'shadow-[#ff0000]', 'shadow-[var(--c)]', 'shadow-[color:var(--c)]'];
  const BLUR = ['blur', 'blur-sm', 'blur-[2px]'];
  const OWNED: Record<string, readonly string[]> = {
    shadowSize: SHADOW_SIZE,
    shadowColor: SHADOW_COLOR,
    blur: BLUR,
    backdropBlur: ['backdrop-blur', 'backdrop-blur-sm'],
    grayscale: ['grayscale', 'grayscale-0'],
    invert: ['invert', 'invert-0'],
    sepia: ['sepia', 'sepia-0'],
    brightness: ['brightness-50'],
    contrast: ['contrast-125'],
    saturate: ['saturate-150'],
    deleteShadow: [...SHADOW_SIZE, ...SHADOW_COLOR],
    shadowToBlur: [...SHADOW_SIZE, ...SHADOW_COLOR, ...BLUR],
  };
  const NOBODY = ['drop-shadow', 'drop-shadow-lg', 'shadow-inner', 'hue-rotate-15', 'backdrop-grayscale', 'opacity-50', 'p-4', 'text-red-500'];
  const EDITS: Record<string, () => void> = {
    shadowSize: () => fireEvent.change(select('Shadow size'), { target: { value: 'md' } }),
    shadowColor: () => fireEvent.click(screen.getByTestId('color')),
    blur: () => fireEvent.change(select('Blur size'), { target: { value: 'xl' } }),
    backdropBlur: () => fireEvent.change(select('Background blur size'), { target: { value: 'xl' } }),
    grayscale: () => fireEvent.click(box('Grayscale')),
    invert: () => fireEvent.click(box('Invert')),
    sepia: () => fireEvent.click(box('Sepia')),
    brightness: () => fireEvent.change(select('Brightness'), { target: { value: '110' } }),
    contrast: () => fireEvent.change(select('Contrast'), { target: { value: '150' } }),
    saturate: () => fireEvent.change(select('Saturate'), { target: { value: '200' } }),
    deleteShadow: () => fireEvent.click(screen.getAllByLabelText('Remove effect')[0]),
    shadowToBlur: () => fireEvent.change(screen.getAllByLabelText('Effect type')[0], { target: { value: 'blur' } }),
  };

  it.each(Object.keys(OWNED))('%s: its write owns its own tokens and no other control\'s', control => {
    const spy = vi.fn();
    renderInMulti(<EffectsBlock classes="" fullClasses={UNION} onClassesChange={spy} />, [A, B]);
    EDITS[control]();
    expect(spy).toHaveBeenCalled();
    const owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(typeof owns).toBe('function');
    const mine = OWNED[control];
    for (const t of mine) expect(owns(t), `${control} must own ${t}`).toBe(true);
    const others = [...Object.values(OWNED).flat(), ...NOBODY].filter(t => !mine.includes(t));
    for (const t of others) expect(owns(t), `${control} must not own ${t}`).toBe(false);
  });
});
