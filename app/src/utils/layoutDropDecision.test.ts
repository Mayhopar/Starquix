import { describe, it, expect } from 'vitest';
import { resolveLayoutDrop } from './layoutDropDecision';

// Regression: dropping a DIFFERENT layout onto a page that already has a layout
// (a "replace") must ALWAYS ask for confirmation. The original bug gated the
// confirm on Yjs rootElementIds being non-empty, but in browser/dev mode those
// can be empty even on a page with visible content — so the replace silently
// swapped the layout (chip updated) with no popup.
describe('resolveLayoutDrop', () => {
  it('re-dropping the already-applied layout is a no-op', () => {
    const d = resolveLayoutDrop({ currentLayout: 'Marketing', layoutName: 'Marketing', hasContent: true });
    expect(d.kind).toBe('noop');
  });

  it('REPLACING a layout always confirms — even when content detection reports empty', () => {
    const d = resolveLayoutDrop({ currentLayout: 'Layout', layoutName: 'Marketing', hasContent: false });
    expect(d.kind).toBe('confirm');
    if (d.kind === 'confirm') expect(d.message).toMatch(/Replace layout "Layout" with "Marketing"/);
  });

  it('REPLACING a layout confirms when content is present too', () => {
    const d = resolveLayoutDrop({ currentLayout: 'Layout', layoutName: 'Marketing', hasContent: true });
    expect(d.kind).toBe('confirm');
  });

  it('first apply onto a page WITH content confirms (content moves into the slot)', () => {
    const d = resolveLayoutDrop({ currentLayout: null, layoutName: 'Marketing', hasContent: true });
    expect(d.kind).toBe('confirm');
    if (d.kind === 'confirm') expect(d.message).toMatch(/Apply layout "Marketing"/);
  });

  it('first apply onto a truly EMPTY, layout-less page applies silently', () => {
    const d = resolveLayoutDrop({ currentLayout: null, layoutName: 'Marketing', hasContent: false });
    expect(d.kind).toBe('apply');
  });
});
