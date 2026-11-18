/**
 * Tailwind Class Vocabulary System
 *
 * Central vocabulary for all Tailwind scales and class optimization.
 * Reads everything (backwards compatible parsing), writes clean (optimized classes).
 *
 * Design decisions:
 * - v4 dynamic: Any value divisible by 4px → clean class
 * - v3 fixed: Only predefined scale values
 * - Unit conversion: px, rem, em → canonical px (1rem = 16px)
 * - Relative units (%, vh, vw) → always arbitrary syntax
 * - Color matching: Exact hex match only (no nearest color)
 */

// ============================================================================
// Types
// ============================================================================

export type TailwindVersion = 'v3' | 'v4-cdn' | 'v4-build' | 'unknown';

export interface SpacingValue {
  value: number;
  unit: string;
}

export interface FourSides {
  top: SpacingValue;
  right: SpacingValue;
  bottom: SpacingValue;
  left: SpacingValue;
}

// ============================================================================
// Scale Definitions
// ============================================================================

/**
 * v3 Fixed Spacing Scale (in Tailwind units, multiply by 4 for pixels)
 * These are the only valid spacing values in Tailwind v3
 */
export const V3_SPACING_SCALE = new Set([
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96
]);

/**
 * v3 Spacing Scale in pixels (V3_SPACING_SCALE × 4)
 */
export const V3_SPACING_SCALE_PX = new Set([
  0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48,
  56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 384
]);

/**
 * Fractional spacing values that map to specific Tailwind units
 * Value in px → Tailwind unit
 */
export const FRACTIONAL_SPACING: Map<number, string> = new Map([
  [2, '0.5'],
  [6, '1.5'],
  [10, '2.5'],
  [14, '3.5'],
]);

/**
 * Font size scale: px value → Tailwind class suffix
 */
export const FONT_SIZE_SCALE: Map<number, string> = new Map([
  [12, 'xs'],
  [14, 'sm'],
  [16, 'base'],
  [18, 'lg'],
  [20, 'xl'],
  [24, '2xl'],
  [30, '3xl'],
  [36, '4xl'],
  [48, '5xl'],
  [60, '6xl'],
  [72, '7xl'],
  [96, '8xl'],
  [128, '9xl'],
]);

/**
 * Border radius scale: px value → Tailwind class suffix
 * Note: 'DEFAULT' (4px) is used for `rounded` without suffix
 */
export const BORDER_RADIUS_SCALE: Map<number, string> = new Map([
  [0, 'none'],
  [2, 'sm'],
  [4, 'DEFAULT'],
  [6, 'md'],
  [8, 'lg'],
  [12, 'xl'],
  [16, '2xl'],
  [24, '3xl'],
  [32, '4xl'],
  [9999, 'full'],
]);

/**
 * Border width scale: px value → Tailwind class suffix
 * Note: 1px is 'DEFAULT' (just `border` without width suffix)
 */
export const BORDER_WIDTH_SCALE: Map<number, string> = new Map([
  [0, '0'],
  [1, 'DEFAULT'],
  [2, '2'],
  [4, '4'],
  [8, '8'],
]);

/**
 * Opacity scale: percentage value → Tailwind class suffix
 */
export const OPACITY_SCALE: Map<number, string> = new Map([
  [0, '0'],
  [5, '5'],
  [10, '10'],
  [15, '15'],
  [20, '20'],
  [25, '25'],
  [30, '30'],
  [35, '35'],
  [40, '40'],
  [45, '45'],
  [50, '50'],
  [55, '55'],
  [60, '60'],
  [65, '65'],
  [70, '70'],
  [75, '75'],
  [80, '80'],
  [85, '85'],
  [90, '90'],
  [95, '95'],
  [100, '100'],
]);

/**
 * Z-index scale: numeric value → Tailwind class suffix
 */
export const Z_INDEX_SCALE: Map<number | string, string> = new Map<number | string, string>([
  [0, '0'],
  [10, '10'],
  [20, '20'],
  [30, '30'],
  [40, '40'],
  [50, '50'],
  ['auto', 'auto'],
]);

