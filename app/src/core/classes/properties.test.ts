/**
 * Tests for property group classification.
 */

import { describe, it, expect } from 'vitest';
import { getPropertyGroup, samePropertyGroup } from './properties';

describe('getPropertyGroup', () => {
  describe('standalone groups', () => {
    it('should identify position classes', () => {
      expect(getPropertyGroup('relative')).toBe('standalone:position');
      expect(getPropertyGroup('absolute')).toBe('standalone:position');
      expect(getPropertyGroup('fixed')).toBe('standalone:position');
      expect(getPropertyGroup('sticky')).toBe('standalone:position');
    });

    it('should identify display classes', () => {
      expect(getPropertyGroup('flex')).toBe('standalone:display');
      expect(getPropertyGroup('grid')).toBe('standalone:display');
      expect(getPropertyGroup('hidden')).toBe('standalone:display');
      expect(getPropertyGroup('block')).toBe('standalone:display');
    });

    it('should identify font family classes separately from font weight', () => {
      expect(getPropertyGroup('font-sans')).toBe('standalone:fontFamily');
      expect(getPropertyGroup('font-serif')).toBe('standalone:fontFamily');
      expect(getPropertyGroup('font-mono')).toBe('standalone:fontFamily');
    });

    it('should identify font weight classes separately from font family', () => {
      expect(getPropertyGroup('font-bold')).toBe('standalone:fontWeight');
      expect(getPropertyGroup('font-semibold')).toBe('standalone:fontWeight');
      expect(getPropertyGroup('font-normal')).toBe('standalone:fontWeight');
    });

    it('should identify text size classes separately from text color', () => {
      expect(getPropertyGroup('text-sm')).toBe('standalone:textSize');
      expect(getPropertyGroup('text-lg')).toBe('standalone:textSize');
      expect(getPropertyGroup('text-2xl')).toBe('standalone:textSize');
    });

    it('should identify border width classes', () => {
      expect(getPropertyGroup('border')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-2')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-t-4')).toBe('standalone:borderWidthT');
    });
  });

  describe('arbitrary value patterns', () => {
    it('should identify arbitrary text sizes', () => {
      expect(getPropertyGroup('text-[18px]')).toBe('standalone:textSize');
      expect(getPropertyGroup('text-[1.5rem]')).toBe('standalone:textSize');
      expect(getPropertyGroup('text-[2em]')).toBe('standalone:textSize');
    });

    it('should identify arbitrary border widths with px units', () => {
      expect(getPropertyGroup('border-[3px]')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-t-[5px]')).toBe('standalone:borderWidthT');
      expect(getPropertyGroup('border-r-[2px]')).toBe('standalone:borderWidthR');
      expect(getPropertyGroup('border-b-[1px]')).toBe('standalone:borderWidthB');
      expect(getPropertyGroup('border-l-[4px]')).toBe('standalone:borderWidthL');
      expect(getPropertyGroup('border-x-[2px]')).toBe('standalone:borderWidthX');
      expect(getPropertyGroup('border-y-[3px]')).toBe('standalone:borderWidthY');
    });

    it('should identify arbitrary border widths with rem units', () => {
      expect(getPropertyGroup('border-[0.5rem]')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-[1rem]')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-t-[0.25rem]')).toBe('standalone:borderWidthT');
      expect(getPropertyGroup('border-r-[2rem]')).toBe('standalone:borderWidthR');
    });

    it('should identify arbitrary border widths with em units', () => {
      expect(getPropertyGroup('border-[1em]')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-[0.5em]')).toBe('standalone:borderWidth');
      expect(getPropertyGroup('border-t-[1.5em]')).toBe('standalone:borderWidthT');
    });

    it('should ensure border-[Xrem] and border-[Xpx] are same group (bug fix)', () => {
      // This was the original bug - border-[5rem] and border-[5px] got different groups
      const remGroup = getPropertyGroup('border-[5rem]');
      const pxGroup = getPropertyGroup('border-[5px]');
      expect(remGroup).toBe(pxGroup);
      expect(remGroup).toBe('standalone:borderWidth');
    });
  });

  describe('prefix-based groups', () => {
    it('should identify background color classes', () => {
      expect(getPropertyGroup('bg-red-500')).toBe('bg-');
      expect(getPropertyGroup('bg-blue-200')).toBe('bg-');
      expect(getPropertyGroup('bg-transparent')).toBe('bg-');
    });

    it('should identify text color classes (not text size)', () => {
      expect(getPropertyGroup('text-red-500')).toBe('text-');
      expect(getPropertyGroup('text-blue-200')).toBe('text-');
      expect(getPropertyGroup('text-white')).toBe('text-');
    });

    it('should identify padding classes', () => {
      expect(getPropertyGroup('p-4')).toBe('p-');
      expect(getPropertyGroup('px-2')).toBe('px-');
      expect(getPropertyGroup('py-8')).toBe('py-');
      expect(getPropertyGroup('pt-1')).toBe('pt-');
    });

    it('should identify margin classes including negative', () => {
      expect(getPropertyGroup('m-4')).toBe('m-');
      expect(getPropertyGroup('-m-4')).toBe('-m-');
      expect(getPropertyGroup('-mx-2')).toBe('-mx-');
    });

    it('should identify border color classes (not border width)', () => {
      expect(getPropertyGroup('border-red-500')).toBe('border-');
      expect(getPropertyGroup('border-blue-200')).toBe('border-');
    });
  });

  describe('unknown classes', () => {
    it('should return unique group for unknown classes', () => {
      // Use classes that don't start with any known prefix
      expect(getPropertyGroup('custom-utility')).toBe('unique:custom-utility');
      expect(getPropertyGroup('brand-primary')).toBe('unique:brand-primary');
    });
  });
});

