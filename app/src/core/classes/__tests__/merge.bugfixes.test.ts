/**
 * Bug Fix Tests: merge.ts
 *
 * Tests for Bug #7: Colon in Tailwind arbitrary values breaks parsing
 */
import { describe, it, expect } from 'vitest';
import { getPropertySlot, mergeClasses } from '../merge';
import { getEffectiveClasses } from '../cascade';
import { parseClasses } from '../parser';

describe('Bug #7: Colon in Tailwind arbitrary values', () => {
  describe('getPropertySlot', () => {
    it('handles classes without colons', () => {
      expect(getPropertySlot('bg-red-500')).toBe('bg-');
      expect(getPropertySlot('text-white')).toBe('text-');
      expect(getPropertySlot('p-4')).toBe('p-');
    });

    it('handles responsive prefixes', () => {
      expect(getPropertySlot('md:bg-red-500')).toBe('md:bg-');
      expect(getPropertySlot('lg:text-white')).toBe('lg:text-');
      expect(getPropertySlot('xl:p-4')).toBe('xl:p-');
    });

    it('handles multiple modifiers', () => {
      expect(getPropertySlot('xl:dark:hover:bg-red-500')).toBe('xl:dark:hover:bg-');
    });

    // BUG FIX TEST: Colons inside arbitrary values should NOT be treated as modifier separators
    it('correctly handles colons inside arbitrary values (URL)', () => {
      const slot = getPropertySlot('bg-[url(data:image/svg+xml)]');
      // The colon in "data:image" should NOT be treated as a modifier separator
      // bg-[url()] is background-image, separate from bg- (background-color)
      expect(slot).toBe('standalone:bgImage');
      expect(slot).not.toContain('data:');
    });

    it('correctly handles colons inside arbitrary values with responsive prefix', () => {
      const slot = getPropertySlot('md:bg-[url(data:image/svg+xml)]');
      // Should extract 'md:' as prefix and 'standalone:bgImage' as the property group
      expect(slot).toBe('md:standalone:bgImage');
    });

    it('correctly handles calc expressions with colons', () => {
      // Some calc expressions might contain colons in CSS functions
      const slot = getPropertySlot('w-[calc(100%-8px)]');
      expect(slot).toBe('w-');
    });

    it('correctly handles content with quoted colons', () => {
      const slot = getPropertySlot("content-['Time:_12:30']");
      expect(slot).toBe('content-');
    });

    it('correctly handles gradient with colons', () => {
      const slot = getPropertySlot('bg-[linear-gradient(to_right,#fff,#000)]');
      expect(slot).toBe('bg-');
    });

    it('handles hover prefix with arbitrary value containing colon', () => {
      const slot = getPropertySlot('hover:bg-[url(data:image)]');
      expect(slot).toBe('hover:standalone:bgImage');
    });
  });

  describe('mergeClasses with arbitrary values', () => {
    it('bg-url does not clobber bg-color (different CSS properties)', () => {
      const result = mergeClasses(
        'bg-red-500',
        'bg-[url(data:image/svg+xml)]'
      );
      // bg-[url()] is background-image, bg-red-500 is background-color — different properties
      expect(result).toContain('bg-red-500');
      expect(result).toContain('bg-[url(data:image/svg+xml)]');
    });

    it('bg-url does not clobber responsive bg-color', () => {
      const result = mergeClasses(
        'md:bg-red-500',
        'md:bg-[url(data:image)]'
      );
      // Both should survive — different CSS properties
      expect(result).toContain('md:bg-red-500');
      expect(result).toContain('md:bg-[url(data:image)]');
    });

    it('bg-url coexists with bg-color and text-color', () => {
      const result = mergeClasses(
        'bg-red-500 text-white',
        'bg-[url(data:image)]'
      );
      expect(result).toContain('text-white');
      expect(result).toContain('bg-[url(data:image)]');
      // bg-red-500 should survive (different property: background-color vs background-image)
      expect(result).toContain('bg-red-500');
    });

    it('bg sub-properties do not clobber each other', () => {
      const result = mergeClasses(
        'bg-red-500 p-4',
        ["bg-[url('test.png')]", 'bg-cover', 'bg-center', 'bg-no-repeat']
      );
      // All bg sub-properties should survive
      expect(result).toContain("bg-[url('test.png')]");
      expect(result).toContain('bg-cover');
      expect(result).toContain('bg-center');
      expect(result).toContain('bg-no-repeat');
      expect(result).toContain('p-4');
    });
  });
});

// task-262: Tailwind 3.4 compiles text-[var(--x)] to `color`. The size slot
// claimed it, so a size edit deleted the colour and a colour pick deleted the size.
describe('task-262: text-[var(--x)] is a colour, not a size', () => {
  it('a size edit keeps the variable colour', () => {
    expect(mergeClasses('text-[var(--ink)] text-lg', 'text-2xl')).toBe('text-[var(--ink)] text-2xl');
  });

  it('a variable colour replaces the old colour and keeps the size', () => {
    expect(mergeClasses('text-lg text-gray-900', 'text-[var(--ink)]')).toBe('text-lg text-[var(--ink)]');
    expect(mergeClasses('text-lg text-gray-900', 'text-[color:var(--ink)]')).toBe('text-lg text-[color:var(--ink)]');
  });

  it('a hex colour replaces a variable colour', () => {
    expect(mergeClasses('text-[var(--ink)] text-lg', 'text-[#ff0000]')).toBe('text-[#ff0000] text-lg');
  });

  it('sizing functions and lengths stay in the size slot', () => {
    for (const size of ['text-[clamp(1rem,2vw,3rem)]', 'text-[calc(160vw/10)]', 'text-[18px]']) {
      expect(getPropertySlot(size)).toBe('standalone:textSize');
    }
  });
});

