/**
 * Issue #9: selected text was barely visible — the highlight was stone on stone (dark: stone-700 @ 60% on stone-800,
 * ΔE 8 from its surface; light: stone-300 on white, ΔE 15). It is one accent tint for both modes, and ::selection paints
 * the selected text in --color-text. This resolves the real values (theme.css + Tailwind's palette), lays the tint over
 * every surface text sits on and checks what the eye gets: the tint stands off its surface, the text reads on the tint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastRatio } from '@/core/stack/stackColor';

const read = (file: string): string => readFileSync(resolve(process.cwd(), file), 'utf8');
const tokens = new Map<string, string>();
for (const css of [read('node_modules/tailwindcss/theme.css'), read('src/styles/theme.css')]) {
  for (const [, name, value] of css.matchAll(/^\s*(--color-[\w-]+):\s*([^;]+);/gm)) tokens.set(name, value.trim());
}

type Mode = 'light' | 'dark';
type Rgb = number[]; // gamma sRGB, 0..255
/** A color the way CSS mixes it: oklab + alpha. */
interface Lab { L: number; a: number; b: number; alpha: number }
const CLEAR: Lab = { L: 0, a: 0, b: 0, alpha: 0 };

/** color-mix(in oklab, x p%, y), premultiplied as CSS does it; Tailwind's --alpha(x / p%) is this with y = transparent. */
function mix(x: Lab, p: number, y: Lab): Lab {
  const wx = (p / 100) * x.alpha, wy = (1 - p / 100) * y.alpha, alpha = wx + wy;
  return alpha ? { L: (x.L * wx + y.L * wy) / alpha, a: (x.a * wx + y.a * wy) / alpha, b: (x.b * wx + y.b * wy) / alpha, alpha } : CLEAR;
}
/** light-dark(a, b) → [a, b]: split on the comma outside any parentheses. */
function sides(inner: string): string[] {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++; else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && !depth) return [inner.slice(0, i), inner.slice(i + 1)];
  }
  throw new Error(`not light-dark(a, b): ${inner}`);
}
function parse(value: string, mode: Mode): Lab {
  const v = value.trim();
  let m: RegExpExecArray | null;
  if ((m = /^var\((--[\w-]+)\)$/.exec(v))) {
    const next = tokens.get(m[1]);
    if (!next) throw new Error(`no token ${m[1]}`);
    return parse(next, mode);
  }
  if (v === 'transparent') return CLEAR;
  if (v === '#fff' || v === '#000') return { L: v === '#fff' ? 1 : 0, a: 0, b: 0, alpha: 1 };
  if ((m = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(v))) {
    const hue = (+m[3] * Math.PI) / 180;
    return { L: +m[1] / 100, a: +m[2] * Math.cos(hue), b: +m[2] * Math.sin(hue), alpha: 1 };
  }
  if ((m = /^light-dark\((.*)\)$/.exec(v))) return parse(sides(m[1])[mode === 'light' ? 0 : 1], mode);
  if ((m = /^--alpha\((.*)\/\s*([\d.]+)%\)$/.exec(v))) return mix(parse(m[1], mode), +m[2], CLEAR);
  if ((m = /^color-mix\(in oklab, (.*) ([\d.]+)%, (.*)\)$/.exec(v))) return mix(parse(m[1], mode), +m[2], parse(m[3], mode));
  throw new Error(`themeSelection.test cannot read "${v}"`);
}
function srgb({ L, a, b }: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map(c => 255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
}
/** Source-over in gamma sRGB — how the browser lays a translucent color on what is under it. */
const over = (top: Lab, under: Rgb): Rgb => srgb(top).map((c, i) => c * top.alpha + under[i] * (1 - top.alpha));
const hex = (rgb: Rgb): string => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
function cielab(rgb: Rgb): number[] { // D65
  const [r, g, b] = rgb.map(c => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
  const [x, y, z] = [(0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, 0.2126729 * r + 0.7151522 * g + 0.072175 * b, (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883]
    .map(t => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIE76: 2.3 is a just-noticeable difference; the old dark highlight sat 1.5–11 from its surface. */
const deltaE = (p: Rgb, q: Rgb): number => Math.hypot(...cielab(p).map((c, i) => c - cielab(q)[i]));

const token = (name: string, mode: Mode): Lab => parse(`var(${name})`, mode);
const highlightOn = (under: Rgb, mode: Mode): Rgb => over(token('--color-bg-text-selection', mode), under);

/** Every theme surface selectable text sits on, bottom layer first. */
const SURFACES: Record<string, string[]> = {
  'bg (panels, flyouts, windows, the terminal)': ['--color-bg'],
  'bg-contrast (cards, tooltips, the variables code view)': ['--color-bg-contrast'],
  'input-fill (fields, the code editor)': ['--color-input-fill'],
  'input-fill-window on bg (window fields)': ['--color-bg', '--color-input-fill-window'],
  'bg-hover on bg': ['--color-bg', '--color-bg-hover'],
  'bg-selected on bg (a selected row)': ['--color-bg', '--color-bg-selected'],
  'bg-selected-hover on bg': ['--color-bg', '--color-bg-selected-hover'],
  'bg-input-editing (a rename in Pages / Assets)': ['--color-bg-input-editing'],
};
const CELLS = (['light', 'dark'] as const).flatMap(mode => Object.entries(SURFACES).map(([surface, layers]) => ({ mode, surface, layers })));

describe('text selection', () => {
  it('::selection paints the token, and the selected text in the theme ink', () => {
    const rule = /::selection\s*\{([^}]*)\}/.exec(read('src/styles/globals.css'))?.[1] ?? '';
    expect(rule).toMatch(/background-color:\s*var\(--color-bg-text-selection\)/);
    expect(rule).toMatch(/\scolor:\s*var\(--color-text\)/);
  });

  it.each(CELLS)('$mode · $surface: the highlight stands off the surface, the text reads on it', ({ mode, layers }) => {
    const surface = layers.reduce<Rgb>((under, name) => over(token(name, mode), under), [0, 0, 0]);
    const highlight = highlightOn(surface, mode);
    expect(deltaE(highlight, surface), 'highlight vs surface, CIE76').toBeGreaterThanOrEqual(20);
    expect(contrastRatio(hex(srgb(token('--color-text', mode))), hex(highlight)), 'text on the highlight, WCAG').toBeGreaterThanOrEqual(4.5);
  });

  it('a block with its own fill + ink keeps that ink: the theme ink would sink into the post editor\'s dark code block', () => {
    const css = read('src/components/PostEditor/PostBodyEditor.css');
    const [, fill, ink] = /pre\.sq-code\s*\{\s*background:\s*(#[0-9a-f]{6});\s*color:\s*(#[0-9a-f]{6})/i.exec(css) ?? [];
    expect(/:is\(pre\.sq-code, \.sq-stack\[data-sq-colored\]\) ::selection\s*\{\s*color:\s*currentColor/.test(css), 'the rule in PostBodyEditor.css').toBe(true);
    const highlight = hex(highlightOn([1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16)), 'light'));
    expect(contrastRatio(ink, highlight)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex(srgb(token('--color-text', 'light'))), highlight)).toBeLessThan(3); // why the rule exists
  });
});
