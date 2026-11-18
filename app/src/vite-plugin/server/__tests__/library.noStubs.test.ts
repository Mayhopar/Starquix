/**
 * The built-in component library ships to every project's Assets panel as
 * "Static" roots. Four dev-era placeholder stubs (Component1/2 = the
 * "Add component" default, Div/Div2 = drawn-shape leftovers) sat there since
 * 2025 and showed up in an imported personal site's Assets panel (2026-09-10).
 * Every library file must be a real component, every manifest root must exist,
 * and the scaffold Layout must import only what it renders.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LIB = resolve(__dirname, '../../../../../preview-template/src/components/library');
const LAYOUT = resolve(__dirname, '../../../../../preview-template/src/layouts/Layout.astro');

describe('built-in component library', () => {
  it('has no placeholder stubs', () => {
    const names = readdirSync(LIB).filter((f) => f.endsWith('.astro'));
    expect(names.filter((n) => /^(Component\d*|Div\d*)\.astro$/.test(n))).toEqual([]);
    for (const n of names) {
      const body = readFileSync(resolve(LIB, n), 'utf8').replace(/^---[\s\S]*?---/, '').trim();
      expect(body, n).not.toMatch(/^<section>\s*<p>[A-Za-z]+\d*<\/p>\s*<\/section>$/);
    }
  });

  it('folder manifest roots all exist on disk', () => {
    const manifest = JSON.parse(readFileSync(resolve(LIB, '.sq-folders.json'), 'utf8')) as {
      roots: string[]; folders: Record<string, { children: string[] }>;
    };
    const refs = [...manifest.roots, ...Object.values(manifest.folders).flatMap((f) => f.children)]
      .filter((r) => r.startsWith('comp:library/')).map((r) => r.slice('comp:library/'.length));
    for (const rel of refs) expect(existsSync(resolve(LIB, rel)), rel).toBe(true);
  });

  it('scaffold Layout imports only components it renders', () => {
    const src = readFileSync(LAYOUT, 'utf8');
    const imports = [...src.matchAll(/^import (\w+) from '\.\.\/components\/[^']+';/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(src, name).toMatch(new RegExp(`<${name}\\b`));
    expect(src).not.toMatch(/eded|lol\?/);
  });
});
