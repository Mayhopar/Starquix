/**
 * DesignBar Block Tests
 *
 * Phase 5 tests covering class manipulation logic for:
 * - FillBlock: background colors, gradients, images
 * - SpacingBlock: padding and margin with axis optimization
 *
 * Tests utility functions rather than rendering components to avoid
 * jsdom issues with SVG data URLs in CSS.
 */
import { describe, it, expect } from 'vitest';
import { findClass, setClass, removeClasses, parseSpacing, createSpacingClass } from '../utils';
import { parseObjectFit, parseObjectPosition, setObjectFit, setObjectPosition } from '../blocks/ImageBlock';
import { shouldShowFillSection } from '../ElementDesignPanel';
import { optimizeSpacingClasses, type FourSides } from '@/core/classes/vocabulary';

// ==============================================================
// task-141: Fill section gate — resolved media keeps Fill in local mode
// ==============================================================

describe('shouldShowFillSection', () => {
  it('always shows Fill for non-img elements', () => {
    expect(shouldShowFillSection({ isImageElement: false, isLocalProject: false, hasSourceLocation: false, tagName: 'div' })).toBe(true);
  });

  it('shows Fill for a local-mode source img (resolved media surface)', () => {
    expect(shouldShowFillSection({ isImageElement: true, isLocalProject: true, hasSourceLocation: true, tagName: 'img' })).toBe(true);
  });

  // task-144: unified surface — Fill's Media tab is THE image surface in
  // EVERY runtime; the legacy ImageBlock UI is retired.
  it('shows Fill for img outside local mode too (unified Media surface)', () => {
    expect(shouldShowFillSection({ isImageElement: true, isLocalProject: false, hasSourceLocation: true, tagName: 'img' })).toBe(true);
    expect(shouldShowFillSection({ isImageElement: true, isLocalProject: false, hasSourceLocation: false, tagName: 'img', hasBoundAsset: true })).toBe(true);
  });

  // task-142: local mode — Fill is the ONE image surface for EVERY img
  // (resolved / bound-asset / prop-driven note). Legacy Image block is dead.
  it('shows Fill for every local-mode img, with or without a handle', () => {
    expect(shouldShowFillSection({ isImageElement: true, isLocalProject: true, hasSourceLocation: false, tagName: 'img', hasBoundAsset: true })).toBe(true);
    expect(shouldShowFillSection({ isImageElement: true, isLocalProject: true, hasSourceLocation: false, tagName: 'img' })).toBe(true);
  });
});

// ==============================================================
// FillBlock Utility Tests
// ==============================================================

