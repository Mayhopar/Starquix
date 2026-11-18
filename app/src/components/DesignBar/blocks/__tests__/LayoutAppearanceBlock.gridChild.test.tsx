import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// vitest.config has no svgr plugin, so `*.svg?react` icons resolve to URL strings
// and crash jsdom render. Stub every icon export with a null-rendering component
// (keep the real export names so vitest's named-binding check passes).
vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Stub = () => null;
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) mocked[key] = Stub;
  return mocked;
});

import { LayoutAppearanceBlock } from '../LayoutAppearanceBlock';

const cell = { colStart: 1, colSpan: 6, rowStart: 1, rowSpan: 1 };

describe('LayoutAppearanceBlock grid-child Start+Span (task-090)', () => {
  it('shows Start and Span from a col-span-6 child (BUG-B: was empty)', () => {
    render(
      <LayoutAppearanceBlock
        classes="col-span-6 flex flex-col"
        onClassesChange={() => {}}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={cell}
      />,
    );
    expect((screen.getByLabelText('Column start') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Column span') as HTMLInputElement).value).toBe('6');
  });

  it('falls back to rendered cell when the child has NO placement classes', () => {
    render(
      <LayoutAppearanceBlock
        classes="flex flex-col"
        onClassesChange={() => {}}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={{ colStart: 3, colSpan: 2, rowStart: 1, rowSpan: 1 }}
      />,
    );
    expect((screen.getByLabelText('Column start') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Column span') as HTMLInputElement).value).toBe('2');
  });

  it('editing Span writes canonical col-span-N and drops the stale span (no churn)', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="col-span-6 flex flex-col"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={cell}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column span'), { target: { value: '4' } });
    fireEvent.blur(screen.getByLabelText('Column span'));
    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg).toContain('col-span-4');
    expect(arg).not.toContain('col-span-6');
  });

  it('column-first: editing Span strips a conflicting fixed width (drawn w-[390px])', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="w-[390px] h-[201px] col-span-6 bg-stone-300"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={{ colStart: 1, colSpan: 6, rowStart: 1, rowSpan: 1 }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column span'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Column span'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg).toContain('col-span-10');
    expect(arg).not.toMatch(/(?:^|\s)w-\[390px\]/); // width yields to the column
    expect(arg).toContain('h-[201px]'); // height untouched (col change only)
    expect(arg).toContain('bg-stone-300');
  });

  it('editing Start preserves the width of a col-end child (was: collapsed to span 1)', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="col-start-2 col-end-6 flex"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={{ colStart: 2, colSpan: 4, rowStart: 1, rowSpan: 1 }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column start'), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText('Column start'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg).toContain('col-start-3');
    expect(arg).toContain('col-span-4');
    expect(arg).not.toContain('col-end-6');
  });

  it('editing Start does NOT strip a fixed width (position edit, not a resize)', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="col-start-2 w-[300px]"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={{ colStart: 2, colSpan: 1, rowStart: 1, rowSpan: 1 }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column start'), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText('Column start'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg).toContain('w-[300px]');
  });

  it('an out-of-range Start commits the clamped value (task-090: silent no-op; task-094 B1: clamp)', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="col-start-2 col-span-3"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        parentGridSizeIsExact
        gridCell={{ colStart: 2, colSpan: 3, rowStart: 1, rowSpan: 1 }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column start'), { target: { value: '13' } });
    fireEvent.blur(screen.getByLabelText('Column start'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg.split(/\s+/)).toContain('col-start-12');
  });

  it('B1: edit commits under a non-exact class-fallback bound (grid-cols-1 md:grid-cols-6 at xs)', () => {
    // Layers-panel selection: no geometry (gridCell null), parent cols read from
    // classes at the WRONG breakpoint → 1. Pre-task-094 every edit ≥2 died silently.
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="flex"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={1}
        parentGridRows={0}
        parentGridSizeIsExact={false}
        gridCell={null}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column start'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('Column start'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg.split(/\s+/)).toContain('col-start-2');
  });

  it('trusts an exact (geometry-sourced) parent bound when clamping', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="flex"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={6}
        parentGridRows={0}
        parentGridSizeIsExact
        gridCell={{ colStart: 1, colSpan: 1, rowStart: 1, rowSpan: 1 }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column start'), { target: { value: '99' } });
    fireEvent.blur(screen.getByLabelText('Column start'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg.split(/\s+/)).toContain('col-start-6'); // NOT col-start-12
  });

  it('editing Span on a span-only child does NOT materialize a col-start', () => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes="col-span-6 flex flex-col"
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        gridCell={cell}
      />,
    );
    fireEvent.change(screen.getByLabelText('Column span'), { target: { value: '4' } });
    fireEvent.blur(screen.getByLabelText('Column span'));
    const arg = onChange.mock.calls.at(-1)![0] as string;
    expect(arg).not.toMatch(/col-start-\d/);
  });
});

describe('grid placement draft buffer (task-094 B2)', () => {
  const setup = (classes = 'col-span-6 flex flex-col') => {
    const onChange = vi.fn();
    render(
      <LayoutAppearanceBlock
        classes={classes}
        onClassesChange={onChange}
        isGridChild
        parentGridCols={12}
        parentGridRows={0}
        parentGridSizeIsExact
        gridCell={cell}
      />,
    );
    return { onChange, span: screen.getByLabelText('Column span') as HTMLInputElement };
  };

  it('typing "10" into span commits ONCE on blur and never destroys the span mid-typing', () => {
    const { onChange, span } = setup();
    fireEvent.focus(span);
    fireEvent.change(span, { target: { value: '1' } });
    fireEvent.change(span, { target: { value: '10' } });
    // pre-fix: '1' committed instantly, deleting col-span-6 (span<=1 emits no token)
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(span);
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as string;
    expect(arg.split(/\s+/)).toContain('col-span-10');
    expect(arg).not.toContain('col-span-6');
  });

  it('Enter commits once (blur after Enter does not double-commit)', () => {
    const { onChange, span } = setup();
    fireEvent.focus(span);
    fireEvent.change(span, { target: { value: '4' } });
    fireEvent.keyDown(span, { key: 'Enter' });
    fireEvent.blur(span);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as string).split(/\s+/)).toContain('col-span-4');
  });

  it('Escape reverts to the pre-focus value without committing', () => {
    const { onChange, span } = setup();
    fireEvent.focus(span);
    fireEvent.change(span, { target: { value: '9' } });
    fireEvent.keyDown(span, { key: 'Escape' });
    fireEvent.blur(span);
    expect(onChange).not.toHaveBeenCalled();
    expect(span.value).toBe('6');
  });

  it('ArrowUp steps and commits immediately (existing behavior preserved)', () => {
    const { onChange, span } = setup();
    fireEvent.keyDown(span, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as string).split(/\s+/)).toContain('col-span-7');
  });

  it('span input keeps span semantics: labeled "Column span", tooltip names span, placeholder "auto"', () => {
    const { span } = setup();
    expect(span.placeholder).toBe('auto');
    expect(span.title).toBe('Span (number of tracks)');
    expect((screen.getByLabelText('Column start') as HTMLInputElement).placeholder).toBe('auto');
  });
});