describe('samePropertyGroup', () => {
  it('should return true for classes in the same standalone group', () => {
    expect(samePropertyGroup('flex', 'grid')).toBe(true);
    expect(samePropertyGroup('font-sans', 'font-mono')).toBe(true);
    expect(samePropertyGroup('font-bold', 'font-normal')).toBe(true);
  });

  it('should return false for classes in different standalone groups', () => {
    expect(samePropertyGroup('font-sans', 'font-bold')).toBe(false);
    expect(samePropertyGroup('text-sm', 'text-red-500')).toBe(false);
  });

  it('should return true for classes with same prefix', () => {
    expect(samePropertyGroup('bg-red-500', 'bg-blue-200')).toBe(true);
    expect(samePropertyGroup('p-4', 'p-8')).toBe(true);
  });

  it('should return true for arbitrary values in same group', () => {
    expect(samePropertyGroup('border-[5px]', 'border-[2rem]')).toBe(true);
    expect(samePropertyGroup('text-[18px]', 'text-[1.5rem]')).toBe(true);
  });
});

// task-107 pen tool: stroke WIDTH (stroke-2, stroke-[3px]) and stroke COLOR
// (stroke-gray-900) are different CSS properties. A single 'stroke-' group made
// getEffectiveClasses drop whichever token came first — the DesignBar showed
// "None" for a stroked path and any stroke edit silently killed the other axis.
describe('stroke width vs stroke color (task-107)', () => {
  it('classifies preset and arbitrary stroke widths as their own group', () => {
    expect(getPropertyGroup('stroke-2')).toBe('standalone:strokeWidth');
    expect(getPropertyGroup('stroke-0')).toBe('standalone:strokeWidth');
    expect(getPropertyGroup('stroke-[3px]')).toBe('standalone:strokeWidth');
    expect(getPropertyGroup('stroke-[1.5px]')).toBe('standalone:strokeWidth');
  });

  it('keeps stroke colors in the stroke- prefix group', () => {
    expect(getPropertyGroup('stroke-gray-900')).toBe('stroke-');
    expect(getPropertyGroup('stroke-none')).toBe('stroke-');
    expect(getPropertyGroup('stroke-[#ff0000]')).toBe('stroke-');
  });

  it('width and color never replace each other', () => {
    expect(samePropertyGroup('stroke-2', 'stroke-gray-900')).toBe(false);
    expect(samePropertyGroup('stroke-[3px]', 'stroke-red-500')).toBe(false);
    expect(samePropertyGroup('stroke-2', 'stroke-[3px]')).toBe(true);
  });
});
