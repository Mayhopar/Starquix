/**
 * DesignBar Utilities
 *
 * Functions for parsing and updating Tailwind CSS classes.
 */

import { resolveSpacingClass, resolveToClass as resolveClass } from '@/core/classes/vocabulary';

// ============================================================================
// Class Manipulation
// ============================================================================

/**
 * Parse a class string into tokens
 */
export const parseClasses = (classes: string | null | undefined): string[] => {
  if (!classes) return [];
  return classes.split(/\s+/).filter(Boolean);
};

/**
 * Find a class matching a pattern
 */
export const findClass = (classes: string | null | undefined, pattern: RegExp): string | undefined => {
  return parseClasses(classes).find(cls => pattern.test(cls));
};

/**
 * Remove classes matching a pattern
 */
export const removeClasses = (classes: string | null | undefined, pattern: RegExp): string => {
  return parseClasses(classes)
    .filter(cls => !pattern.test(cls))
    .join(' ');
};

/**
 * Add or replace a class based on pattern
 */
export const setClass = (
  classes: string | null | undefined,
  pattern: RegExp,
  newClass: string | null
): string => {
  const tokens = parseClasses(classes).filter(cls => !pattern.test(cls));
  if (newClass) {
    tokens.push(newClass);
  }
  return tokens.join(' ');
};

// ============================================================================
// Value Parsing
// ============================================================================

/**
 * Parse a dimension value from a Tailwind class
 * Handles: w-4, w-px, w-full, w-[100px], w-1/2
 */
export const parseDimension = (
  classes: string | null | undefined,
  prefix: 'w' | 'h' | 'min-w' | 'min-h' | 'max-w' | 'max-h'
): { value: number | null; unit: string; raw: string | null } => {
  const pattern = new RegExp(`^${prefix}-(.+)$`);
  const token = findClass(classes, pattern);

  if (!token) {
    return { value: null, unit: 'px', raw: null };
  }

  const match = token.match(pattern);
  if (!match) return { value: null, unit: 'px', raw: token };

  const suffix = match[1];

  // Arbitrary value: w-[100px], w-[50%]
  const arbitrary = suffix.match(/^\[(.+)\]$/);
  if (arbitrary) {
    const inner = arbitrary[1];
    const numMatch = inner.match(/^(\d+(?:\.\d+)?)(px|rem|%|vh|vw)?$/);
    if (numMatch) {
      return {
        value: parseFloat(numMatch[1]),
        unit: numMatch[2] || 'px',
        raw: token
      };
    }
    return { value: null, unit: 'px', raw: token };
  }

  // Special values
  if (suffix === 'full') return { value: 100, unit: '%', raw: token };
  if (suffix === 'screen') return { value: 100, unit: 'vw', raw: token };
  if (suffix === 'auto') return { value: null, unit: 'auto', raw: token };
  if (suffix === 'px') return { value: 1, unit: 'px', raw: token };

  // Fraction values: w-1/2
  const fraction = suffix.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return {
      value: Math.round((parseInt(fraction[1]) / parseInt(fraction[2])) * 100),
      unit: '%',
      raw: token
    };
  }

  // Numeric scale: w-4 = 1rem = 16px
  const num = parseFloat(suffix);
  if (!isNaN(num)) {
    return { value: num * 4, unit: 'px', raw: token };
  }

  return { value: null, unit: 'px', raw: token };
};

/**
 * Create a dimension class
 * Uses vocabulary for clean Tailwind classes when possible
 */
export const createDimensionClass = (
  prefix: 'w' | 'h' | 'min-w' | 'min-h' | 'max-w' | 'max-h',
  value: number,
  unit: string
): string => {
  if (unit === '%' && value === 100) return `${prefix}-full`;
  if (unit === 'auto') return `${prefix}-auto`;

  // Use vocabulary resolver for optimized classes
  return resolveClass(prefix, value, unit);
};

/**
 * A utility token for `prefix` (a regex fragment: 'pt', 'p[tb]', 'top'), negative (`-mt-4`, `-top-2`)
 * and important (`!p-4`, Tailwind 3) included — they are the same property. Groups: sign, value.
 */
export const utilityPattern = (prefix: string): RegExp => new RegExp(`^!?(-?)${prefix}-(.+)$`);

/**
 * Parse spacing value (margin/padding)
 * Now supports all CSS units: px, %, vh, vw, rem, em, svh, dvh
 */
