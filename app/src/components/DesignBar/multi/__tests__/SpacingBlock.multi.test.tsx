/**
 * Spacing while ≥2 are selected (design C6, D6, §2): each field reads "Mixed" by the block's own
 * per-side reader (Y = T+B, X = L+R), and an edit writes ONLY the edited sides, raw, owning exactly
 * those sides — members keep their shorthands (p-4, py-2).
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
import { SpacingBlock } from '../../blocks/SpacingBlock';

const A = 'pt-1 pr-2 pb-3 pl-4 mt-1 mr-2 mb-3 ml-4';
const B = 'pt-5 pr-6 pb-7 pl-8 mt-5 mr-6 mb-7 ml-8';
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const expandAll = () => screen.getAllByTitle('Expand to individual sides').forEach(b => fireEvent.click(b));

describe('SpacingBlock while several are selected', () => {
  it('every field reads "Mixed" (collapsed Y/X and expanded sides)', () => {
    renderInMulti(<SpacingBlock classes="" onClassesChange={vi.fn()} />, [A, B]);
    for (const label of ['Padding Y', 'Padding X', 'Margin Y', 'Margin X']) {
      expect(input(label).value).toBe('');
      expect(input(label).placeholder).toBe('Mixed');
    }
    expandAll();
    for (const type of ['Padding', 'Margin']) for (const side of ['top', 'left', 'bottom', 'right']) {
      expect(input(`${type} ${side}`).placeholder).toBe('Mixed');
    }
  });

  it('a field whose sides agree across members is not Mixed', () => {
    renderInMulti(<SpacingBlock classes="pt-1 pb-3" onClassesChange={vi.fn()} />, ['pt-1 pb-3 pl-2', 'pt-1 pb-3 pl-9']);
    expandAll();
    expect(input('Padding top').value).toBe('4');
    expect(input('Padding left').placeholder).toBe('Mixed');
  });

  it('control: one element shows its own values', () => {
    render(<SpacingBlock classes="p-4" onClassesChange={vi.fn()} />);
    expect(input('Padding Y').value).toBe('16');
  });

  it('a Y edit writes only pt-/pb- and owns only them (members keep px-2, py-8, p-4)', () => {
    const spy = vi.fn();
    renderInMulti(<SpacingBlock classes="" onClassesChange={spy} />, ['p-4 px-2', 'py-8']);
    fireEvent.change(input('Padding Y'), { target: { value: '24' } });
    const [next, owns] = spy.mock.calls.at(-1)!;
    expect(next).toBe('pt-6 pb-6');
    expect(owns('pt-6')).toBe(true);
    expect(owns('pb-[10px]')).toBe(true);
    for (const t of ['px-2', 'py-8', 'p-4', 'pl-2', 'mt-6']) expect(owns(t)).toBe(false);
  });

  it('a side edit owns only that side; margin owns negatives and auto, never the axis', () => {
    const spy = vi.fn();
    renderInMulti(<SpacingBlock classes="" onClassesChange={spy} />, [A, B]);
    expandAll();
    fireEvent.change(input('Padding top'), { target: { value: '8' } });
    let owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(spy.mock.calls.at(-1)![0]).toBe('pt-2');
    expect(owns('pt-4')).toBe(true);
    for (const t of ['pb-4', 'py-2', 'p-4', 'mt-4']) expect(owns(t)).toBe(false);

    fireEvent.change(input('Margin top'), { target: { value: 'auto' } });
    owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(spy.mock.calls.at(-1)![0]).toBe('mt-auto');
    for (const t of ['mt-6', '-mt-6', 'mt-auto']) expect(owns(t)).toBe(true);
    for (const t of ['my-2', 'm-4', 'mb-2', 'pt-6']) expect(owns(t)).toBe(false);
  });

  it('clearing a shared field removes that side on every member (owned, no token)', () => {
    const spy = vi.fn();
    renderInMulti(<SpacingBlock classes="pr-2" onClassesChange={spy} />, ['pr-2 pt-1', 'pr-2 pt-5']);
    expandAll();
    expect(input('Padding right').value).toBe('8');
    fireEvent.change(input('Padding right'), { target: { value: '' } });
    const [next, owns] = spy.mock.calls.at(-1)!;
    expect(next).toBe('');
    expect(owns('pr-6')).toBe(true);
  });
});