describe('FillBlock Class Utilities', () => {
  // =====================================================
  // Background Color Detection
  // =====================================================
  describe('Background Color Detection', () => {
    it('should find named background color class', () => {
      const classes = 'flex gap-4 bg-blue-500 text-white';
      const colorClass = findClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/);
      expect(colorClass).toBe('bg-blue-500');
    });

    it('should find arbitrary hex background color', () => {
      const classes = 'flex gap-4 bg-[#ff0000]';
      const colorClass = findClass(classes, /^bg-\[#[0-9a-fA-F]+\]$/);
      expect(colorClass).toBe('bg-[#ff0000]');
    });

    it('should find background color with opacity', () => {
      const classes = 'bg-blue-500/50 text-white';
      const colorClass = findClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/);
      expect(colorClass).toBe('bg-blue-500/50');
    });

    it('should return undefined for no background color', () => {
      const classes = 'flex gap-4 text-blue-500';
      const colorClass = findClass(classes, /^bg-[a-z]+-\d+$/);
      expect(colorClass).toBeUndefined();
    });
  });

  // =====================================================
  // Gradient Detection
  // =====================================================
  describe('Gradient Detection', () => {
    it('should find gradient direction class', () => {
      const classes = 'bg-gradient-to-r from-blue-500 to-purple-500';
      const dirClass = findClass(classes, /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/);
      expect(dirClass).toBe('bg-gradient-to-r');
    });

    it('should find from color class', () => {
      const classes = 'bg-gradient-to-r from-red-500 to-blue-500';
      const fromClass = findClass(classes, /^from-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/);
      expect(fromClass).toBe('from-red-500');
    });

    it('should find via color class', () => {
      const classes = 'bg-gradient-to-b from-red-500 via-purple-500 to-blue-500';
      const viaClass = findClass(classes, /^via-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/);
      expect(viaClass).toBe('via-purple-500');
    });

    it('should find to color class', () => {
      const classes = 'bg-gradient-to-r from-blue-500 to-green-500';
      const toClass = findClass(classes, /^to-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/);
      expect(toClass).toBe('to-green-500');
    });

    it('should find arbitrary hex gradient colors', () => {
      const classes = 'bg-gradient-to-r from-[#ff0000] to-[#0000ff]';
      const fromHex = findClass(classes, /^from-\[#[0-9a-fA-F]+\]$/);
      const toHex = findClass(classes, /^to-\[#[0-9a-fA-F]+\]$/);
      expect(fromHex).toBe('from-[#ff0000]');
      expect(toHex).toBe('to-[#0000ff]');
    });
  });

  // =====================================================
  // Image Detection
  // =====================================================
  describe('Image Detection', () => {
    it('should find background image URL', () => {
      const classes = "bg-[url('https://example.com/image.jpg')] bg-cover";
      const urlClass = findClass(classes, /^bg-\[url\(.+\)\]$/);
      expect(urlClass).toBe("bg-[url('https://example.com/image.jpg')]");
    });

    it('should find background size class', () => {
      const classes = "bg-[url('test.jpg')] bg-cover bg-center";
      const sizeClass = findClass(classes, /^bg-(cover|contain|auto)$/);
      expect(sizeClass).toBe('bg-cover');
    });

    it('should find background position class', () => {
      const classes = "bg-[url('test.jpg')] bg-cover bg-top";
      const posClass = findClass(classes, /^bg-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/);
      expect(posClass).toBe('bg-top');
    });

    it('should find background repeat class', () => {
      const classes = "bg-[url('test.jpg')] bg-no-repeat";
      const repeatClass = findClass(classes, /^bg-(repeat|no-repeat|repeat-x|repeat-y)$/);
      expect(repeatClass).toBe('bg-no-repeat');
    });
  });

  // =====================================================
  // Class Manipulation - Solid Color
  // =====================================================
  describe('Solid Color Class Manipulation', () => {
    it('should add background color to empty classes', () => {
      let classes = '';
      classes = classes + ' bg-red-500';
      expect(classes.trim()).toBe('bg-red-500');
    });

    it('should replace existing background color', () => {
      let classes = 'flex bg-blue-500 gap-4';
      classes = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
      classes = classes + ' bg-red-500';
      expect(classes.trim()).toBe('flex gap-4 bg-red-500');
    });

    it('should remove background color', () => {
      let classes = 'flex bg-blue-500 gap-4';
      classes = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?(\/\d+)?$/, null);
      expect(classes.trim()).toBe('flex gap-4');
    });

    it('should preserve text color when changing background', () => {
      let classes = 'text-white bg-blue-500';
      classes = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = classes + ' bg-red-500';
      expect(classes).toContain('text-white');
      expect(classes).toContain('bg-red-500');
    });
  });

  // =====================================================
  // Class Manipulation - Gradient
  // =====================================================
  describe('Gradient Class Manipulation', () => {
    it('should clear solid color when setting gradient', () => {
      let classes = 'bg-blue-500 text-white';
      classes = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = classes + ' bg-gradient-to-r from-red-500 to-blue-500';
      expect(classes).not.toContain('bg-blue-500');
      expect(classes).toContain('bg-gradient-to-r');
    });

    it('should clear gradient when setting solid color', () => {
      let classes = 'bg-gradient-to-r from-blue-500 to-purple-500';
      classes = setClass(classes, /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/, null);
      classes = setClass(classes, /^from-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = setClass(classes, /^via-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = setClass(classes, /^to-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = classes + ' bg-red-500';
      expect(classes).not.toContain('bg-gradient');
      expect(classes).not.toContain('from-');
      expect(classes).not.toContain('to-');
      expect(classes).toContain('bg-red-500');
    });
  });

  // =====================================================
  // Slot Isolation
  // =====================================================
  describe('Slot Isolation', () => {
    it('should not affect text color when changing background', () => {
      const original = 'text-blue-500 font-bold p-4 bg-red-500';
      let classes = setClass(original, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = classes + ' bg-green-500';
      expect(classes).toContain('text-blue-500');
      expect(classes).toContain('font-bold');
      expect(classes).toContain('p-4');
      expect(classes).toContain('bg-green-500');
    });

    it('should not affect padding when changing background', () => {
      const original = 'p-4 m-2 bg-blue-500';
      let classes = setClass(original, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
      classes = classes + ' bg-red-500';
      expect(classes).toContain('p-4');
      expect(classes).toContain('m-2');
    });
  });
});

// ==============================================================
// SpacingBlock Utility Tests
// ==============================================================

describe('SpacingBlock Class Utilities', () => {
  // =====================================================
  // Padding Parsing
  // =====================================================
  describe('Padding Parsing', () => {
    it('should parse individual padding (pt-4)', () => {
      const result = parseSpacing('pt-4', 'p', 't');
      expect(result.value).toBe(16);
      expect(result.unit).toBe('px');
    });

    it('should parse axis padding (px-4)', () => {
      const result = parseSpacing('px-4', 'p', 'x');
      expect(result.value).toBe(16);
    });

    it('should parse shorthand padding (p-4)', () => {
      const result = parseSpacing('p-4', 'p', '');
      expect(result.value).toBe(16);
    });

    it('should parse arbitrary padding (p-[20px])', () => {
      const result = parseSpacing('p-[20px]', 'p', '');
      expect(result.value).toBe(20);
      expect(result.unit).toBe('px');
    });

    it('should parse percentage padding (p-[10%])', () => {
      const result = parseSpacing('p-[10%]', 'p', '');
      expect(result.value).toBe(10);
      expect(result.unit).toBe('%');
    });

    it('should parse rem padding (p-[1rem])', () => {
      const result = parseSpacing('p-[1rem]', 'p', '');
      expect(result.value).toBe(1);
      expect(result.unit).toBe('rem');
    });
  });

  // =====================================================
  // Margin Parsing
  // =====================================================
  describe('Margin Parsing', () => {
    it('should parse individual margin (mt-4)', () => {
      const result = parseSpacing('mt-4', 'm', 't');
      expect(result.value).toBe(16);
    });

    it('should parse axis margin (mx-4)', () => {
      const result = parseSpacing('mx-4', 'm', 'x');
      expect(result.value).toBe(16);
    });

    it('should parse negative margin (-mt-4)', () => {
      const result = parseSpacing('-mt-4', 'm', 't');
      expect(result.value).toBe(-16);
    });

    it('should detect auto margin (mx-auto)', () => {
      const classes = 'mx-auto';
      const autoClass = findClass(classes, /^mx-auto$/);
      expect(autoClass).toBe('mx-auto');
    });

    it('should detect individual auto margin (ml-auto)', () => {
      const classes = 'ml-auto';
      const autoClass = findClass(classes, /^ml-auto$/);
      expect(autoClass).toBe('ml-auto');
    });
  });

  // =====================================================
  // Class Generation
  // =====================================================
  describe('Class Generation', () => {
    it('should generate padding class (pt-4)', () => {
      const result = createSpacingClass('p', 't', 16, 'px');
      expect(result).toBe('pt-4');
    });

    it('should generate axis padding class (px-4)', () => {
      const result = createSpacingClass('p', 'x', 16, 'px');
      expect(result).toBe('px-4');
    });

    it('should generate shorthand padding class (p-4)', () => {
      const result = createSpacingClass('p', '', 16, 'px');
      expect(result).toBe('p-4');
    });

    it('should generate optimized padding class for scale value (pt-5)', () => {
      // 20px = scale 5 (20/4), so it uses clean class instead of arbitrary
      const result = createSpacingClass('p', 't', 20, 'px');
      expect(result).toBe('pt-5');
    });

    it('should generate arbitrary padding class for non-scale value (pt-[13px])', () => {
      // 13px is not on the scale, so it uses arbitrary value
      const result = createSpacingClass('p', 't', 13, 'px');
      expect(result).toBe('pt-[13px]');
    });

    it('should generate percentage padding class (p-[10%])', () => {
      const result = createSpacingClass('p', '', 10, '%');
      expect(result).toBe('p-[10%]');
    });

    it('should generate margin class (mt-4)', () => {
      const result = createSpacingClass('m', 't', 16, 'px');
      expect(result).toBe('mt-4');
    });

    it('should generate negative margin class (-mt-4)', () => {
      const result = createSpacingClass('m', 't', -16, 'px');
      expect(result).toBe('-mt-4');
    });
  });

  // =====================================================
  // Axis Optimization
  // =====================================================
  describe('Axis Optimization', () => {
    it('should optimize to px when left=right', () => {
      const fourSides: FourSides = {
        top: { value: 16, unit: 'px' },
        right: { value: 8, unit: 'px' },
        bottom: { value: 16, unit: 'px' },
        left: { value: 8, unit: 'px' },
      };
      const result = optimizeSpacingClasses('p', fourSides);
      expect(result).toContain('py-4');
      expect(result).toContain('px-2');
    });

    it('should optimize to py when top=bottom', () => {
      const fourSides: FourSides = {
        top: { value: 16, unit: 'px' },
        right: { value: 4, unit: 'px' },
        bottom: { value: 16, unit: 'px' },
        left: { value: 8, unit: 'px' },
      };
      const result = optimizeSpacingClasses('p', fourSides);
      expect(result).toContain('py-4');
    });

    it('should optimize to shorthand when all sides equal', () => {
      const fourSides: FourSides = {
        top: { value: 16, unit: 'px' },
        right: { value: 16, unit: 'px' },
        bottom: { value: 16, unit: 'px' },
        left: { value: 16, unit: 'px' },
      };
      const result = optimizeSpacingClasses('p', fourSides);
      expect(result).toEqual(['p-4']);
    });

    it('should output individual classes when all different', () => {
      const fourSides: FourSides = {
        top: { value: 4, unit: 'px' },
        right: { value: 8, unit: 'px' },
        bottom: { value: 12, unit: 'px' },
        left: { value: 16, unit: 'px' },
      };
      const result = optimizeSpacingClasses('p', fourSides);
      expect(result).toContain('pt-1');
      expect(result).toContain('pr-2');
      expect(result).toContain('pb-3');
      expect(result).toContain('pl-4');
    });
  });

  // =====================================================
  // Class Manipulation
  // =====================================================
  describe('Class Manipulation', () => {
    it('should replace padding class', () => {
      let classes = 'pt-2 text-blue-500';
      classes = setClass(classes, /^pt-/, null);
      classes = classes + ' pt-4';
      expect(classes).not.toContain('pt-2');
      expect(classes).toContain('pt-4');
      expect(classes).toContain('text-blue-500');
    });

    it('should remove all padding classes', () => {
      let classes = 'pt-2 pr-4 pb-2 pl-4 text-blue-500';
      classes = setClass(classes, /^pt-/, null);
      classes = setClass(classes, /^pr-/, null);
      classes = setClass(classes, /^pb-/, null);
      classes = setClass(classes, /^pl-/, null);
      expect(classes).not.toContain('pt-');
      expect(classes).not.toContain('pr-');
      expect(classes).not.toContain('pb-');
      expect(classes).not.toContain('pl-');
      expect(classes).toContain('text-blue-500');
    });

    it('should replace axis padding classes', () => {
      let classes = 'px-4 py-2';
      classes = setClass(classes, /^px-/, null);
      classes = classes + ' px-8';
      expect(classes).not.toContain('px-4');
      expect(classes).toContain('px-8');
      expect(classes).toContain('py-2');
    });
  });

  // =====================================================
  // Slot Isolation
  // =====================================================
  describe('Slot Isolation', () => {
    it('should not affect text color when changing padding', () => {
      const original = 'text-blue-500 font-bold p-4 bg-white';
      let classes = setClass(original, /^p-\d+$/, null);
      classes = classes + ' p-8';
      expect(classes).toContain('text-blue-500');
      expect(classes).toContain('font-bold');
      expect(classes).toContain('bg-white');
      expect(classes).toContain('p-8');
    });

    it('should not affect background when changing margin', () => {
      const original = 'bg-blue-500 m-2 text-white';
      let classes = setClass(original, /^m-\d+$/, null);
      classes = classes + ' m-4';
      expect(classes).toContain('bg-blue-500');
      expect(classes).toContain('text-white');
      expect(classes).toContain('m-4');
    });

    it('should preserve multiple class types', () => {
      const original = 'text-lg font-bold text-blue-500 bg-white p-4 m-2 rounded-lg shadow-md';
      let classes = setClass(original, /^p-\d+$/, null);
      classes = classes + ' p-8';
      expect(classes).toContain('text-lg');
      expect(classes).toContain('font-bold');
      expect(classes).toContain('text-blue-500');
      expect(classes).toContain('bg-white');
      expect(classes).toContain('m-2');
      expect(classes).toContain('rounded-lg');
      expect(classes).toContain('shadow-md');
      expect(classes).toContain('p-8');
    });
  });
});

// ==============================================================
// findClass/setClass/removeClasses Tests
// ==============================================================

describe('Class Utility Functions', () => {
  describe('findClass', () => {
    it('should find matching class', () => {
      expect(findClass('flex gap-4 bg-blue-500', /^bg-/)).toBe('bg-blue-500');
    });

    it('should return undefined when no match', () => {
      expect(findClass('flex gap-4', /^bg-/)).toBeUndefined();
    });

    it('should find first matching class', () => {
      expect(findClass('bg-blue-500 bg-red-500', /^bg-/)).toBe('bg-blue-500');
    });
  });

  describe('setClass', () => {
    it('should remove matching classes', () => {
      const result = setClass('flex bg-blue-500 gap-4', /^bg-/, null);
      expect(result).toBe('flex gap-4');
    });

    it('should replace matching class with new value at end', () => {
      const result = setClass('flex bg-blue-500 gap-4', /^bg-/, 'bg-red-500');
      expect(result).toBe('flex gap-4 bg-red-500');
    });

    it('should handle no matches', () => {
      const result = setClass('flex gap-4', /^bg-/, null);
      expect(result).toBe('flex gap-4');
    });

    it('should add class to empty string when pattern does not match', () => {
      const result = setClass('', /^bg-/, 'bg-blue-500');
      expect(result).toBe('bg-blue-500');
    });
  });

  describe('removeClasses', () => {
    it('should remove classes matching pattern', () => {
      const result = removeClasses('flex gap-4 bg-blue-500', /^bg-/);
      expect(result).toBe('flex gap-4');
    });

    it('should remove multiple classes matching pattern', () => {
      const result = removeClasses('flex gap-4 bg-blue-500 bg-red-500', /^bg-/);
      expect(result).toBe('flex gap-4');
    });

    it('should handle pattern with no matches', () => {
      const result = removeClasses('flex gap-4', /^bg-/);
      expect(result).toBe('flex gap-4');
    });

    it('should remove all gradient classes with complex pattern', () => {
      const result = removeClasses('bg-gradient-to-r from-blue-500 to-red-500 flex', /^(bg-gradient|from-|to-|via-)/);
      expect(result).toBe('flex');
    });

    it('should remove all padding classes', () => {
      const result = removeClasses('flex p-4 pt-2 pb-8 gap-4', /^p[tblrxy]?-/);
      expect(result).toBe('flex gap-4');
    });
  });
});

// ==============================================================
// Cross-Slot Isolation Tests
// ==============================================================

describe('Cross-Slot Isolation', () => {
  it('should preserve font size when changing text color', () => {
    const original = 'text-lg text-blue-500';
    let classes = setClass(original, /^text-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
    classes = classes + ' text-red-500';
    expect(classes).toContain('text-lg');
    expect(classes).toContain('text-red-500');
    expect(classes).not.toContain('text-blue-500');
  });

  it('should preserve text color when changing font size', () => {
    const original = 'text-lg text-blue-500';
    let classes = setClass(original, /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/, null);
    classes = classes + ' text-2xl';
    expect(classes).toContain('text-blue-500');
    expect(classes).toContain('text-2xl');
    expect(classes).not.toContain('text-lg');
  });

  it('should preserve background when changing text color', () => {
    const original = 'bg-white text-blue-500 p-4';
    let classes = setClass(original, /^text-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
    classes = classes + ' text-red-500';
    expect(classes).toContain('bg-white');
    expect(classes).toContain('p-4');
    expect(classes).toContain('text-red-500');
  });

  it('should preserve all unrelated classes during complex edits', () => {
    const original = 'text-lg font-bold text-blue-500 bg-white p-4 m-2 rounded-lg shadow-md hover:bg-gray-100';

    // Change text size
    let classes = setClass(original, /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/, null);
    classes = classes + ' text-2xl';

    // Change background
    classes = setClass(classes, /^bg-(transparent|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d+)?$/, null);
    classes = classes + ' bg-gray-100';

    // Change padding
    classes = setClass(classes, /^p-\d+$/, null);
    classes = classes + ' p-8';

    // Verify all preserved classes
    expect(classes).toContain('font-bold');
    expect(classes).toContain('text-blue-500'); // text color preserved
    expect(classes).toContain('m-2');
    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('shadow-md');
    expect(classes).toContain('hover:bg-gray-100'); // hover state preserved

    // Verify changed classes
    expect(classes).toContain('text-2xl');
    expect(classes).toContain('bg-gray-100');
    expect(classes).toContain('p-8');

    // Verify old values removed
    expect(classes).not.toContain('text-lg');
    expect(classes).not.toContain('bg-white');
    expect(classes).not.toContain('p-4');
  });
});

// ==============================================================
// ImageBlock object-fit / object-position (task-124)
// ==============================================================

describe('ImageBlock object-* Class Utilities', () => {
  it('parses object-fit class', () => {
    expect(parseObjectFit('w-full object-cover rounded')).toBe('cover');
    expect(parseObjectFit('w-full rounded')).toBe('');
    expect(parseObjectFit('object-scale-down')).toBe('scale-down');
  });

  it('parses object-position class (corner classes report UI value)', () => {
    expect(parseObjectPosition('object-cover object-center')).toBe('center');
    expect(parseObjectPosition('object-left-top')).toBe('top-left');
    expect(parseObjectPosition('object-right-bottom')).toBe('bottom-right');
    expect(parseObjectPosition('w-full')).toBe('');
  });

  it('setObjectFit replaces existing fit and preserves other classes', () => {
    expect(setObjectFit('w-full object-contain rounded', 'cover')).toBe('w-full rounded object-cover');
    expect(setObjectFit('w-full', 'fill')).toBe('w-full object-fill');
  });

  it('setObjectPosition writes tailwind corner order and replaces existing', () => {
    expect(setObjectPosition('object-cover object-center', 'top-left')).toBe('object-cover object-left-top');
    expect(setObjectPosition('w-full', 'bottom-right')).toBe('w-full object-right-bottom');
    expect(setObjectPosition('w-full', '')).toBe('w-full object-center');
  });

  it('does not touch object-fit when setting position (independent regexes)', () => {
    expect(setObjectPosition('object-cover', 'top')).toBe('object-cover object-top');
    expect(setObjectFit('object-top', 'cover')).toBe('object-top object-cover');
  });
});
