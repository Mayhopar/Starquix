// The system Media component's CLOSED knob surface (task-206 D2): style knobs
// are CSS variables its scoped style consumes — the editor writes ONLY these.
// If a var is renamed/removed here without updating MediaBlock, this fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '../../../../..', 'preview-template/src/components/Media.astro'),
  'utf8',
);

describe('Media.astro system knob surface', () => {
  it.each(['--sq-media-gap', '--sq-media-radius', '--sq-media-pad', '--sq-media-margin'])(
    'consumes %s in its scoped style', (v) => {
      expect(src).toContain(`var(${v}`);
    });

  it('renders <video> for video sources', () => {
    expect(src).toMatch(/<video/);
  });

  // The component viewer dynamic-imports the file, so a SCOPED style is never
  // collected and the placeholders render collapsed there.
  it('style is is:inline', () => {
    expect(src).toMatch(/<style is:inline>/);
  });
});

// Audit 2026-09-30: a row of three stayed 3 × ~100px on a 375px phone.
describe('Media.astro on a phone', () => {
  it('a row of three stacks below 640px; the marker changed with it (so shipped copies upgrade)', () => {
    expect(src).toMatch(/@media \(max-width: 639\.98px\)\s*\{\s*\.sq-media\[data-sq-media-count="3"\] \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(src).toContain('data-sq-media-count={count}');
    expect(src).toContain('sq-media-v2');
  });
});
