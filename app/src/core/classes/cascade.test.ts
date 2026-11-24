import { describe, it, expect } from 'vitest';
import { parseClasses, serializeClasses, cloneStorage, getEffectiveClasses, computeSlotContent, mergeClasses } from './index';
import type { Breakpoint, State } from './types';

/** One design-bar edit, the way DesignBar.handleClassesChange runs it: the block gets the effective tokens
 *  of the slot, returns its new list, and the slot stores what differs from what it inherits. */
function edit(classes: string, transform: (effective: string[]) => string[], bp: Breakpoint = 'xs', state: State = 'default') {
  const storage = parseClasses(classes);
  const next = cloneStorage(storage);
  next[bp].light[state] = computeSlotContent(next, bp, 'light', state, transform(getEffectiveClasses(storage, bp, 'light', state)));
  return serializeClasses(next);
}
const setOpacity = (tokens: string[]) => [...tokens.filter(t => !t.startsWith('opacity-')), 'opacity-50'];

describe('an edit keeps every class it did not touch (audit #2)', () => {
  it.each([
    'rounded-lg p-4 ring-2 ring-blue-500 shadow-lg shadow-blue-500/50',
    'mt-6 text-lg/8 text-gray-600',
    'divide-y divide-gray-100',
    'mt-4 p-4 ring-1 ring-black/5 text-sm/6 text-stone-700',
    'bg-white bg-gradient-to-r from-indigo-500 from-10% to-emerald-500 to-90%',
    'flex-1 flex-shrink-0 w-full w-[320px]',
  ])('%s', classes => {
    expect(edit(classes, setOpacity)).toBe(`${classes} opacity-50`);
  });

  it('keeps the focus layer pair when the focus state is edited', () => {
    const classes = 'ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600';
    expect(edit(classes, setOpacity, 'xs', 'focus').split(' ')).toEqual(expect.arrayContaining(['focus:ring-2', 'focus:ring-indigo-600', 'focus:opacity-50']));
  });

  it('an override slot stores only the edit, never copies of inherited classes', () => {
    expect(edit('ring-2 ring-blue-500 flex-1 flex-shrink-0', setOpacity, 'md')).toBe('ring-2 ring-blue-500 flex-1 flex-shrink-0 md:opacity-50');
  });
});

describe('Hidden then Visible keeps the display class (audit #7)', () => {
  it.each(['flex items-center gap-4', 'grid grid-cols-3 gap-8', 'inline-flex items-center px-4'])('%s', classes => {
    const hidden = edit(classes, tokens => [...tokens, 'hidden']);
    expect(hidden).toBe(`${classes} hidden`);
    expect(edit(hidden, tokens => tokens.filter(t => t !== 'hidden'))).toBe(classes);
  });
});

describe('a later slot still overrides an earlier one', () => {
  it('md:bg-blue-500 replaces bg-white at md and keeps the rest', () => {
    const storage = parseClasses('bg-white p-4 md:bg-blue-500');
    expect(getEffectiveClasses(storage, 'md', 'light', 'default')).toEqual(['p-4', 'bg-blue-500']);
    expect(getEffectiveClasses(storage, 'xs', 'light', 'default')).toEqual(['bg-white', 'p-4']);
  });
});

describe('mergeClasses keeps every override token of a slot (audit #2, write-back path)', () => {
  it('an override carrying ring-2 ring-blue-500 keeps both', () => {
    expect(mergeClasses('p-4 ring-1 ring-gray-300', 'ring-2 ring-blue-500 opacity-50')).toBe('p-4 ring-2 ring-blue-500 opacity-50');
  });
});