// task-263: same root as task-262. Tailwind 3.4 compiles border-[var(--x)] to
// `border-color`; the width slots claimed it, so a width edit deleted the colour.
describe('task-263: border-[var(--x)] is a colour, not a width', () => {
  it.each(['border', 'border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y'])('a %s width edit keeps the variable colour', (side) => {
    expect(mergeClasses(`${side} border-solid ${side}-[var(--line)]`, `${side}-2`)).toBe(`${side}-2 border-solid ${side}-[var(--line)]`);
  });

  it('lengths and sizing functions stay in the width slot', () => {
    expect(getPropertySlot('border-[3px]')).toBe('standalone:borderWidth');
    expect(getPropertySlot('border-[calc(1px+0.1vw)]')).toBe('standalone:borderWidth');
    expect(getPropertySlot('border-t-[3px]')).toBe('standalone:borderWidthT');
  });
});

// task-264: Tailwind 3.4 compiles font-[var(--x)] to `font-weight`; only the
// typed font-[family-name:var(--x)] is a family.
describe('task-264: a variable font family needs the family-name: hint', () => {
  it('font-[var(--x)] is not a font family: a font pick leaves it alone', () => {
    expect(getPropertySlot('font-[var(--heading)]')).not.toBe('standalone:fontFamily');
    expect(mergeClasses('font-[var(--weight)] font-sans', 'font-serif')).toBe('font-[var(--weight)] font-serif');
  });

  it('font-[family-name:var(--x)] is a family: a font pick replaces it', () => {
    expect(getPropertySlot('font-[family-name:var(--heading)]')).toBe('standalone:fontFamily');
    expect(mergeClasses('font-[family-name:var(--heading)] font-bold', 'font-serif')).toBe('font-serif font-bold');
  });

  it('a quoted stack is still a family, replaced cleanly by a font pick', () => {
    expect(getPropertySlot('font-["Inter","Arial"]')).toBe('standalone:fontFamily');
    expect(mergeClasses('font-["Inter","Arial"] font-bold', 'font-["Lora"]')).toBe('font-["Lora"] font-bold');
  });
});

// task-265: text-balance / text-pretty are text-wrap, but sat in the colour slot.
describe('task-265: text-wrap utilities have their own slot', () => {
  it('a colour edit keeps text-balance', () => {
    expect(mergeClasses('text-balance text-gray-900', 'text-red-500')).toBe('text-balance text-red-500');
  });

  it('they replace each other, and nothing else', () => {
    expect(mergeClasses('text-balance', 'text-pretty')).toBe('text-pretty');
    expect(mergeClasses('text-nowrap text-lg text-center text-gray-900', 'text-wrap')).toBe('text-wrap text-lg text-center text-gray-900');
  });

  // The Design panel edits the EFFECTIVE classes: a token the cascade drops is deleted by the next edit.
  it('the Design panel sees both the wrap and the colour of a balanced headline', () => {
    expect(getEffectiveClasses(parseClasses('text-balance text-gray-900'), 'xs', 'light', 'default')).toEqual(['text-balance', 'text-gray-900']);
  });
});

// An arbitrary weight (font-[650], font-[var(--x)], font-[number:…], font-[calc(…)]:
// each compiles to `font-weight` on the sites' Tailwind 3.4.19) sat in the catch-all
// font- slot, so a weight pick wrote a second weight class beside it (found live 2026-11-12).
describe('an arbitrary font weight shares the weight slot', () => {
  it('a weight pick replaces it, and it replaces a named weight', () => {
    expect(mergeClasses('font-[var(--heavy)] font-serif', 'font-light')).toBe('font-light font-serif');
    expect(mergeClasses('font-[650]', 'font-bold')).toBe('font-bold');
    expect(mergeClasses('font-bold', 'font-[number:var(--w)]')).toBe('font-[number:var(--w)]');
    expect(mergeClasses('font-[calc(var(--w)+100)]', 'font-thin')).toBe('font-thin');
  });

  it('a family is not a weight', () => {
    expect(mergeClasses('font-["Inter"] font-[650]', 'font-bold')).toBe('font-["Inter"] font-bold');
    expect(mergeClasses('font-[family-name:var(--h)] font-[var(--w)]', 'font-serif')).toBe('font-serif font-[var(--w)]');
  });
});

// An unquoted family (font-[Inter], font-[system-ui], font-[Inter,sans-serif]: each
// compiles to `font-family` on the sites' Tailwind 3.4.19) sat in the catch-all font-
// slot, so a font pick wrote a second family beside it (found live 2026-11-12).
describe('an unquoted arbitrary font family shares the family slot', () => {
  it('a font pick replaces it', () => {
    expect(mergeClasses('font-[Inter] font-bold', 'font-serif')).toBe('font-serif font-bold');
    expect(mergeClasses('font-[system-ui]', 'font-["Lora"]')).toBe('font-["Lora"]');
    expect(mergeClasses('font-[Inter,sans-serif] font-[650]', 'font-mono')).toBe('font-mono font-[650]');
  });

  it('a weight pick leaves it', () => {
    expect(mergeClasses('font-[Inter] font-[650]', 'font-bold')).toBe('font-[Inter] font-bold');
  });
});
