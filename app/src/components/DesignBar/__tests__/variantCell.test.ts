/**
 * variantCell classifier (composite-pills). Decomposes a class token into its
 * (breakpoint, theme, state) grid cell, ignoring the utility. The ONE classifier
 * shared by HeaderTags (pill extraction) and DesignBar (exact-cell deletion).
 */
import { describe, it, expect } from 'vitest';
import { classifyToken, cellLabel, extractCells, tokenMatchesCell, type Cell } from '../variantCell';

describe('classifyToken', () => {
  it('base token → null', () => {
    expect(classifyToken('bg-stone-600')).toBeNull();
  });
  it('single state', () => {
    expect(classifyToken('hover:bg-red-500')).toEqual({ bp: 'xs', theme: 'light', state: 'hover' });
  });
  it('breakpoint + state', () => {
    expect(classifyToken('md:hover:bg-stone-600')).toEqual({ bp: 'md', theme: 'light', state: 'hover' });
  });
  it('is order-independent', () => {
    expect(classifyToken('hover:md:bg-red')).toEqual(classifyToken('md:hover:bg-red'));
  });
  it('dark theme', () => {
    expect(classifyToken('dark:text-white')).toEqual({ bp: 'xs', theme: 'dark', state: 'default' });
  });
  it('all three axes', () => {
    expect(classifyToken('md:dark:hover:bg-red')).toEqual({ bp: 'md', theme: 'dark', state: 'hover' });
  });
  it('unknown variant → null (skipped)', () => {
    expect(classifyToken('group-hover:bg-red')).toBeNull();
    expect(classifyToken('peer-focus:bg-red')).toBeNull();
  });
  it('arbitrary value containing ":" → null (no false variant split)', () => {
    expect(classifyToken('bg-[url(https://x.com/a.png)]')).toBeNull();
  });
  it('two states in one token → null', () => {
    expect(classifyToken('hover:focus:bg-red')).toBeNull();
  });
});

describe('cellLabel (canonical bp:theme:state, base parts omitted)', () => {
  it('md:hover', () => expect(cellLabel({ bp: 'md', theme: 'light', state: 'hover' })).toBe('md:hover'));
  it('dark', () => expect(cellLabel({ bp: 'xs', theme: 'dark', state: 'default' })).toBe('dark'));
  it('md:dark:hover', () => expect(cellLabel({ bp: 'md', theme: 'dark', state: 'hover' })).toBe('md:dark:hover'));
});

describe('extractCells', () => {
  it('returns distinct non-base cells, deduped by label', () => {
    const cells = extractCells('p-4 md:hover:bg-stone-600 dark:text-white md:hover:text-lg');
    expect(cells.map(cellLabel).sort()).toEqual(['dark', 'md:hover']);
  });
  it('empty string → []', () => expect(extractCells('')).toEqual([]));
});

describe('tokenMatchesCell (exact cell, for deletion)', () => {
  const cell: Cell = { bp: 'md', theme: 'light', state: 'hover' };
  it('exact match', () => expect(tokenMatchesCell('md:hover:bg-red', cell)).toBe(true));
  it('md: alone does NOT match md:hover', () => expect(tokenMatchesCell('md:bg-red', cell)).toBe(false));
  it('hover: alone does NOT match md:hover', () => expect(tokenMatchesCell('hover:bg-red', cell)).toBe(false));
});
