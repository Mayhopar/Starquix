/**
 * Typography fields take any typed value besides their presets (owner 2026-11-28: "allow any numeric value"):
 * a typed number is written as a Tailwind arbitrary value and reads back as typed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) mocked[key] = () => null;
  return mocked;
});
vi.mock('@/store/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/hooks')>();
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return { ...actual, useEditorDoc: () => doc, useYjsValue: <T,>(selector: (d: import('yjs').Doc) => T) => selector(doc), useDispatch: () => () => true };
});

import { TypographyBlock } from '../TypographyBlock';
import { getPropertyGroup } from '@/core/classes/index';

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

/** Type into a field and press Enter; returns the classes written (or undefined). */
const typeInto = (classes: string, label: string, text: string) => {
  const spy = vi.fn();
  render(<TypographyBlock classes={classes} onClassesChange={spy} />);
  const input = field(label);
  input.focus();
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return spy.mock.calls.at(-1)?.[0] as string | undefined;
};

describe('TypographyBlock: typed values', () => {
  it.each([
    ['Line height', '1.35', 'leading-[1.35]'],
    ['Line height', '28px', 'leading-[28px]'],
    ['Letter spacing', '0.5', 'tracking-[0.5px]'],
    ['Letter spacing', '-0.02em', 'tracking-[-0.02em]'],
    ['Font size', '17', 'text-[17px]'],
    ['Font size', '18', 'text-lg'],
    ['Font size', '1.5rem', 'text-2xl'],        // the scale token when there is one
    ['Font size', '1.1rem', 'text-[1.1rem]'],
    ['Font weight', '650', 'font-[650]'],
  ])('%s: typing %s writes %s and keeps the other classes', (label, text, token) => {
    const written = typeInto('text-red-500 p-4', label, text);
    expect(written?.split(' ').sort()).toEqual(['p-4', 'text-red-500', token].sort());
  });

  it.each([['Line height', 'Snug', 'leading-snug'], ['Font weight', 'bold', 'font-bold']])(
    '%s: a typed preset name (%s) picks the preset', (label, text, token) => {
      expect(typeInto('', label, text)).toBe(token);
    });

  it('replaces the previous value of the same field only', () => {
    expect(typeInto('leading-snug tracking-wide', 'Line height', '1.35')?.split(' ').sort())
      .toEqual(['leading-[1.35]', 'tracking-wide']);
  });

  it.each([
    ['Line height', 'abc'], ['Line height', '-1'], ['Font size', '0'], ['Font weight', '1200'], ['Font weight', '650px'],
  ])('%s: %s is not a value — nothing is written, the field reverts', (label, text) => {
    expect(typeInto('leading-snug font-bold text-lg', label, text)).toBeUndefined();
    expect(field(label).value).not.toBe(text);
  });

  it('reads arbitrary values back as typed, presets by their label', () => {
    render(<TypographyBlock classes="leading-[1.35] tracking-[0.5px] text-[17px] font-[650]" onClassesChange={vi.fn()} />);
    expect(field('Line height').value).toBe('1.35');
    expect(field('Letter spacing').value).toBe('0.5px');
    expect(field('Font size').value).toBe('17');
    expect(field('Font weight').value).toBe('650');
  });

  it('reads presets by their label; leading-N (Tailwind spacing) in px', () => {
    render(<TypographyBlock classes="leading-6 tracking-wide text-lg font-bold" onClassesChange={vi.fn()} />);
    expect(field('Line height').value).toBe('24px');
    expect(field('Letter spacing').value).toBe('Wide');
    expect(field('Font size').value).toBe('18');
    expect(field('Font weight').value).toBe('Bold');
  });

  it('the menu still picks presets', () => {
    const spy = vi.fn();
    render(<TypographyBlock classes="leading-[1.35]" onClassesChange={spy} />);
    fireEvent.click(screen.getByLabelText('Line height options'));
    fireEvent.click(screen.getByText('Relaxed'));
    expect(spy).toHaveBeenLastCalledWith('leading-relaxed', expect.any(Function));
  });

  it('typed tokens belong to their field (multi-select owns them)', () => {
    expect(getPropertyGroup('leading-[1.35]')).toBe(getPropertyGroup('leading-snug'));
    expect(getPropertyGroup('tracking-[-0.02em]')).toBe(getPropertyGroup('tracking-wide'));
    expect(getPropertyGroup('font-[650]')).toBe(getPropertyGroup('font-bold'));
    expect(getPropertyGroup('text-[17px]')).toBe(getPropertyGroup('text-lg'));
  });
});
