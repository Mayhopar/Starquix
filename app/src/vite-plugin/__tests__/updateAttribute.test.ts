/**
 * updateAttribute — generic, targeted attribute set/replace/remove on the
 * element at a resolved source position. Backs the layout-editor slot-name
 * write-back: it must edit ONLY the target tag and leave frontmatter, imports,
 * and surrounding markup untouched (backwards-compat with arbitrary .astro).
 */
import { describe, it, expect } from 'vitest';
import { mapKeyToPosition } from '../key-to-position';
import { updateAttribute } from '../ast-updater';

const FILE = '/x/Layout.astro';

async function setSlotName(src: string, selector: string, value: string): Promise<string> {
  const pos = await mapKeyToPosition(src, selector);
  if (!pos) throw new Error(`selector ${selector} not found`);
  return updateAttribute(src, FILE, { file: FILE, ...pos }, 'name', value);
}

describe('updateAttribute', () => {
  it('adds a name to a default slot', async () => {
    const src = '---\nconst x = 1;\n---\n<div>\n  <slot />\n</div>';
    const out = await setSlotName(src, 'slot-0', 'header');
    expect(out).toContain('<slot name="header" />');
    // frontmatter + wrapper preserved
    expect(out).toContain('const x = 1;');
    expect(out).toContain('<div>');
  });

  it('replaces an existing name', async () => {
    const src = '<div>\n  <slot name="old" />\n</div>';
    const out = await setSlotName(src, 'slot-0', 'main');
    expect(out).toContain('<slot name="main" />');
    expect(out).not.toContain('old');
  });

  it('removes the name when cleared (back to default slot), tidily', async () => {
    const src = '<div>\n  <slot name="header" />\n</div>';
    const out = await setSlotName(src, 'slot-0', '');
    expect(out).toContain('<slot />');
    expect(out).not.toContain('name=');
    expect(out).not.toContain('<slot  />'); // no double space left behind
  });

  it('treats a whitespace-only value as removal', async () => {
    const src = '<div>\n  <slot name="header" />\n</div>';
    const out = await setSlotName(src, 'slot-0', '   ');
    expect(out).toContain('<slot />');
  });

  it('only edits the targeted slot when multiple slots exist', async () => {
    const src = '<div>\n  <slot name="header" />\n  <slot />\n  <slot name="footer" />\n</div>';
    const out = await setSlotName(src, 'slot-1', 'main');
    expect(out).toContain('<slot name="header" />');
    expect(out).toContain('<slot name="main" />');
    expect(out).toContain('<slot name="footer" />');
  });

  it('works on a non-self-closing slot tag', async () => {
    const src = '<div>\n  <slot>fallback</slot>\n</div>';
    const out = await setSlotName(src, 'slot-0', 'header');
    expect(out).toContain('<slot name="header">fallback</slot>');
  });

  it('replaces a JSX-expression attribute value with a literal', async () => {
    const src = '<div>\n  <slot name={dynamic} />\n</div>';
    const out = await setSlotName(src, 'slot-0', 'header');
    expect(out).toContain('<slot name="header" />');
    expect(out).not.toContain('{dynamic}');
  });

  it('preserves CRLF line endings', async () => {
    const src = '<div>\r\n  <slot />\r\n</div>';
    const out = await setSlotName(src, 'slot-0', 'header');
    expect(out).toContain('\r\n');
    expect(out).toContain('<slot name="header" />');
  });
});