export const parseSpacing = (
  classes: string | null | undefined,
  type: 'm' | 'p',
  side: '' | 't' | 'r' | 'b' | 'l' | 'x' | 'y'
): { value: number | null; unit: string; raw: string | null } => {
  const pattern = utilityPattern(`${type}${side}`);
  const token = findClass(classes, pattern);

  if (!token) {
    return { value: null, unit: 'px', raw: null };
  }

  const match = token.match(pattern);
  if (!match) return { value: null, unit: 'px', raw: token };

  const isNegative = match[1] === '-';
  const suffix = match[2];

  // Arbitrary value: p-[20px], mt-[16vh], mb-[2rem], etc.
  // Supports: px, %, vh, vw, rem, em, svh, dvh, lvh
  const arbitrary = suffix.match(/^\[(\d+(?:\.\d+)?)(px|%|vh|vw|rem|em|svh|dvh|lvh)?\]$/);
  if (arbitrary) {
    const val = parseFloat(arbitrary[1]);
    const unit = arbitrary[2] || 'px';
    return { value: isNegative ? -val : val, unit, raw: token };
  }

  // Numeric scale: p-4 = 16px
  if (suffix === 'px') return { value: isNegative ? -1 : 1, unit: 'px', raw: token };

  const num = Number(suffix); // strict: a custom `px-2xs` is unread, not 2
  if (!isNaN(num)) {
    const val = num * 4;
    return { value: isNegative ? -val : val, unit: 'px', raw: token };
  }

  return { value: null, unit: 'px', raw: token };
};

/**
 * Create a spacing class
 * Uses vocabulary for clean Tailwind classes when possible
 * Supports all CSS units: px, %, vh, vw, rem, em
 */
export const createSpacingClass = (
  type: 'm' | 'p',
  side: '' | 't' | 'r' | 'b' | 'l' | 'x' | 'y',
  value: number,
  unit: string = 'px'
): string | null => {
  const prefix = `${type}${side}`;

  // Use vocabulary resolver for optimized classes
  return resolveSpacingClass(prefix, value, unit);
};

/**
 * Parse numeric value from class (e.g., opacity-50, gap-4, gap-[16px])
 */
export const parseNumericClass = (
  classes: string | null | undefined,
  prefix: string,
  scale: number = 1
): { value: number | null; raw: string | null } => {
  const pattern = new RegExp(`^${prefix}-(.+)$`);
  const token = findClass(classes, pattern);

  if (!token) {
    return { value: null, raw: null };
  }

  const match = token.match(pattern);
  if (!match) return { value: null, raw: token };

  const suffix = match[1];

  // Arbitrary value with optional unit: [16] or [16px] or [1.5rem]
  const arbitrary = suffix.match(/^\[(\d+(?:\.\d+)?)(px|rem|em|%)?\]$/);
  if (arbitrary) {
    return { value: parseFloat(arbitrary[1]), raw: token };
  }

  const num = parseFloat(suffix);
  if (!isNaN(num)) {
    return { value: num * scale, raw: token };
  }

  return { value: null, raw: token };
};

// ============================================================================
// Color Conversion (shared with CustomColorPicker)
// ============================================================================

/** `#rrggbb` from 0-255 RGB components. */
export const rgbToHex = (rgb: { r: number; g: number; b: number }): string => {
  const toHex = (n: number) => {
    const hex = Math.round(Math.max(0, Math.min(255, n))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
};

/**
 * Convert a computed CSS color (`rgb(r, g, b)` / `rgba(r, g, b, a)`, the
 * getComputedStyle serialization) to `#rrggbb`. Returns null for a fully
 * transparent color or anything unparseable — callers treat null as
 * "no usable inherited color" (task-094 B4).
 */
export function cssColorToHex(css: string | undefined): string | null {
  if (!css) return null;
  const m = css.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return rgbToHex({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) });
}

/**
 * Which component name the ↗ go-to-source event should carry. The LeftSidebar
 * handler prioritizes NAME over path — a deliberate hack for LEGACY drawn blog
 * slots whose astroSource points at BlogCard.astro. That override must apply
 * ONLY when the slot ITSELF is selected: a materialized child instance or a
 * post root carries an authoritative astroSource, and forcing 'BlogSlot' there
 * trapped the card's ↗ in a reopen-the-slot loop (isBlogSlot is true for EVERY
 * selection inside the BlogSlot master editor).
 */
export function goToSourceNameFor(args: {
  isPostRoot: boolean;
  postRootComponentName: string;
  isEditorChildInstance: boolean;
  isBlogSlot: boolean;
  blogSlotComponentType: string;
}): string | undefined {
  if (args.isPostRoot) return args.postRootComponentName;
  if (args.isEditorChildInstance) return undefined;
  if (args.isBlogSlot) return args.blogSlotComponentType;
  return undefined;
}
