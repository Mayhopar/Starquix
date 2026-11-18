/**
 * Stack colors (design D4, P9): the classes are the truth; the editor only
 * RESOLVES them (to paint its own preview and to pick an Auto text color).
 */
import { getHexForColorClass } from '@/components/DesignBar/tailwindColors';
import type { VariableCollection } from '@/core/variables/types';

/** `bg-…` / `text-…` class out of a Stack's class string (the first one). */
export function colorClassOf(cls: string, prefix: 'bg' | 'text'): string {
  return cls.split(/\s+/).find(c => c.startsWith(`${prefix}-`)) ?? '';
}

/** Replace (or drop, with '') the `prefix` color class, keeping the rest verbatim. */
export function withColorClass(cls: string, prefix: 'bg' | 'text', next: string): string {
  const kept = cls.split(/\s+/).filter(c => c && !c.startsWith(`${prefix}-`));
  return [...(prefix === 'bg' ? [next] : []), ...kept, ...(prefix === 'text' ? [next] : [])].filter(Boolean).join(' ');
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * `bg-[#hex]` → hex; `bg-[var(--x)]` → lookupVar('x'); palette → its hex;
 * a theme token (`bg-primary`) → lookupVar('primary'); else null.
 */
export function resolveColorClass(cls: string, lookupVar: (name: string) => string | null): string | null {
  const m = /^(bg|text)-(.+)$/.exec(cls);
  if (!m) return null;
  const [, prefix, value] = m;
  const arbitrary = /^\[(.+)\]$/.exec(value);
  if (arbitrary) {
    if (HEX.test(arbitrary[1])) return arbitrary[1];
    const v = /^(?:color:)?var\(--([\w-]+)\)$/.exec(arbitrary[1]);
    return v ? lookupVar(v[1]) : null;
  }
  return getHexForColorClass(cls, prefix) ?? lookupVar(value);
}

function luminance(hex: string): number {
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const AUTO_DARK = 'text-[#111111]';
export const AUTO_LIGHT = 'text-white';

/** P9: the higher-contrast of white / near-black against `bgHex`. */
export function autoTextClass(bgHex: string): typeof AUTO_DARK | typeof AUTO_LIGHT {
  return contrastRatio(bgHex, '#ffffff') >= contrastRatio(bgHex, '#111111') ? AUTO_LIGHT : AUTO_DARK;
}

/**
 * The class string with Auto text applied: the resolved background decides;
 * an unresolvable background → no text class (inherit).
 */
export function applyAutoText(cls: string, lookupVar: (name: string) => string | null): string {
  const bg = colorClassOf(cls, 'bg');
  const hex = bg ? resolveColorClass(bg, lookupVar) : null;
  return withColorClass(cls, 'text', hex && HEX.test(hex) ? autoTextClass(hex) : '');
}

/** Project color variables → lookup by name (default mode's value). */
export function variableLookup(collections: VariableCollection[]): (name: string) => string | null {
  const map = new Map<string, string>();
  for (const col of collections) {
    const mode = col.modes.find(m => m.isDefault) ?? col.modes[0];
    for (const v of col.variables) {
      const value = (mode && v.values[mode.id]) ?? Object.values(v.values)[0];
      if (value?.type === 'color') map.set(v.name, value.hex);
    }
  }
  return name => map.get(name) ?? null;
}
