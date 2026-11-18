// The component view's backdrop is a per-component editor note in the
// component file (`@sq-backdrop #hex`) — set from the Design panel with
// nothing selected (owner 2026-10-10). It never changes how the site renders.
import { describe, expect, it } from 'vitest';
import { readBackdrop, setBackdrop } from '../../../../preview-template/src/plugins/sq-backdrop.js';

const HEADED = `---\n/**\n * @category Blog\n * @name BlogCard\n */\nconst { post } = Astro.props;\n---\n<article />\n`;
const PLAIN = `---\nconst { post } = Astro.props;\n---\n<article />\n`;

describe('component backdrop note', () => {
  it('goes after the @name line of a header comment; read back; replaced in place; removed', () => {
    const on = setBackdrop(HEADED, '#111827');
    expect(on).toContain(' * @name BlogCard\n * @sq-backdrop #111827\n */');
    expect(readBackdrop(on)).toBe('#111827');
    const changed = setBackdrop(on, '#ffffff');
    expect(readBackdrop(changed)).toBe('#ffffff');
    expect(changed.match(/@sq-backdrop/g)).toHaveLength(1);
    expect(setBackdrop(changed, null)).toBe(HEADED);
  });

  it('no header comment → a // line opens the frontmatter; no frontmatter → one is added', () => {
    expect(setBackdrop(PLAIN, '#000000')).toBe(`---\n// @sq-backdrop #000000\nconst { post } = Astro.props;\n---\n<article />\n`);
    expect(setBackdrop('<div />\n', '#000000')).toBe(`---\n// @sq-backdrop #000000\n---\n<div />\n`);
    expect(setBackdrop(PLAIN, null)).toBe(PLAIN);
  });

  it('only hex colors are honoured (the view writes it into CSS)', () => {
    expect(readBackdrop(PLAIN)).toBeNull();
    expect(readBackdrop(`---\n// @sq-backdrop red;}body{x\n---\n`)).toBeNull();
    expect(() => setBackdrop(PLAIN, 'red;}')).toThrow();
  });
});