/**
 * Blur scale: px value → Tailwind class suffix
 */
export const BLUR_SCALE: Map<number, string> = new Map([
  [0, 'none'],
  [4, 'sm'],
  [8, 'DEFAULT'],
  [12, 'md'],
  [16, 'lg'],
  [24, 'xl'],
  [40, '2xl'],
  [64, '3xl'],
]);

/**
 * Transition duration scale: ms value → Tailwind class suffix
 */
export const DURATION_SCALE: Map<number, string> = new Map([
  [0, '0'],
  [75, '75'],
  [100, '100'],
  [150, '150'],
  [200, '200'],
  [300, '300'],
  [500, '500'],
  [700, '700'],
  [1000, '1000'],
]);

/**
 * Tailwind CSS Color Families: family name → ordered shades with hex values.
 *
 * Source of truth for {@link COLOR_MAP}. All 244 default Tailwind colors
 * (22 families × 11 shades + black + white) live here.
 *
 * IMPORTANT: A few hex values appear in more than one family (notably
 * `#fafafa`, which is BOTH `zinc-50` and `neutral-50`). The reverse lookup
 * in {@link COLOR_MAP} can therefore only return one token per hex, so the
 * winner is decided deterministically by {@link COLOR_FAMILY_PRIORITY}
 * below — NOT by the insertion order of this object.
 */
