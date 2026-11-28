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

// Owner 2026-11-28: W / H and their min / max take px, %, vw and vh, not only px.
describe('LayoutAppearanceBlock W/H units', () => {
  const written = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0].split(/\s+/).sort();
  const pickUnit = (classes: string, label: string, unit: string) => {
    const spy = vi.fn();
    render(<LayoutAppearanceBlock classes={classes} onClassesChange={spy} />);
    fireEvent.change(screen.getByLabelText(`${label} unit`), { target: { value: unit } });
    return written(spy);
  };

  it.each([
    ['w-[50px] p-4', 'Width', '%', 'p-4 w-[50%]'],
    ['h-[100px]', 'Height', 'vh', 'h-[100vh]'],
    ['w-[60vw]', 'Width', 'px', 'w-[60px]'],
    ['min-w-[10px]', 'Min width', 'vw', 'min-w-[10vw]'],
    ['max-h-[80px]', 'Max height', '%', 'max-h-[80%]'],
  ])('%s: picking %s %s writes %s', (classes, label, unit, expected) => {
    expect(pickUnit(classes, label, unit)).toEqual(expected.split(' ').sort());
  });

  it('reads the value and its unit back', () => {
    render(<LayoutAppearanceBlock classes="w-[50%] h-[100vh] min-w-[10vw] max-h-[80%]" onClassesChange={vi.fn()} />);
    for (const [label, value, unit] of [['Width', '50', '%'], ['Height', '100', 'vh'], ['Min width', '10', 'vw'], ['Max height', '80', '%']]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value, label).toBe(value);
      expect((screen.getByLabelText(`${label} unit`) as HTMLSelectElement).value, label).toBe(unit);
    }
  });

  it('reads Tailwind keywords as their length: w-screen = 100vw, h-1/2 = 50%', () => {
    render(<LayoutAppearanceBlock classes="w-screen h-1/2" onClassesChange={vi.fn()} />);
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('Width unit') as HTMLSelectElement).value).toBe('vw');
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('50');
    expect((screen.getByLabelText('Height unit') as HTMLSelectElement).value).toBe('%');
  });

  it.each([
    ['', 'Width', '50%', 'w-[50%]'],
    ['', 'Height', '100vh', 'h-[100vh]'],
    ['w-[50%]', 'Width', '60', 'w-[60%]'],      // a bare number keeps the unit
    ['min-h-[20vh]', 'Min height', '30', 'min-h-[30vh]'],
  ])('%s + %s typed %s writes %s', (classes, label, text, expected) => {
    expect(edit(classes, label, text)).toEqual([expected]);
  });

  it('a typed value that is not a length writes nothing', () => {
    const spy = vi.fn();
    render(<LayoutAppearanceBlock classes="w-[50px]" onClassesChange={spy} />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '50em' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('several selected: 50px and 50% read Mixed', async () => {
    const { renderInMulti } = await import('../multi/__tests__/renderInMulti');
    renderInMulti(<LayoutAppearanceBlock classes="" onClassesChange={vi.fn()} />, ['w-[50px]', 'w-[50%]']);
    expect((screen.getByLabelText('Width') as HTMLInputElement).placeholder).toBe('Mixed');
  });
});
