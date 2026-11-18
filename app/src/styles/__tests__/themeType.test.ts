/**
 * Type is theme.css variables only (owner 2026-11-03): every chrome text style is defined there, and every
 * `text-<size>-medium` class a component writes must exist — Tailwind emits nothing for an unknown name, so a typo would
 * silently render with the inherited size. Raw weights/sizes are the UI lint's job (lint-ui-consistency.mjs).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
const has = (decl: string) => new RegExp(`--${decl}:`).test(css);

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
  return /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
});

describe('theme.css TYPE variables', () => {
  it.each(['3xs', '2xs', 'xs', 'sm', 'base', 'lg'])('text-%s declares its size and line-height', (s) => {
    expect(has(`text-${s}`)).toBe(true);
    expect(has(`text-${s}--line-height`)).toBe(true);
  });

  it('the chrome weights are variables: normal 400, medium 500 — and no semibold of our own', () => {
    expect(css).toMatch(/--font-weight-normal:\s*400;/);
    expect(css).toMatch(/--font-weight-medium:\s*500;/);
    expect(css).not.toMatch(/--font-weight-semibold:/);
    expect(css).not.toMatch(/--text-[\w]+-semibold/);
  });

  it('every -medium style takes its weight from --font-weight-medium; text-lg is medium', () => {
    const names = [...css.matchAll(/--text-([\w]+-medium):/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const n of names) {
      expect(css, n).toMatch(new RegExp(`--text-${n}--line-height:`));
      expect(css, n).toMatch(new RegExp(`--text-${n}--font-weight:\\s*var\\(--font-weight-medium\\)`));
    }
    expect(css).toMatch(/--text-lg--font-weight:\s*var\(--font-weight-medium\)/);
  });

  it('every text-<size>-<suffix> style written in components/pages is defined (no silent typo)', () => {
    const used = new Set<string>();
    for (const root of ['src/components', 'src/pages']) {
      for (const f of walk(resolve(process.cwd(), root))) {
        for (const m of readFileSync(f, 'utf8').matchAll(/(?<![\w-])text-((?:3xs|2xs|xs|sm|base|lg)-[a-z]+)(?![\w-])/g)) used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const n of used) expect(has(`text-${n}`), `text-${n} is not defined in theme.css`).toBe(true);
  });
});
