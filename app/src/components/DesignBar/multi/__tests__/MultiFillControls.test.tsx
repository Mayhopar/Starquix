/** Fill while ≥2 are selected (design §2 "Fill in multi", C8): one background colour or one gradient for all. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderInMulti, MultiProvider } from './renderInMulti';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
vi.mock('../../ColorPicker', () => ({
  ColorPicker: (p: { value: string; mixed?: boolean; placeholder?: string; onChange: (v: string, hex: string) => void }) =>
    <div data-testid="color" aria-label={p.placeholder} onClick={() => p.onChange('bg-green-500', '#0f0')}>{p.mixed ? 'Mixed' : p.value || 'none'}</div>,
}));
import { MultiFillControls, ownsFillKind, readFillColor } from '../MultiFillControls';

const renderFill = (members: string[], merged = '') => {
  const onChange = vi.fn();
  const apply = vi.fn();
  renderInMulti(<MultiFillControls classes={merged} onClassesChange={onChange} applyToEach={apply} />, members);
  return { onChange, apply };
};
const tab = (title: string) => screen.getByTitle(title);
const GRADIENTS = ['bg-gradient-to-r from-white to-black', 'bg-gradient-to-l from-red-500 via-blue-500 to-black'];

describe('MultiFillControls', () => {
  it('reads "Mixed" when colours differ', () => {
    renderFill(['bg-red-500', 'bg-blue-500']);
    expect(screen.getByTestId('color').textContent).toBe('Mixed');
  });
  it('shows the shared colour when every member has it', () => {
    renderFill(['bg-red-500 p-2', 'bg-red-500'], 'bg-red-500');
    expect(screen.getByTestId('color').textContent).toBe('bg-red-500');
  });
  it('a pick writes the colour and owns the whole fill kind', () => {
    const { onChange } = renderFill(['bg-red-500', 'bg-gradient-to-r from-white to-black']);
    fireEvent.click(screen.getByTestId('color'));
    const [next, owns] = onChange.mock.calls[0];
    expect(next).toBe('bg-green-500');
    for (const t of ['bg-red-500', 'bg-gradient-to-r', 'from-white', 'via-red-500', 'to-black', 'bg-[url(/a.png)]', 'bg-cover', 'bg-center', 'bg-no-repeat']) expect(owns(t)).toBe(true);
    for (const t of ['p-4', 'text-red-500', 'border-black', 'bg-clip-text']) expect(owns(t)).toBe(false);
  });
  it('readFillColor / ownsFillKind basics', () => {
    expect(readFillColor('p-2 bg-[#ff0000]')).toBe('bg-[#ff0000]');
    expect(readFillColor('p-2')).toBe('');
    expect(ownsFillKind('bg-[var(--brand)]')).toBe(true);
    expect(ownsFillKind('bg-[color:var(--brand)]')).toBe(true);
  });

  it('tabs are Solid | Gradient (no Media); Solid unless every member has a gradient', () => {
    renderFill(['bg-red-500', GRADIENTS[0]]);
    expect(screen.queryByTitle('Media')).toBeNull();
    expect(tab('Solid').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Gradient direction')).toBeNull();
  });

  it('every member has a gradient: opens on Gradient; each control Mixed by its own reader', () => {
    renderFill(GRADIENTS, 'to-black');
    expect(tab('Gradient').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Gradient direction') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mixed');
    expect(screen.getByLabelText('Start color').textContent).toBe('Mixed');
    expect(screen.getByLabelText('Middle color').textContent).toBe('Mixed');
    expect(screen.getByLabelText('End color').textContent).toBe('bg-black');
  });

  it('switching to Gradient is one batch: a gradient member keeps it, the rest get the default replacing their fill', () => {
    const { apply, onChange } = renderFill(['bg-red-500 p-2', GRADIENTS[1]]);
    fireEvent.click(tab('Gradient'));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    const transform = apply.mock.calls[0][0] as (e: string[]) => string[];
    expect(transform(['bg-red-500', 'p-2'])).toEqual(['p-2', 'bg-gradient-to-r', 'from-white', 'to-black']);
    expect(transform(['bg-[url(/a.png)]', 'bg-cover'])).toEqual(['bg-gradient-to-r', 'from-white', 'to-black']);
    const kept = ['bg-gradient-to-l', 'from-red-500', 'to-black'];
    expect(transform(kept)).toEqual(kept);
    expect(screen.getByLabelText('Gradient direction')).toBeTruthy();
  });

  it('the tab follows the members when their fill kind changes underneath (⌘Z of the Gradient switch)', () => {
    const ui = (members: string[]) => (
      <MultiProvider members={members}><MultiFillControls classes="" onClassesChange={vi.fn()} applyToEach={vi.fn()} /></MultiProvider>
    );
    const { rerender } = render(ui(GRADIENTS));
    expect(tab('Gradient').getAttribute('aria-pressed')).toBe('true');
    rerender(ui(['bg-white', 'bg-white p-2']));
    expect(tab('Solid').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Gradient direction')).toBeNull();
  });

  it('switching to Solid applies nothing until a colour is picked', () => {
    const { apply, onChange } = renderFill(GRADIENTS);
    fireEvent.click(tab('Solid'));
    expect(apply).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('color'));
    expect(onChange.mock.calls[0][1]('bg-gradient-to-r')).toBe(true); // the colour replaces the gradient
  });

  it('direction owns the direction only; each stop owns only its own colour', () => {
    const { onChange } = renderFill(GRADIENTS, 'to-black');
    fireEvent.change(screen.getByLabelText('Gradient direction'), { target: { value: 'to-b' } });
    let [next, owns] = onChange.mock.calls.at(-1)!;
    expect(next).toBe('to-black bg-gradient-to-b');
    expect(owns('bg-gradient-to-r')).toBe(true);
    for (const t of ['from-white', 'to-black', 'bg-red-500']) expect(owns(t)).toBe(false);

    const STOPS = [['Start color', 'from'], ['Middle color', 'via'], ['End color', 'to']] as const;
    for (const [label, stop] of STOPS) {
      fireEvent.click(screen.getByLabelText(label));
      [next, owns] = onChange.mock.calls.at(-1)!;
      expect(next.split(' ')).toContain(`${stop}-green-500`);
      expect(owns(`${stop}-red-500`)).toBe(true);
      expect(owns(`${stop}-[#ffffff]`)).toBe(true);
      expect(owns(`${stop}-10%`)).toBe(false); // a stop position is not its colour
      for (const other of STOPS.map(s => s[1]).filter(s => s !== stop)) expect(owns(`${other}-red-500`)).toBe(false);
      for (const t of ['bg-gradient-to-r', 'bg-red-500', 'p-4']) expect(owns(t)).toBe(false);
    }
  });
});
