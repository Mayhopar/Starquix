/**
 * Owner 2026-10-22: "fill for input must be not darker, but half a step lighter in dark mode" — every input paints the
 * input tokens (bg-input-fill / border-input-stroke), never the darker Bg Contrast well. Kit fields do it in
 * ui/InputContainer; this guards the hand-rolled field boxes in components/** ("not all the inputs have lighter bg").
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src/components');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
  return /\.(tsx|ts)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
});
// An editable box: the class string carries input behavior (focus/placeholder/outline) or is a 28px bordered field shell.
const FIELD = /outline-none|focus:border|focus-within:border|placeholder:|\bh-7\b[^"'`]*\bborder\b[^"'`]*\boverflow-hidden\b|\bborder\b[^"'`]*\bh-7\b[^"'`]*\boverflow-hidden\b/;

describe('inputs paint the input tokens', () => {
  it('no hand-rolled field box uses bg-bg-contrast (the dark well)', () => {
    const offenders: string[] = [];
    for (const f of files(ROOT)) {
      if (f.includes('/components/ui/')) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('bg-bg-contrast') && FIELD.test(line)) offenders.push(`${relative(ROOT, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
