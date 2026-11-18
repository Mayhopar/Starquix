/**
 * Layout while ≥2 are selected (design C6, C13, C14, D6, §2): every control reads "Mixed" by its own
 * reader, flex/grid controls follow the merged Display, the primary's measured size and "Set to current"
 * are hidden, and every write's `owns` accepts that control's tokens and rejects every other control's.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderInMulti } from './renderInMulti';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
vi.mock('@/context/SelectionContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSelectedRectOptional: () => ({ top: 0, left: 0, width: 640, height: 312 }),
}));
import { LayoutAppearanceBlock } from '../../blocks/LayoutAppearanceBlock';

const ACTIVE = /bg-btn-primary-fill-default/;
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const pressed = (title: string) => screen.getByTitle(title).getAttribute('aria-pressed');
const cells = () => screen.getAllByTitle(/^justify-.+ \+ items-/);
const expectMixed = (label: string) => {
  expect(input(label).value).toBe('');
  expect(input(label).placeholder).toBe('Mixed');
};

describe('LayoutAppearanceBlock while several are selected', () => {
  it('Display Mixed: no segment active, flex/grid controls hidden (C13); size, ratio and constraints read Mixed', () => {
    renderInMulti(<LayoutAppearanceBlock classes="" onClassesChange={vi.fn()} />, [
      'flex w-[100px] h-10 aspect-square min-w-[10px] max-w-md min-h-[20px] max-h-full',
      'grid w-full h-20 aspect-video min-w-0 max-w-lg min-h-[30px] max-h-[50px]',
    ]);
    for (const t of ['Flex', 'Grid', 'Other']) expect(pressed(t)).toBe('false');
    expect(screen.queryByTitle('Column')).toBeNull();
    expect(screen.queryByLabelText('Gap')).toBeNull();
    expect(screen.queryByLabelText('Grid columns')).toBeNull();
    for (const label of ['Width', 'Height', 'Min width', 'Max width', 'Min height', 'Max height']) expectMixed(label);
    expect(select('Aspect ratio').selectedOptions[0].textContent).toBe('Mixed');
  });

  it('shared flex: direction, alignment and gaps read Mixed', () => {
    renderInMulti(<LayoutAppearanceBlock classes="flex" onClassesChange={vi.fn()} />, [
      'flex flex-row justify-start items-start gap-4',
      'flex flex-col justify-end items-center gap-8',
    ]);
    for (const t of ['Row', 'Column', 'Row Reverse', 'Column Reverse']) expect(pressed(t)).toBe('false');
    for (const cell of cells()) expect(cell.className).not.toMatch(ACTIVE);
    expectMixed('Gap');
    fireEvent.click(screen.getByLabelText('Separate row and column gaps'));
    expectMixed('Horizontal gap');
    expectMixed('Vertical gap');
  });

  it('shared grid: columns and rows read Mixed', () => {
    renderInMulti(<LayoutAppearanceBlock classes="grid" onClassesChange={vi.fn()} />, [
      'grid grid-cols-2 grid-rows-1', 'grid grid-cols-3 grid-rows-4',
    ]);
    expectMixed('Grid columns');
    expectMixed('Grid rows');
  });

  it('control: one element shows its own values', () => {
    render(<LayoutAppearanceBlock classes="flex flex-col justify-center items-center gap-4 w-[100px]" onClassesChange={vi.fn()} />);
    expect(pressed('Flex')).toBe('true');
    expect(pressed('Column')).toBe('true');
    expect(cells().filter(c => ACTIVE.test(c.className))).toHaveLength(1);
    expect(input('Gap').value).toBe('16');
    expect(input('Width').value).toBe('100');
  });

  it('hides the primary\'s measured size and "Set to current" (C14)', () => {
    const { unmount } = render(<LayoutAppearanceBlock classes="w-full min-w-[10px]" onClassesChange={vi.fn()} />);
    expect(screen.getByTitle('Rendered width').textContent).toBe('640');
    fireEvent.click(screen.getByLabelText('Min width options'));
    expect(screen.getByText('Set to current width')).toBeTruthy();
    unmount();

    renderInMulti(<LayoutAppearanceBlock classes="w-full min-w-[10px]" onClassesChange={vi.fn()} />, [
      'w-full min-w-[10px]', 'w-full min-w-[10px] p-4',
    ]);
    expect(screen.queryByTitle('Rendered width')).toBeNull();
    fireEvent.click(screen.getByLabelText('Min width options'));
    expect(screen.queryByText('Set to current width')).toBeNull();
    expect(screen.getByText('Remove min width')).toBeTruthy();
  });

  it('"auto" on a Mixed width clears it on every member (no same-mode skip)', () => {
    const spy = vi.fn();
    renderInMulti(<LayoutAppearanceBlock classes="" onClassesChange={spy} />, ['w-[100px]', 'w-full']);
    fireEvent.change(input('Width'), { target: { value: 'auto' } });
    expect(spy).toHaveBeenCalled();
    const [next, owns] = spy.mock.calls.at(-1)!;
    expect(next).toBe('');
    expect(owns('w-full')).toBe(true);
  });

  /** Tokens each control owns; every token another control owns (and NOBODY's) must be rejected. */
  const OWNED = {
    display: ['flex', 'grid', 'block', 'inline-flex'],
    direction: ['flex-col'],
    wrap: ['flex-wrap'],
    gridCols: ['grid-cols-3'],
    gridRows: ['grid-rows-2'],
    width: ['w-[200px]', 'flex-1', 'grow'],
    height: ['h-10'],
    minWidth: ['min-w-0'],
    maxWidth: ['max-w-md'],
    minHeight: ['min-h-[10px]'],
    maxHeight: ['max-h-full'],
    alignment: ['justify-center', 'items-center'],
    aspect: ['aspect-video', 'aspect-[4/3]'],
    aspectWidth: ['aspect-video', 'aspect-[4/3]'],
    gap: ['gap-4', 'gap-x-2', 'gap-y-3'],
    gapX: ['gap-x-2'],
    gapY: ['gap-y-3'],
  } as const;
  const NOBODY = ['hidden', 'justify-items-center', 'justify-self-end', 'p-4', 'text-red-500', 'col-span-2'];
  type Control = keyof typeof OWNED;
  const BLOCK = ['w-[100px] h-10 aspect-square min-w-[10px] max-w-md min-h-[20px] max-h-full', 'w-full h-20 aspect-video min-w-0 max-w-lg min-h-[30px] max-h-[50px]'];
  const FLEX = ['flex flex-row justify-start gap-4', 'flex flex-col justify-end gap-8'];
  const GRID = ['grid grid-cols-2 grid-rows-1', 'grid grid-cols-3 grid-rows-4'];
  const EDITS: Record<Control, { members: string[]; merged: string; edit: () => void }> = {
    display: { members: ['flex', 'grid'], merged: '', edit: () => fireEvent.click(screen.getByTitle('Grid')) },
    direction: { members: FLEX, merged: 'flex', edit: () => fireEvent.click(screen.getByTitle('Column')) },
    wrap: { members: ['flex', 'flex flex-wrap'], merged: 'flex', edit: () => fireEvent.click(screen.getByTitle('Enable wrap')) },
    gridCols: { members: GRID, merged: 'grid', edit: () => fireEvent.change(input('Grid columns'), { target: { value: '4' } }) },
    gridRows: { members: GRID, merged: 'grid', edit: () => fireEvent.change(input('Grid rows'), { target: { value: '2' } }) },
    width: { members: BLOCK, merged: '', edit: () => fireEvent.change(input('Width'), { target: { value: '200' } }) },
    height: { members: BLOCK, merged: '', edit: () => fireEvent.change(input('Height'), { target: { value: '40' } }) },
    minWidth: { members: BLOCK, merged: '', edit: () => fireEvent.change(input('Min width'), { target: { value: '12' } }) },
    maxWidth: { members: BLOCK, merged: '', edit: () => fireEvent.change(input('Max width'), { target: { value: '300' } }) },
    minHeight: { members: BLOCK, merged: '', edit: () => fireEvent.change(input('Min height'), { target: { value: '12' } }) },
    maxHeight: { members: BLOCK, merged: '', edit: () => fireEvent.change(input('Max height'), { target: { value: '300' } }) },
    alignment: { members: FLEX, merged: 'flex', edit: () => fireEvent.click(screen.getByTitle(/^justify-center \+ items-center/)) },
    aspect: { members: BLOCK, merged: '', edit: () => fireEvent.change(select('Aspect ratio'), { target: { value: 'video' } }) },
    aspectWidth: { members: ['aspect-[4/3]', 'aspect-[4/3] p-4'], merged: 'aspect-[4/3]', edit: () => fireEvent.change(input('Aspect ratio width'), { target: { value: '16' } }) },
    gap: { members: FLEX, merged: 'flex', edit: () => fireEvent.change(input('Gap'), { target: { value: '12' } }) },
    gapX: { members: FLEX, merged: 'flex', edit: () => { fireEvent.click(screen.getByLabelText('Separate row and column gaps')); fireEvent.change(input('Horizontal gap'), { target: { value: '12' } }); } },
    gapY: { members: FLEX, merged: 'flex', edit: () => { fireEvent.click(screen.getByLabelText('Separate row and column gaps')); fireEvent.change(input('Vertical gap'), { target: { value: '12' } }); } },
  };

  it.each(Object.keys(OWNED) as Control[])('%s: its write owns its own tokens and no other control\'s', control => {
    const spy = vi.fn();
    const { members, merged, edit } = EDITS[control];
    renderInMulti(<LayoutAppearanceBlock classes={merged} onClassesChange={spy} />, members);
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