export const COLOR_FAMILIES: Record<string, ReadonlyArray<readonly [string, string]>> = {
  // Black & White (special-cased: single shade, no numeric suffix)
  base: [
    ['#000000', 'black'],
    ['#ffffff', 'white'],
  ],

  slate: [
    ['#f8fafc', 'slate-50'],
    ['#f1f5f9', 'slate-100'],
    ['#e2e8f0', 'slate-200'],
    ['#cbd5e1', 'slate-300'],
    ['#94a3b8', 'slate-400'],
    ['#64748b', 'slate-500'],
    ['#475569', 'slate-600'],
    ['#334155', 'slate-700'],
    ['#1e293b', 'slate-800'],
    ['#0f172a', 'slate-900'],
    ['#020617', 'slate-950'],
  ],

  gray: [
    ['#f9fafb', 'gray-50'],
    ['#f3f4f6', 'gray-100'],
    ['#e5e7eb', 'gray-200'],
    ['#d1d5db', 'gray-300'],
    ['#9ca3af', 'gray-400'],
    ['#6b7280', 'gray-500'],
    ['#4b5563', 'gray-600'],
    ['#374151', 'gray-700'],
    ['#1f2937', 'gray-800'],
    ['#111827', 'gray-900'],
    ['#030712', 'gray-950'],
  ],

  zinc: [
    ['#fafafa', 'zinc-50'],
    ['#f4f4f5', 'zinc-100'],
    ['#e4e4e7', 'zinc-200'],
    ['#d4d4d8', 'zinc-300'],
    ['#a1a1aa', 'zinc-400'],
    ['#71717a', 'zinc-500'],
    ['#52525b', 'zinc-600'],
    ['#3f3f46', 'zinc-700'],
    ['#27272a', 'zinc-800'],
    ['#18181b', 'zinc-900'],
    ['#09090b', 'zinc-950'],
  ],

  neutral: [
    ['#fafafa', 'neutral-50'],
    ['#f5f5f5', 'neutral-100'],
    ['#e5e5e5', 'neutral-200'],
    ['#d4d4d4', 'neutral-300'],
    ['#a3a3a3', 'neutral-400'],
    ['#737373', 'neutral-500'],
    ['#525252', 'neutral-600'],
    ['#404040', 'neutral-700'],
    ['#262626', 'neutral-800'],
    ['#171717', 'neutral-900'],
    ['#0a0a0a', 'neutral-950'],
  ],

  stone: [
    ['#fafaf9', 'stone-50'],
    ['#f5f5f4', 'stone-100'],
    ['#e7e5e4', 'stone-200'],
    ['#d6d3d1', 'stone-300'],
    ['#a8a29e', 'stone-400'],
    ['#78716c', 'stone-500'],
    ['#57534e', 'stone-600'],
    ['#44403c', 'stone-700'],
    ['#292524', 'stone-800'],
    ['#1c1917', 'stone-900'],
    ['#0c0a09', 'stone-950'],
  ],

  red: [
    ['#fef2f2', 'red-50'],
    ['#fee2e2', 'red-100'],
    ['#fecaca', 'red-200'],
    ['#fca5a5', 'red-300'],
    ['#f87171', 'red-400'],
    ['#ef4444', 'red-500'],
    ['#dc2626', 'red-600'],
    ['#b91c1c', 'red-700'],
    ['#991b1b', 'red-800'],
    ['#7f1d1d', 'red-900'],
    ['#450a0a', 'red-950'],
  ],

  orange: [
    ['#fff7ed', 'orange-50'],
    ['#ffedd5', 'orange-100'],
    ['#fed7aa', 'orange-200'],
    ['#fdba74', 'orange-300'],
    ['#fb923c', 'orange-400'],
    ['#f97316', 'orange-500'],
    ['#ea580c', 'orange-600'],
    ['#c2410c', 'orange-700'],
    ['#9a3412', 'orange-800'],
    ['#7c2d12', 'orange-900'],
    ['#431407', 'orange-950'],
  ],

  amber: [
    ['#fffbeb', 'amber-50'],
    ['#fef3c7', 'amber-100'],
    ['#fde68a', 'amber-200'],
    ['#fcd34d', 'amber-300'],
    ['#fbbf24', 'amber-400'],
    ['#f59e0b', 'amber-500'],
    ['#d97706', 'amber-600'],
    ['#b45309', 'amber-700'],
    ['#92400e', 'amber-800'],
    ['#78350f', 'amber-900'],
    ['#451a03', 'amber-950'],
  ],

  yellow: [
    ['#fefce8', 'yellow-50'],
    ['#fef9c3', 'yellow-100'],
    ['#fef08a', 'yellow-200'],
    ['#fde047', 'yellow-300'],
    ['#facc15', 'yellow-400'],
    ['#eab308', 'yellow-500'],
    ['#ca8a04', 'yellow-600'],
    ['#a16207', 'yellow-700'],
    ['#854d0e', 'yellow-800'],
    ['#713f12', 'yellow-900'],
    ['#422006', 'yellow-950'],
  ],

  lime: [
    ['#f7fee7', 'lime-50'],
    ['#ecfccb', 'lime-100'],
    ['#d9f99d', 'lime-200'],
    ['#bef264', 'lime-300'],
    ['#a3e635', 'lime-400'],
    ['#84cc16', 'lime-500'],
    ['#65a30d', 'lime-600'],
    ['#4d7c0f', 'lime-700'],
    ['#3f6212', 'lime-800'],
    ['#365314', 'lime-900'],
    ['#1a2e05', 'lime-950'],
  ],

  green: [
    ['#f0fdf4', 'green-50'],
    ['#dcfce7', 'green-100'],
    ['#bbf7d0', 'green-200'],
    ['#86efac', 'green-300'],
    ['#4ade80', 'green-400'],
    ['#22c55e', 'green-500'],
    ['#16a34a', 'green-600'],
    ['#15803d', 'green-700'],
    ['#166534', 'green-800'],
    ['#14532d', 'green-900'],
    ['#052e16', 'green-950'],
  ],

  emerald: [
    ['#ecfdf5', 'emerald-50'],
    ['#d1fae5', 'emerald-100'],
    ['#a7f3d0', 'emerald-200'],
    ['#6ee7b7', 'emerald-300'],
    ['#34d399', 'emerald-400'],
    ['#10b981', 'emerald-500'],
    ['#059669', 'emerald-600'],
    ['#047857', 'emerald-700'],
    ['#065f46', 'emerald-800'],
    ['#064e3b', 'emerald-900'],
    ['#022c22', 'emerald-950'],
  ],

  teal: [
    ['#f0fdfa', 'teal-50'],
    ['#ccfbf1', 'teal-100'],
    ['#99f6e4', 'teal-200'],
    ['#5eead4', 'teal-300'],
    ['#2dd4bf', 'teal-400'],
    ['#14b8a6', 'teal-500'],
    ['#0d9488', 'teal-600'],
    ['#0f766e', 'teal-700'],
    ['#115e59', 'teal-800'],
    ['#134e4a', 'teal-900'],
    ['#042f2e', 'teal-950'],
  ],

  cyan: [
    ['#ecfeff', 'cyan-50'],
    ['#cffafe', 'cyan-100'],
    ['#a5f3fc', 'cyan-200'],
    ['#67e8f9', 'cyan-300'],
    ['#22d3ee', 'cyan-400'],
    ['#06b6d4', 'cyan-500'],
    ['#0891b2', 'cyan-600'],
    ['#0e7490', 'cyan-700'],
    ['#155e75', 'cyan-800'],
    ['#164e63', 'cyan-900'],
    ['#083344', 'cyan-950'],
  ],

  sky: [
    ['#f0f9ff', 'sky-50'],
    ['#e0f2fe', 'sky-100'],
    ['#bae6fd', 'sky-200'],
    ['#7dd3fc', 'sky-300'],
    ['#38bdf8', 'sky-400'],
    ['#0ea5e9', 'sky-500'],
    ['#0284c7', 'sky-600'],
    ['#0369a1', 'sky-700'],
    ['#075985', 'sky-800'],
    ['#0c4a6e', 'sky-900'],
    ['#082f49', 'sky-950'],
  ],

  blue: [
    ['#eff6ff', 'blue-50'],
    ['#dbeafe', 'blue-100'],
    ['#bfdbfe', 'blue-200'],
    ['#93c5fd', 'blue-300'],
    ['#60a5fa', 'blue-400'],
    ['#3b82f6', 'blue-500'],
    ['#2563eb', 'blue-600'],
    ['#1d4ed8', 'blue-700'],
    ['#1e40af', 'blue-800'],
    ['#1e3a8a', 'blue-900'],
    ['#172554', 'blue-950'],
  ],

  indigo: [
    ['#eef2ff', 'indigo-50'],
    ['#e0e7ff', 'indigo-100'],
    ['#c7d2fe', 'indigo-200'],
    ['#a5b4fc', 'indigo-300'],
    ['#818cf8', 'indigo-400'],
    ['#6366f1', 'indigo-500'],
    ['#4f46e5', 'indigo-600'],
    ['#4338ca', 'indigo-700'],
    ['#3730a3', 'indigo-800'],
    ['#312e81', 'indigo-900'],
    ['#1e1b4b', 'indigo-950'],
  ],

  violet: [
    ['#f5f3ff', 'violet-50'],
    ['#ede9fe', 'violet-100'],
    ['#ddd6fe', 'violet-200'],
    ['#c4b5fd', 'violet-300'],
    ['#a78bfa', 'violet-400'],
    ['#8b5cf6', 'violet-500'],
    ['#7c3aed', 'violet-600'],
    ['#6d28d9', 'violet-700'],
    ['#5b21b6', 'violet-800'],
    ['#4c1d95', 'violet-900'],
    ['#2e1065', 'violet-950'],
  ],

  purple: [
    ['#faf5ff', 'purple-50'],
    ['#f3e8ff', 'purple-100'],
    ['#e9d5ff', 'purple-200'],
    ['#d8b4fe', 'purple-300'],
    ['#c084fc', 'purple-400'],
    ['#a855f7', 'purple-500'],
    ['#9333ea', 'purple-600'],
    ['#7e22ce', 'purple-700'],
    ['#6b21a8', 'purple-800'],
    ['#581c87', 'purple-900'],
    ['#3b0764', 'purple-950'],
  ],

  fuchsia: [
    ['#fdf4ff', 'fuchsia-50'],
    ['#fae8ff', 'fuchsia-100'],
    ['#f5d0fe', 'fuchsia-200'],
    ['#f0abfc', 'fuchsia-300'],
    ['#e879f9', 'fuchsia-400'],
    ['#d946ef', 'fuchsia-500'],
    ['#c026d3', 'fuchsia-600'],
    ['#a21caf', 'fuchsia-700'],
    ['#86198f', 'fuchsia-800'],
    ['#701a75', 'fuchsia-900'],
    ['#4a044e', 'fuchsia-950'],
  ],

  pink: [
    ['#fdf2f8', 'pink-50'],
    ['#fce7f3', 'pink-100'],
    ['#fbcfe8', 'pink-200'],
    ['#f9a8d4', 'pink-300'],
    ['#f472b6', 'pink-400'],
    ['#ec4899', 'pink-500'],
    ['#db2777', 'pink-600'],
    ['#be185d', 'pink-700'],
    ['#9d174d', 'pink-800'],
    ['#831843', 'pink-900'],
    ['#500724', 'pink-950'],
  ],

  rose: [
    ['#fff1f2', 'rose-50'],
    ['#ffe4e6', 'rose-100'],
    ['#fecdd3', 'rose-200'],
    ['#fda4af', 'rose-300'],
    ['#fb7185', 'rose-400'],
    ['#f43f5e', 'rose-500'],
    ['#e11d48', 'rose-600'],
    ['#be123c', 'rose-700'],
    ['#9f1239', 'rose-800'],
    ['#881337', 'rose-900'],
    ['#4c0519', 'rose-950'],
  ],
};

