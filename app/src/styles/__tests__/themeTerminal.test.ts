/** The MCP terminal's 16 ANSI colors are theme.css tokens (xterm's defaults are made for a dark screen: white 1.4:1,
 *  bright-white 1.1:1 on the light Bg — owner 2026-11-07). One light-dark line each, Tailwind steps, no hex. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

describe('theme.css TERMINAL tokens', () => {
  it.each(NAMES.flatMap(n => [n, `bright-${n}`]))('--color-term-%s is one light-dark() of palette steps', (n) => {
    const line = css.split('\n').find(l => l.trim().startsWith(`--color-term-${n}:`));
    expect(line, n).toBeDefined();
    expect(line).toMatch(/light-dark\(var\(--color-[a-z]+-\d+\), var\(--color-[a-z]+-\d+\)\)/);
    expect(line).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
