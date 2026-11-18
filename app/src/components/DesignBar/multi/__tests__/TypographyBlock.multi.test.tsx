/**
 * Typography while ≥2 are selected (design C6, D6, §2 "each write declares what it owns"):
 * every control reads "Mixed" when its own parsed value differs, and every write's `owns`
 * accepts that control's tokens and rejects every other control's.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderInMulti } from './renderInMulti';

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
vi.mock('../../ColorPicker', () => ({
  ColorPicker: (p: { value: string; mixed?: boolean; onChange: (v: string, hex: string) => void }) =>
    <div data-testid="color" onClick={() => p.onChange('text-green-500', '#0f0')}>{p.mixed ? 'Mixed' : p.value || 'none'}</div>,
}));
vi.mock('../../blocks/FontFamilySelect', () => ({
  FontFamilySelect: (p: { value: string; mixed?: boolean; onChange: (v: string) => void }) =>
    <div data-testid="family" onClick={() => p.onChange('mono')}>{p.mixed ? 'Mixed' : p.value || 'Default'}</div>,
}));
import { TypographyBlock } from '../../blocks/TypographyBlock';

const A = 'font-serif text-red-500 font-bold text-lg leading-tight tracking-wide text-center uppercase underline truncate whitespace-nowrap';
const B = 'font-mono text-blue-500 font-medium text-sm leading-loose tracking-tight text-right lowercase line-through text-clip whitespace-pre';
const ACTIVE = /bg-btn-primary-fill-default/;
const sel = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const openMenu = () => fireEvent.click(screen.getByTitle('More options'));

describe('TypographyBlock while several are selected', () => {
  it('every control reads "Mixed" when the members differ in it', () => {
    renderInMulti(<TypographyBlock classes="" onClassesChange={vi.fn()} />, [A, B]);
    expect(screen.getByTestId('family').textContent).toBe('Mixed');
    expect(screen.getByTestId('color').textContent).toBe('Mixed');
    for (const label of ['Font weight', 'Font size', 'Line height', 'Letter spacing']) expect(sel(label).selectedOptions[0].textContent).toBe('Mixed');
    for (const a of ['left', 'center', 'right']) expect(screen.getByTitle(`Align ${a}`).className).not.toMatch(ACTIVE);
    openMenu();
    for (const label of ['Text decoration', 'Text overflow', 'Whitespace']) expect(sel(label).selectedOptions[0].textContent).toBe('Mixed');
    for (const t of ['None', 'Uppercase', 'Lowercase', 'Capitalize']) expect(screen.getByTitle(t).className).not.toMatch(ACTIVE);
  });

  it('control: one element shows its own values (align/transform active)', () => {
    render(<TypographyBlock classes={A} onClassesChange={vi.fn()} />);
    expect(screen.getByTitle('Align center').className).toMatch(ACTIVE);
    expect(sel('Font weight').value).toBe('bold');
    openMenu();
    expect(screen.getByTitle('Uppercase').className).toMatch(ACTIVE);
  });

  const SAMPLES = {
    family: 'font-serif', color: 'text-red-500', weight: 'font-bold', size: 'text-lg', lineHeight: 'leading-tight',
    letterSpacing: 'tracking-wide', align: 'text-center', transform: 'uppercase', decoration: 'underline',
    overflow: 'truncate', whitespace: 'whitespace-nowrap',
  } as const;
  type Control = keyof typeof SAMPLES;
  const EDITS: Record<Control, () => void> = {
    family: () => fireEvent.click(screen.getByTestId('family')),
    color: () => fireEvent.click(screen.getByTestId('color')),
    weight: () => fireEvent.change(sel('Font weight'), { target: { value: 'black' } }),
    size: () => fireEvent.change(sel('Font size'), { target: { value: 'xl' } }),
    lineHeight: () => fireEvent.change(sel('Line height'), { target: { value: 'snug' } }),
    letterSpacing: () => fireEvent.change(sel('Letter spacing'), { target: { value: 'widest' } }),
    align: () => fireEvent.click(screen.getByTitle('Align left')),
    transform: () => { openMenu(); fireEvent.click(screen.getByTitle('Capitalize')); },
    decoration: () => { openMenu(); fireEvent.change(sel('Text decoration'), { target: { value: 'overline' } }); },
    overflow: () => { openMenu(); fireEvent.change(sel('Text overflow'), { target: { value: 'text-ellipsis' } }); },
    whitespace: () => { openMenu(); fireEvent.change(sel('Whitespace'), { target: { value: 'whitespace-pre-line' } }); },
  };

  it.each(Object.keys(SAMPLES) as Control[])('%s: its write owns its own tokens and no other control\'s', control => {
    const spy = vi.fn();
    renderInMulti(<TypographyBlock classes="" onClassesChange={spy} />, [A, B]);
    EDITS[control]();
    expect(spy).toHaveBeenCalled();
    const owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(typeof owns).toBe('function');
    expect(owns(SAMPLES[control])).toBe(true);
    for (const [other, token] of Object.entries(SAMPLES)) if (other !== control) expect(owns(token), `${control} must not own ${token}`).toBe(false);
  });
});
