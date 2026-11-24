/**
 * Audit #5 / #43: a spacing edit rewrote every padding (or margin) token from what it could PARSE, so a
 * token it could not read was deleted (`px-[clamp(…)] py-8` + Padding Y → `py-10`; `m-auto` + Margin Y →
 * `my-4`, no longer centred), and an important token (`!p-4`, Tailwind 3) was not seen as padding at all,
 * so the edit landed next to it and lost. One reader rule: a side reads its most specific token (side →
 * axis → all, `!` included); an edit re-expresses what it can read and keeps what it cannot.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderInMulti } from '../multi/__tests__/renderInMulti';

vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
import { SpacingBlock } from './SpacingBlock';

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('SpacingBlock: an edit keeps the tokens it cannot read (#5) and replaces important ones (#43)', () => {
  it.each([
    ['px-[clamp(1rem,5vw,3rem)] py-8', 'Padding Y', '40', 'px-[clamp(1rem,5vw,3rem)] py-10'],
    ['px-gutter py-8', 'Padding Y', '40', 'px-gutter py-10'],
    ['px-2xs py-8', 'Padding Y', '40', 'px-2xs py-10'],
    ['pt-[env(safe-area-inset-top)] px-4', 'Padding X', '40', 'pt-[env(safe-area-inset-top)] px-10'],
    ['mt-4 mb-[-4px]', 'Margin X', '8', 'mb-[-4px] mx-2 mt-4'],
    // px-[clamp] wins over p-4 for left/right: it is what X reads, so it stays.
    ['p-4 px-[clamp(1rem,5vw,3rem)]', 'Padding Y', '24', 'px-[clamp(1rem,5vw,3rem)] py-6'],
    // The edited sides replace their own unreadable token.
    ['py-[var(--y)] px-4', 'Padding Y', '40', 'px-4 py-10'],
    ['!p-4 flex', 'Padding Y', '24', 'flex px-4 py-6'],
    ['p-4', 'Padding Y', '24', 'px-4 py-6'],
  ])('%s + %s %s → %s', (classes, label, value, expected) => {
    const spy = vi.fn();
    render(<SpacingBlock classes={classes} onClassesChange={spy} />);
    fireEvent.change(field(label), { target: { value } });
    expect(tokens(spy.mock.calls.at(-1)![0])).toEqual(tokens(expected));
  });

  it('a side reads its own unreadable axis, never the all-sides token it overrides', () => {
    render(<SpacingBlock classes="p-4 px-[clamp(1rem,5vw,3rem)]" onClassesChange={vi.fn()} />);
    expect(field('Padding X').value).toBe('');
  });

  it('!p-4 reads as padding', () => {
    render(<SpacingBlock classes="!p-4 flex" onClassesChange={vi.fn()} />);
    expect(field('Padding Y').value).toBe('16');
  });

  it('m-auto reads as auto; a Margin Y edit keeps it centred', () => {
    const spy = vi.fn();
    function Live() {
      const [classes, setClasses] = useState('m-auto');
      return <SpacingBlock classes={classes} onClassesChange={c => { spy(c); setClasses(c); }} />;
    }
    render(<Live />);
    const removeAuto = screen.getAllByTitle('Remove auto');
    expect(removeAuto).toHaveLength(2); // Y and X
    fireEvent.click(removeAuto[0]);
    fireEvent.change(field('Margin Y'), { target: { value: '16' } });
    expect(tokens(spy.mock.calls.at(-1)![0])).toEqual(tokens('ml-auto mr-auto my-4'));
  });

  it('several selected: an edit owns its sides important tokens too', () => {
    const spy = vi.fn();
    renderInMulti(<SpacingBlock classes="" onClassesChange={spy} />, ['!pt-4', 'pt-1']);
    fireEvent.change(field('Padding Y'), { target: { value: '24' } });
    const owns = spy.mock.calls.at(-1)![1] as (t: string) => boolean;
    expect(owns('!pt-4')).toBe(true);
    expect(owns('!px-4')).toBe(false);
  });
});
