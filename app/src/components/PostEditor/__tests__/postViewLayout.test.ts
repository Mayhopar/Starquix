import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Two layout regressions the owner hit by hand on 2026-08-09, guarded here
 * because an .astro route has no unit-testable surface — the assertion is on
 * the stylesheet the route ships.
 *
 * 1. SqPostView renders NO site layout, so the user's own stylesheet (and with
 *    it their `img { max-width: 100% }`) never loads. Every image drew at its
 *    intrinsic size — the fixture's 1600px hero inside a 1184px frame — and the
 *    post scrolled sideways.
 * 2. `padding-bottom: 40vh` fed back into itself: the parent sizes the iframe
 *    from the content height the frame reports, so a taller frame made taller
 *    padding made a taller frame. Measured at 5881px tall with ~1500px of
 *    trailing blank; 2248px after pinning the gutter.
 */
const SOURCE = readFileSync(
  path.resolve(__dirname, '../../../../../preview-template/src/components/SqPostView.astro'),
  'utf-8',
);

const gridRule = SOURCE.match(/\.sq-post-grid \{[\s\S]*?\}/)?.[0] ?? '';

describe('SqPostView post-body stylesheet', () => {
  it('resets media to the column width — the site stylesheet never loads here', () => {
    expect(SOURCE).toMatch(/\.sq-post-grid img[\s\S]*?max-width:\s*100%/);
  });

  it('lets a grid child shrink below its content', () => {
    expect(SOURCE).toMatch(/\.sq-post-grid > \*[^}]*min-width:\s*0/);
  });

  it('sizes the bottom gutter in a fixed unit, never vh', () => {
    expect(gridRule).not.toBe('');
    expect(gridRule).not.toMatch(/padding:[^;]*\dvh/);
  });

  it('implements the width contract: col-span rules + see-through tagging wrapper', () => {
    // The editor's width modes write col-span-N wrappers; without these rules
    // the preview surface silently ignores them (simplify review, 2026-08-10).
    expect(SOURCE).toContain('.sq-post-grid .col-span-12 { grid-column: 1 / span 12; }');
    expect(SOURCE).toContain('.sq-post-grid .col-span-full');
    expect(SOURCE).toContain('[data-sq-block] { display: contents; }');
  });
});