/**
 * Tie-break policy for hex → token reverse lookup, lowest priority FIRST.
 *
 * Tailwind's gray families share several hex values across the family
 * (e.g. `#fafafa` is BOTH `zinc-50` and `neutral-50`). When asked
 * "what token represents this hex?" we must pick exactly one, and that
 * pick must be deterministic across runs.
 *
 * Convention: the more semantically-named family wins over the more
 * generic one, so the chosen order (low → high priority) is:
 *
 *     slate < gray < zinc < neutral < stone
 *
 * For `#fafafa` this means `neutral-50` wins (stone-50 is `#fafaf9`,
 * not a collision). All non-gray families are unique per hex, so their
 * relative position in this array does not matter for correctness;
 * they are listed before the gray block purely for readability.
 *
 * Do NOT rely on the iteration order of {@link COLOR_FAMILIES} for
 * collisions — only this array decides the winner.
 */
export const COLOR_FAMILY_PRIORITY: ReadonlyArray<keyof typeof COLOR_FAMILIES> = [
  'base',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  // Gray families: lowest → highest priority (last write wins in Map.set).
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
];

/**
 * Build the hex → token reverse lookup from {@link COLOR_FAMILIES} in
 * {@link COLOR_FAMILY_PRIORITY} order. Higher-priority families come last
 * so their `Map.set` overwrites earlier entries on hex collisions.
 */
function buildColorMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const family of COLOR_FAMILY_PRIORITY) {
    const shades = COLOR_FAMILIES[family];
    if (!shades) continue;
    for (const [hex, token] of shades) {
      map.set(hex, token);
    }
  }
  return map;
}

/**
 * Tailwind CSS Color Map: hex value → color class suffix.
 *
 * Built deterministically from {@link COLOR_FAMILIES} +
 * {@link COLOR_FAMILY_PRIORITY}. For hex collisions across gray families
 * (e.g. `#fafafa` ∈ {zinc-50, neutral-50}), the higher-priority family
 * wins. See {@link COLOR_FAMILY_PRIORITY} for the policy.
 */
export const COLOR_MAP: Map<string, string> = buildColorMap();


// ============================================================================
// Unit Conversion
// ============================================================================

/**
 * Convert a value to pixels based on its unit.
 * Returns null for relative units that can't be converted (%, vh, vw, etc.)
 *
 * @param value - The numeric value
 * @param unit - The CSS unit (px, rem, em, %, vh, vw, etc.)
 * @returns The value in pixels, or null for unconvertible units
 */
export function convertToPixels(value: number, unit: string): number | null {
  switch (unit) {
    case 'px':
      return value;
    case 'rem':
      return value * 16; // 1rem = 16px (default)
    case 'em':
      return value * 16; // Treat em like rem for conversion
    default:
      // %, vh, vw, svh, dvh, lvh, etc. cannot be converted
      return null;
  }
}

