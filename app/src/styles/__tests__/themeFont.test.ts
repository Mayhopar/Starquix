/**
 * The chrome font is the Figma's Inter, bundled (the desktop app works offline): every @font-face in theme.css must
 * point at a file that exists, and --font-sans must lead with it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const themePath = resolve(process.cwd(), 'src/styles/theme.css');
const css = readFileSync(themePath, 'utf8');

describe('theme.css chrome font', () => {
  it('every @font-face src resolves to a bundled file', () => {
    const urls = [...css.matchAll(/@font-face\s*{[^}]*?src:\s*url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(7);
    for (const u of urls) expect(existsSync(resolve(dirname(themePath), u)), u).toBe(true);
  });

  it('--font-sans leads with Inter Variable (the family the @font-face rules declare)', () => {
    expect(css).toMatch(/--font-sans:\s*'Inter Variable',/);
    expect(css).toMatch(/font-family:\s*'Inter Variable';/);
  });
});
