/**
 * Audit #6: the Min/Max size reader and writer matched the token behind ANY variant chain, so setting Max
 * height on an accordion (`max-h-0 group-open:max-h-96`) deleted the open state and it never opened. The
 * block sees the active layer's classes; a token still carrying a variant (group-open:, peer-checked:,
 * max-md:, focus-visible:) belongs to a state the bar does not edit — read and write the bare token only.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
import { LayoutAppearanceBlock } from './LayoutAppearanceBlock';

function edit(classes: string, label: string, value: string): string[] {
  const spy = vi.fn();
  render(<LayoutAppearanceBlock classes={classes} onClassesChange={spy} />);
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  return spy.mock.calls.at(-1)![0].split(/\s+/).sort();
}

describe('LayoutAppearanceBlock min/max: a variant token is not the constraint (#6)', () => {
  it.each([
    ['overflow-hidden max-h-0 group-open:max-h-96', 'Max height', 'overflow-hidden group-open:max-h-96 max-h-[300px]'],
    ['max-w-xs peer-checked:max-w-md', 'Max width', 'peer-checked:max-w-md max-w-[300px]'],
    ['max-w-md max-md:max-w-full', 'Max width', 'max-md:max-w-full max-w-[300px]'],
    ['min-h-[40px] focus-visible:min-h-[48px]', 'Min height', 'focus-visible:min-h-[48px] min-h-[300px]'],
  ])('%s + %s 300 keeps the variant token', (classes, label, expected) => {
    expect(edit(classes, label, '300')).toEqual(expected.split(' ').sort());
  });

  it('a variant token alone is not read as the constraint', () => {
    render(<LayoutAppearanceBlock classes="peer-checked:max-w-md" onClassesChange={vi.fn()} />);
    expect(screen.queryByLabelText('Max width')).toBeNull();
  });
});