describe('gap controls', () => {
  it('keeps the icon toggle and original one-field/two-field behavior', () => {
    const onChange = vi.fn();
    render(<LayoutAppearanceBlock classes="flex gap-4" onClassesChange={onChange} />);
    const toggle = screen.getByRole('button', { name: 'Separate row and column gaps' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('checkbox', { name: 'Separate gaps' })).toBeNull();
    expect(screen.getByLabelText('Gap')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Horizontal gap')).toBeTruthy();
    expect(screen.getByLabelText('Vertical gap')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Gap')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps horizontal and vertical inputs independently editable, including zero', () => {
    const onChange = vi.fn();
    const { rerender } = render(<LayoutAppearanceBlock classes="flex gap-x-2 gap-y-4" onClassesChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Horizontal gap'), { target: { value: '12' } });
    fireEvent.blur(screen.getByLabelText('Horizontal gap'));
    const next = onChange.mock.calls.at(-1)![0] as string;
    expect(next.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'gap-x-3', 'gap-y-4']));
    rerender(<LayoutAppearanceBlock classes={next} onClassesChange={onChange} />);
    expect((screen.getByLabelText('Horizontal gap') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Vertical gap') as HTMLInputElement).value).toBe('16');
    fireEvent.change(screen.getByLabelText('Vertical gap'), { target: { value: '0' } });
    fireEvent.blur(screen.getByLabelText('Vertical gap'));
    const final = onChange.mock.calls.at(-1)![0] as string;
    expect(final.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'gap-x-3', 'gap-y-0']));
  });
});