// ============================================================================
// Spacing Resolution
// ============================================================================

/**
 * Check if a pixel value can be expressed as a clean Tailwind spacing class.
 * For v4/CDN: any value divisible by 4, or fractional values (2, 6, 10, 14)
 * For v3: only predefined scale values
 *
 * @param pxValue - Value in pixels
 * @param version - Tailwind version (defaults to 'unknown' which uses v4 behavior)
 * @returns The Tailwind unit suffix (e.g., '4', '0.5') or null if arbitrary needed
 */
export function getSpacingSuffix(
  pxValue: number,
  version: TailwindVersion = 'unknown'
): string | null {
  // Handle zero
  if (pxValue === 0) return '0';

  // Check fractional values first (2px, 6px, 10px, 14px)
  const fractional = FRACTIONAL_SPACING.get(pxValue);
  if (fractional) return fractional;

  // Check if value is divisible by 4
  if (pxValue % 4 !== 0) return null;

  const unit = pxValue / 4;

  // For v3 or unknown, check against fixed scale (be conservative)
  // This ensures generated classes work in both v3 and v4
  // Only v4-cdn and v4-build allow arbitrary spacing units
  if (version === 'v3' || version === 'unknown') {
    if (!V3_SPACING_SCALE.has(unit)) return null;
  }

  // v4-cdn/v4-build: any integer unit is valid
  if (!Number.isInteger(unit)) return null;

  return String(unit);
}

/**
 * Resolve a spacing value to a Tailwind class.
 *
 * @param prefix - The class prefix (e.g., 'p', 'pt', 'm', 'mx')
 * @param value - The numeric value
 * @param unit - The CSS unit
 * @param version - Tailwind version
 * @returns The complete Tailwind class (e.g., 'p-4' or 'p-[17px]')
 */
export function resolveSpacingClass(
  prefix: string,
  value: number,
  unit: string,
  version: TailwindVersion = 'unknown'
): string {
  const isNegative = value < 0;
  const absValue = Math.abs(value);

  // Handle zero
  if (absValue === 0) {
    return `${prefix}-0`;
  }

  // Try to convert to pixels
  const pxValue = convertToPixels(absValue, unit);

  if (pxValue !== null) {
    // Check if we can use a clean class
    const suffix = getSpacingSuffix(pxValue, version);
    if (suffix !== null) {
      return `${isNegative ? '-' : ''}${prefix}-${suffix}`;
    }
    // Fall back to arbitrary with px
    return `${isNegative ? '-' : ''}${prefix}-[${pxValue}px]`;
  }

  // For relative units, always use arbitrary
  return `${isNegative ? '-' : ''}${prefix}-[${absValue}${unit}]`;
}

// ============================================================================
// General Class Resolution
// ============================================================================

/**
 * Resolve any property/value to a Tailwind class.
 * Uses the appropriate scale based on property type.
 *
 * @param property - The Tailwind property (e.g., 'w', 'h', 'gap', 'rounded', 'opacity', 'z')
 * @param value - The numeric value
 * @param unit - The CSS unit (defaults to 'px')
 * @param version - Tailwind version
 * @returns The complete Tailwind class
 */
