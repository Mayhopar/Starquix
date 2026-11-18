/**
 * Owner rule: never a native confirm / prompt / alert in the editor. A delete acts at once and ⌘Z brings it back
 * (culture.md Law 6, owner 2026-11-10: "delete anything AND undo"); only a public deploy waits — the agent asks in chat.
 * FROZEN = the known leftovers. It may only shrink: fix one, delete its entry.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const FROZEN: Record<string, number> = {};

const SRC = join(__dirname, '..');
// A bare or window./globalThis./self. call; `x.confirm(` (any other object) and `onConfirm(` are not native dialogs.
const NATIVE = /(?<![\w$.])(?:(?:window|globalThis|self)\.)?(?:confirm|prompt|alert)\s*\(/g;
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '__tests__' && entry.name !== 'test') yield* sources(path); }
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) yield path;
  }
}

describe('no native dialogs in app/src', () => {
  it('finds only the frozen leftovers', () => {
    const found: Record<string, number> = {};
    for (const file of sources(SRC)) {
      const n = readFileSync(file, 'utf8').replace(COMMENTS, '').match(NATIVE)?.length ?? 0;
      if (n) found[relative(SRC, file)] = n;
    }
    expect(found).toEqual(FROZEN);
  });
});
