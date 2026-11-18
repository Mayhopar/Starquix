/**
 * Bug Fix Tests: DesignBar/utils.ts
 *
 * Tests for:
 * - Bug #23: Utility functions crash on null/undefined input
 */
import { describe, it, expect } from 'vitest';
import {
  parseClasses,
  findClass,
  removeClasses,
  setClass,
  parseDimension,
  parseSpacing,
  parseNumericClass
} from '../utils';

describe('Bug #23: Utility functions should handle null/undefined input', () => {
  describe('parseClasses', () => {
    it('should return empty array for null input', () => {
      expect(parseClasses(null)).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      expect(parseClasses(undefined)).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      expect(parseClasses('')).toEqual([]);
    });

    it('should parse valid class string', () => {
      expect(parseClasses('p-4 m-2 bg-red-500')).toEqual(['p-4', 'm-2', 'bg-red-500']);
    });

    it('should handle multiple spaces between classes', () => {
      expect(parseClasses('p-4   m-2')).toEqual(['p-4', 'm-2']);
    });
  });

  describe('findClass', () => {
    it('should return undefined for null input', () => {
      expect(findClass(null, /^p-/)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(findClass(undefined, /^p-/)).toBeUndefined();
    });

    it('should find matching class', () => {
      expect(findClass('p-4 m-2 bg-red-500', /^p-/)).toBe('p-4');
    });

    it('should return undefined when no match', () => {
      expect(findClass('m-2 bg-red-500', /^p-/)).toBeUndefined();
    });
  });

  describe('removeClasses', () => {
    it('should return empty string for null input', () => {
      expect(removeClasses(null, /^p-/)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(removeClasses(undefined, /^p-/)).toBe('');
    });

    it('should remove matching classes', () => {
      // px-8 doesn't match /^p-/ because it's 'px-', not 'p-'
      expect(removeClasses('p-4 m-2 px-8 bg-red-500', /^p-/)).toBe('m-2 px-8 bg-red-500');
    });

    it('should return original classes when no match', () => {
      expect(removeClasses('m-2 bg-red-500', /^p-/)).toBe('m-2 bg-red-500');
    });
  });

  describe('setClass', () => {
    it('should handle null input and just add new class', () => {
      expect(setClass(null, /^p-/, 'p-4')).toBe('p-4');
    });

    it('should handle undefined input and just add new class', () => {
      expect(setClass(undefined, /^p-/, 'p-4')).toBe('p-4');
    });

    it('should return empty string when removing from null and newClass is null', () => {
      expect(setClass(null, /^p-/, null)).toBe('');
    });

    it('should replace matching class', () => {
      expect(setClass('p-2 m-4 bg-red-500', /^p-/, 'p-8')).toBe('m-4 bg-red-500 p-8');
    });

    it('should remove class when newClass is null', () => {
      expect(setClass('p-2 m-4 bg-red-500', /^p-/, null)).toBe('m-4 bg-red-500');
    });

    it('should add class when no match exists', () => {
      expect(setClass('m-4 bg-red-500', /^p-/, 'p-8')).toBe('m-4 bg-red-500 p-8');
    });
  });

  describe('parseDimension', () => {
    it('should return null value for null input', () => {
      const result = parseDimension(null, 'w');
      expect(result.value).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('should return null value for undefined input', () => {
      const result = parseDimension(undefined, 'w');
      expect(result.value).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('should parse width class', () => {
      const result = parseDimension('w-4 h-8', 'w');
      expect(result.value).toBe(16); // 4 * 4px
      expect(result.unit).toBe('px');
    });

    it('should parse arbitrary value', () => {
      const result = parseDimension('w-[100px]', 'w');
      expect(result.value).toBe(100);
      expect(result.unit).toBe('px');
    });

    it('should parse full width', () => {
      const result = parseDimension('w-full', 'w');
      expect(result.value).toBe(100);
      expect(result.unit).toBe('%');
    });
  });

  describe('parseSpacing', () => {
    it('should return null value for null input', () => {
      const result = parseSpacing(null, 'p', '');
      expect(result.value).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('should return null value for undefined input', () => {
      const result = parseSpacing(undefined, 'm', 't');
      expect(result.value).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('should parse padding class', () => {
      const result = parseSpacing('p-4 m-2', 'p', '');
      expect(result.value).toBe(16);
      expect(result.unit).toBe('px');
    });

    it('should parse margin-top with negative value', () => {
      const result = parseSpacing('-mt-4', 'm', 't');
      expect(result.value).toBe(-16);
      expect(result.unit).toBe('px');
    });

    it('should parse arbitrary viewport height', () => {
      const result = parseSpacing('pt-[16vh]', 'p', 't');
      expect(result.value).toBe(16);
      expect(result.unit).toBe('vh');
    });
  });

  describe('parseNumericClass', () => {
    it('should return null value for null input', () => {
      const result = parseNumericClass(null, 'opacity');
      expect(result.value).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('should return null value for undefined input', () => {
      const result = parseNumericClass(undefined, 'gap');
      expect(result.value).toBeNull();
      expect(result.raw).toBeNull();
    });

    it('should parse opacity class', () => {
      const result = parseNumericClass('opacity-50', 'opacity');
      expect(result.value).toBe(50);
    });

    it('should parse gap with scale', () => {
      const result = parseNumericClass('gap-4', 'gap', 4);
      expect(result.value).toBe(16); // 4 * 4
    });

    it('should parse arbitrary value', () => {
      const result = parseNumericClass('gap-[24px]', 'gap');
      expect(result.value).toBe(24);
    });
  });
});
