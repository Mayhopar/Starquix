import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppearanceBlock } from '../AppearanceBlock';

const scaleInput = () => screen.getByLabelText('Scale') as HTMLInputElement;

describe('AppearanceBlock scale', () => {
  it.each([
    ['', '100'],
    ['scale-110', '110'],
    ['scale-[1.2]', '120'],
    ['scale-[85%]', '85'],
  ])('reads %j as %s%%', (classes, shown) => {
    render(<AppearanceBlock classes={classes} onClassesChange={() => {}} />);
    expect(scaleInput().value).toBe(shown);
  });

  it.each([
    ['110', 'p-4 scale-x-50 scale-110'],
    ['120', 'p-4 scale-x-50 scale-[1.2]'],
    ['100', 'p-4 scale-x-50'],
  ])('writes %s%% as %j, replacing only the uniform scale', (typed, expected) => {
    const onChange = vi.fn();
    render(<AppearanceBlock classes="p-4 scale-75 scale-x-50" onClassesChange={onChange} />);
    fireEvent.change(scaleInput(), { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(expected, expect.any(Function)); // 2nd arg: owns (multi-select)
  });
});
