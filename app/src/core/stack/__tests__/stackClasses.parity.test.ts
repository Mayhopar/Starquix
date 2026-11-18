import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_SHARED_CLASS_STRINGS } from '../stackClasses';

const STACK = readFileSync(join(__dirname, '../../../../../preview-template/src/components/Stack.astro'), 'utf8');

describe('Stack.astro ↔ stackClasses parity', () => {
  it.each(ALL_SHARED_CLASS_STRINGS)('Stack.astro carries %s verbatim', cls => {
    expect(STACK).toContain(`'${cls}'`);
  });
  it('has no <style> block (Tailwind-only rule)', () => {
    expect(STACK).not.toMatch(/<style[\s>]/);
  });
  it('imports its utilities companion (P8)', () => {
    expect(STACK).toContain("import './sq-utilities.css';");
  });
  it('carries the upgrade marker', () => {
    expect(STACK).toContain('sq-stack-v5');
  });
});

/**
 * Projects upgrade their copy of Stack.astro only when the MARKER differs
 * (a same-marker copy is treated as the user's). So every content change must
 * bump the marker — otherwise shipped projects keep a stale Stack forever
 * (happened 2026-09-28: a v3 copy without the Media-gap rule never upgraded).
 * When this fails: bump sq-stack-vN everywhere, then update both values here.
 */
import { createHash } from 'node:crypto';
describe('Stack.astro marker ratchet', () => {
  it('content hash is pinned to the current marker', () => {
    const sha = createHash('sha256').update(STACK).digest('hex').slice(0, 16);
    expect({ marker: STACK.match(/sq-stack-v\d+/)?.[0], sha }).toEqual({ marker: 'sq-stack-v5', sha: '5e76b07378bd38d9' });
  });
});
