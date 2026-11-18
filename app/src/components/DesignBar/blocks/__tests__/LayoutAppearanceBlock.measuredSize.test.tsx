import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Owner 2026-10-06: Fill / Hug show the rendered size, greyed, so other
// pages can match a real width.
vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Stub = () => null;
  return Object.fromEntries(Object.keys(actual).map((k) => [k, Stub]));
});
vi.mock('@/context/SelectionContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSelectedRectOptional: () => ({ top: 0, left: 0, width: 640.4, height: 312.6 }),
}));

import { LayoutAppearanceBlock } from '../LayoutAppearanceBlock';

describe('LayoutAppearanceBlock W/H rendered size', () => {
  it('shows the rendered width beside Fill and height beside Hug/auto', () => {
    render(<LayoutAppearanceBlock classes="flex flex-col w-full" onClassesChange={() => {}} />);
    expect(screen.getAllByTitle('Rendered width').map((e) => e.textContent)).toEqual(['640']);
    expect(screen.getAllByTitle('Rendered height').map((e) => e.textContent)).toEqual(['313']);
  });

  it('hides it for a fixed size (the field already shows the number)', () => {
    render(<LayoutAppearanceBlock classes="flex flex-col w-[300px]" onClassesChange={() => {}} />);
    expect(screen.queryByTitle('Rendered width')).toBeNull();
  });
});
