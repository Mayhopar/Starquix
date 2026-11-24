/**
 * Audit #25: the colour readers rejected an opacity modifier, so `border border-white/10` read as "no
 * colour": a width edit added border-black next to it and the next edit dropped the original colour.
 * text-white/80 and shadow-black/20 likewise survived a colour pick as a second, conflicting colour.
 * One shared suffix (OPACITY_SUFFIX) makes every colour reader accept `/10` and `/[.15]`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
vi.mock('@/store/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/hooks')>();
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return { ...actual, useEditorDoc: () => doc, useYjsValue: <T,>(sel: (d: import('yjs').Doc) => T) => sel(doc), useDispatch: () => () => true };
});
// The real picker (what the field shows) plus a palette click for the block's own colour writer.
vi.mock('./ColorPicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ColorPicker')>();
  return {
    ...actual,
    ColorPicker: (p: React.ComponentProps<typeof actual.ColorPicker>) => (
      <div data-testid={`color-${p.prefix}`}>
        <actual.ColorPicker {...p} />
        <button data-testid={`pick-${p.prefix}`} onClick={() => p.onChange(`${p.prefix}-green-500`, '#22c55e')} />
      </div>
    ),
  };
});
import { StrokeBlock } from './blocks/StrokeBlock';
import { TypographyBlock } from './blocks/TypographyBlock';
import { EffectsBlock } from './blocks/EffectsBlock';

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();
const lastWrite = (spy: ReturnType<typeof vi.fn>) => tokens(spy.mock.calls.at(-1)![0]);

describe('colour readers accept an opacity modifier (#25)', () => {
  it.each(['border-white/10', 'border-gray-200/50', 'border-primary/[.15]', 'border-[#ffffff]/20'])(
    'Stroke width on border %s keeps that colour and adds no border-black', (color) => {
      const spy = vi.fn();
      render(<StrokeBlock classes={`border ${color}`} onClassesChange={spy} />);
      fireEvent.change(screen.getByLabelText('Stroke width'), { target: { value: '2' } });
      expect(lastWrite(spy)).toEqual(tokens(`${color} border-2`));
    });

  it('the Stroke colour field shows the translucent colour, not None', () => {
    render(<StrokeBlock classes="border border-white/10" onClassesChange={vi.fn()} />);
    expect(within(screen.getByTestId('color-border')).getByText('white')).toBeTruthy();
  });

  it('a Stroke colour pick replaces the translucent colour', () => {
    const spy = vi.fn();
    render(<StrokeBlock classes="border border-white/10" onClassesChange={spy} />);
    fireEvent.click(screen.getByTestId('pick-border'));
    expect(lastWrite(spy)).toEqual(tokens('border border-green-500'));
  });

  it.each(['text-white/80', 'text-[#ffffff]/[.15]', 'text-[var(--brand)]/50'])('a text colour pick replaces %s', (color) => {
    const spy = vi.fn();
    render(<TypographyBlock classes={`text-lg ${color}`} computedStyles={null} onClassesChange={spy} />);
    fireEvent.click(screen.getByTestId('pick-text'));
    expect(lastWrite(spy)).toEqual(tokens('text-lg text-green-500'));
  });

  it('a shadow colour pick replaces shadow-black/20', () => {
    const spy = vi.fn();
    render(<EffectsBlock classes="shadow-lg shadow-black/20" onClassesChange={spy} />);
    expect(within(screen.getByTestId('color-shadow')).getByText('black')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pick-shadow'));
    expect(lastWrite(spy)).toEqual(tokens('shadow-lg shadow-green-500'));
  });
});