export function resolveToClass(
  property: string,
  value: number,
  unit: string = 'px',
  version: TailwindVersion = 'unknown'
): string {
  // Handle spacing properties (w, h, gap, min-*, max-*, insets)
  const spacingProperties = [
    'w', 'h', 'size',
    'min-w', 'max-w', 'min-h', 'max-h',
    'gap', 'gap-x', 'gap-y',
    'top', 'right', 'bottom', 'left',
    'inset', 'inset-x', 'inset-y',
    'p', 'pt', 'pr', 'pb', 'pl', 'px', 'py',
    'm', 'mt', 'mr', 'mb', 'ml', 'mx', 'my',
  ];

  if (spacingProperties.includes(property)) {
    return resolveSpacingClass(property, value, unit, version);
  }

  // Handle border-radius
  if (property === 'rounded' || property.startsWith('rounded-')) {
    const pxValue = convertToPixels(value, unit);
    if (pxValue !== null) {
      const suffix = BORDER_RADIUS_SCALE.get(pxValue);
      if (suffix) {
        if (suffix === 'DEFAULT') {
          return property; // 'rounded' without suffix for 4px
        }
        return `${property}-${suffix}`;
      }
    }
    return `${property}-[${value}${unit}]`;
  }

  // Handle opacity (expects percentage 0-100)
  if (property === 'opacity') {
    const suffix = OPACITY_SCALE.get(value);
    if (suffix) {
      return `opacity-${suffix}`;
    }
    return `opacity-[${value}%]`;
  }

  // Handle z-index
  if (property === 'z') {
    const suffix = Z_INDEX_SCALE.get(value);
    if (suffix) {
      return `z-${suffix}`;
    }
    return `z-[${value}]`;
  }

  // Handle font-size
  if (property === 'text') {
    const pxValue = convertToPixels(value, unit);
    if (pxValue !== null) {
      const suffix = FONT_SIZE_SCALE.get(pxValue);
      if (suffix) {
        return `text-${suffix}`;
      }
    }
    return `text-[${value}${unit}]`;
  }

  // Handle blur
  if (property === 'blur') {
    const pxValue = convertToPixels(value, unit);
    if (pxValue !== null) {
      const suffix = BLUR_SCALE.get(pxValue);
      if (suffix) {
        if (suffix === 'DEFAULT') {
          return 'blur';
        }
        if (suffix === 'none') {
          return 'blur-none';
        }
        return `blur-${suffix}`;
      }
    }
    return `blur-[${value}${unit}]`;
  }

  // Handle duration
  if (property === 'duration') {
    const suffix = DURATION_SCALE.get(value);
    if (suffix) {
      return `duration-${suffix}`;
    }
    return `duration-[${value}ms]`;
  }

  // Default: use arbitrary syntax
  return `${property}-[${value}${unit}]`;
}

// ============================================================================
// Axis Optimization
// ============================================================================

/**
 * Optimize spacing classes by collapsing axes where possible.
 * Turns individual side classes into axis/all classes when values match.
 *
 * @param property - 'p' for padding, 'm' for margin
 * @param sides - Object with top, right, bottom, left values
 * @param version - Tailwind version
 * @returns Array of optimized Tailwind classes
 */
export function optimizeSpacingClasses(
  property: 'p' | 'm',
  sides: FourSides,
  version: TailwindVersion = 'unknown'
): string[] {
  // Convert all values to pixels for comparison
  const toPx = (s: SpacingValue): number | null => convertToPixels(s.value, s.unit);

  const topPx = toPx(sides.top);
  const rightPx = toPx(sides.right);
  const bottomPx = toPx(sides.bottom);
  const leftPx = toPx(sides.left);

  // If any value can't be converted to px, fall back to individual classes
  if (topPx === null || rightPx === null || bottomPx === null || leftPx === null) {
    return [
      resolveSpacingClass(`${property}t`, sides.top.value, sides.top.unit, version),
      resolveSpacingClass(`${property}r`, sides.right.value, sides.right.unit, version),
      resolveSpacingClass(`${property}b`, sides.bottom.value, sides.bottom.unit, version),
      resolveSpacingClass(`${property}l`, sides.left.value, sides.left.unit, version),
    ];
  }

  // Check if all 4 sides are equal
  if (topPx === rightPx && rightPx === bottomPx && bottomPx === leftPx) {
    return [resolveSpacingClass(property, topPx, 'px', version)];
  }

  // Check if we can use x/y axes
  const xEqual = leftPx === rightPx;
  const yEqual = topPx === bottomPx;

  if (xEqual && yEqual) {
    // Both axes can be collapsed
    return [
      resolveSpacingClass(`${property}x`, leftPx, 'px', version),
      resolveSpacingClass(`${property}y`, topPx, 'px', version),
    ];
  }

  // Check if just x-axis can be collapsed
  if (xEqual) {
    return [
      resolveSpacingClass(`${property}x`, leftPx, 'px', version),
      resolveSpacingClass(`${property}t`, topPx, 'px', version),
      resolveSpacingClass(`${property}b`, bottomPx, 'px', version),
    ];
  }

  // Check if just y-axis can be collapsed
  if (yEqual) {
    return [
      resolveSpacingClass(`${property}y`, topPx, 'px', version),
      resolveSpacingClass(`${property}l`, leftPx, 'px', version),
      resolveSpacingClass(`${property}r`, rightPx, 'px', version),
    ];
  }

  // No optimization possible, return individual classes
  return [
    resolveSpacingClass(`${property}t`, topPx, 'px', version),
    resolveSpacingClass(`${property}r`, rightPx, 'px', version),
    resolveSpacingClass(`${property}b`, bottomPx, 'px', version),
    resolveSpacingClass(`${property}l`, leftPx, 'px', version),
  ];
}

