import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { classifyToken } from './variantCell';
import { CLASS_PATTERNS } from './classPatterns';
import { BlockOverridePills, BLOCK_PATTERNS } from './BlockOverridePills';
import { parseClasses } from '@/core/classes/index';

vi.mock('./PrefixTag', () => ({ PrefixTag: ({ tag }: { tag: { label: string } }) => <span>{tag.label}</span> }));

// Variants the editor can't edit (group-*, peer-*, named groups) are not the hover/dark it can (#6 investigation).
describe('a token is read by its own variants', () => {
  it('dark:group-hover/card: is not a dark cell', () => {
    expect(classifyToken('dark:group-hover/card:text-white')).toBeNull();
  });

  it('group-hover: lights no hover pill', () => {
    render(<BlockOverridePills classes="text-stone-900 group-hover:text-sky-600" blockPattern={BLOCK_PATTERNS.typography} />);
    expect(screen.queryByText('hover')).toBeNull();
  });

  it('md:hover: still lights md and hover', () => {
    render(<BlockOverridePills classes="text-stone-900 md:hover:font-medium" blockPattern={BLOCK_PATTERNS.typography} />);
    expect(screen.queryByText('md')).not.toBeNull();
    expect(screen.queryByText('hover')).not.toBeNull();
  });

  it('group-hover:bg- does not make Fill or Stroke look present', () => {
    expect(CLASS_PATTERNS.fill.test('p-4 group-hover:bg-sky-50')).toBe(false);
    expect(CLASS_PATTERNS.stroke.test('p-4 peer-checked:border-sky-500')).toBe(false);
    expect(CLASS_PATTERNS.fill.test('p-4 bg-white')).toBe(true);
    expect(CLASS_PATTERNS.stroke.test('p-4 ring')).toBe(true);
  });

  it('stacked variants are read in any order (hover:md: is md:hover:)', () => {
    expect(parseClasses('hover:md:bg-red-500').md.light.hover).toEqual(['bg-red-500']);
    expect(parseClasses('dark:md:bg-black').md.dark.default).toEqual(['bg-black']);
  });
});

describe('two variants of one axis stay in the class name', () => {
  it('hover:focus:bg-x keeps focus: in the hover slot', () => {
    expect(parseClasses('hover:focus:bg-x').xs.light.hover).toEqual(['focus:bg-x']);
  });
});
