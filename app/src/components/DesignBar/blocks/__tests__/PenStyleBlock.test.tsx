// task-107 pen tool: PenStyleBlock edits fill-* / stroke-* / stroke-[Npx]
// wrapper classes on pen elements (CSS inheritance styles the inner SVG path).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// vitest.config has no svgr plugin — stub icon exports (same harness as
// TypographyBlock.color.test.tsx).
vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Stub = () => null;
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) mocked[key] = Stub;
  return mocked;
});

import { PenStyleBlock } from '../PenStyleBlock';

const onClassesChange = vi.fn();
const CLASSES = 'w-[100px] h-[80px] fill-none stroke-gray-900 stroke-2';

const openPicker = (testId: string) => {
  const trigger = screen.getByTestId(testId).querySelector('button')!;
  fireEvent.click(trigger);
};

describe('PenStyleBlock (task-107)', () => {
  beforeEach(() => onClassesChange.mockClear());

  it('picking a fill color swaps the fill token', () => {
    render(<PenStyleBlock classes={CLASSES} onClassesChange={onClassesChange} />);
    openPicker('pen-fill-picker');
    fireEvent.click(screen.getByTitle('red-500'));
    const result = onClassesChange.mock.calls[0][0] as string;
    expect(result).toContain('fill-red-500');
    expect(result).not.toContain('fill-none');
    expect(result).toContain('stroke-gray-900'); // untouched
  });

  it('picking transparent fill emits fill-none', () => {
    render(<PenStyleBlock classes={'w-[100px] h-[80px] fill-red-500 stroke-gray-900 stroke-2'} onClassesChange={onClassesChange} />);
    openPicker('pen-fill-picker');
    fireEvent.click(screen.getByTitle('transparent'));
    const result = onClassesChange.mock.calls[0][0] as string;
    expect(result).toContain('fill-none');
    expect(result).not.toContain('fill-red-500');
  });

  it('picking a stroke color swaps only the stroke COLOR token', () => {
    render(<PenStyleBlock classes={CLASSES} onClassesChange={onClassesChange} />);
    openPicker('pen-stroke-picker');
    fireEvent.click(screen.getByTitle('blue-500'));
    const result = onClassesChange.mock.calls[0][0] as string;
    expect(result).toContain('stroke-blue-500');
    expect(result).not.toContain('stroke-gray-900');
    expect(result).toContain('stroke-2'); // width untouched
  });

  it('stroke width change replaces stroke-2 with stroke-[3px]', () => {
    render(<PenStyleBlock classes={CLASSES} onClassesChange={onClassesChange} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('2'); // parsed from stroke-2
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    const result = onClassesChange.mock.calls[0][0] as string;
    expect(result).toContain('stroke-[3px]');
    expect(result).not.toMatch(/(^|\s)stroke-2(\s|$)/);
    expect(result).toContain('stroke-gray-900'); // color untouched
  });

  it('parses arbitrary widths the shared classifier recognizes (stroke-[1.5px])', () => {
    render(
      <PenStyleBlock
        classes={'w-[100px] h-[80px] fill-none stroke-gray-900 stroke-[1.5px]'}
        onClassesChange={onClassesChange}
      />,
    );
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1.5');
  });
});