/**
 * Optimize border-radius classes by collapsing corners where possible.
 *
 * @param corners - Object with tl, tr, br, bl values in pixels
 * @param version - Tailwind version
 * @returns Array of optimized Tailwind classes
 */
export function optimizeBorderRadiusClasses(
  corners: { tl: number; tr: number; br: number; bl: number },
  version: TailwindVersion = 'unknown'
): string[] {
  const { tl, tr, br, bl } = corners;

  // All corners equal
  if (tl === tr && tr === br && br === bl) {
    return [resolveToClass('rounded', tl, 'px', version)];
  }

  // Top corners equal, bottom corners equal (but different from top)
  if (tl === tr && bl === br) {
    return [
      resolveToClass('rounded-t', tl, 'px', version),
      resolveToClass('rounded-b', bl, 'px', version),
    ];
  }

  // Left corners equal, right corners equal
  if (tl === bl && tr === br) {
    return [
      resolveToClass('rounded-l', tl, 'px', version),
      resolveToClass('rounded-r', tr, 'px', version),
    ];
  }

  // No optimization, return individual corners
  return [
    resolveToClass('rounded-tl', tl, 'px', version),
    resolveToClass('rounded-tr', tr, 'px', version),
    resolveToClass('rounded-br', br, 'px', version),
    resolveToClass('rounded-bl', bl, 'px', version),
  ];
}

// ============================================================================
// Color Resolution
// ============================================================================

/**
 * Resolve a hex color to a Tailwind color class if it matches exactly.
 *
 * @param hex - The hex color value (with or without #)
 * @param prefix - The color property prefix (e.g., 'bg', 'text', 'border')
 * @returns The Tailwind class or null if no exact match
 */
export function resolveColorClass(
  hex: string,
  prefix: string
): string | null {
  // Normalize hex: lowercase, ensure # prefix
  const normalized = hex.toLowerCase().startsWith('#')
    ? hex.toLowerCase()
    : `#${hex.toLowerCase()}`;

  const colorSuffix = COLOR_MAP.get(normalized);
  if (colorSuffix) {
    return `${prefix}-${colorSuffix}`;
  }

  return null;
}

/**
 * Get a color class, using named class if exact match exists, otherwise arbitrary.
 *
 * @param hex - The hex color value
 * @param prefix - The color property prefix
 * @returns The Tailwind class (named or arbitrary)
 */
export function getColorClass(hex: string, prefix: string): string {
  const namedClass = resolveColorClass(hex, prefix);
  if (namedClass) {
    return namedClass;
  }

  // Normalize and use arbitrary
  const normalized = hex.toLowerCase().startsWith('#')
    ? hex.toLowerCase()
    : `#${hex.toLowerCase()}`;

  return `${prefix}-[${normalized}]`;
}
