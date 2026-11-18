import { describe, it, expect } from 'vitest';
import { applyWriteBackOverrides } from '../write-back-apply';

/**
 * Full-document layout drawn bake (2026-08-26, proven defect): the top-level
 * drawnReconcile insert anchored at the file's LAST closing tag — for a
 * layout .astro that is </html>, stranding the element AFTER </body>. It must
 * land INSIDE the body (before </body>) so baked layout chrome is real body
 * markup on every page using the layout.
 */

const LAYOUT_FILE = `---
const { title = 't' } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <title>{title}</title>
  </head>
  <body class="min-h-screen bg-white">
    <slot class="bg-white" />
</body>
</html>
`;

const DRAWN = '<div class="fixed top-3 left-3 w-24 h-24 bg-red-500" data-sq-drawn="drawn-1"></div>';

describe('write-back drawnReconcile — full-document layout anchors inside <body>', () => {
  it('inserts the top-level drawn element BEFORE </body>, not after it', async () => {
    const res = await applyWriteBackOverrides(LAYOUT_FILE, 'layouts/Layout.astro', {
      drawnReconcile: [{ markup: DRAWN }],
    });
    if (!res.ok) throw new Error('refused');
    expect(res.report.applied.drawn).toBe(1);
    const drawnIdx = res.content.indexOf('data-sq-drawn');
    expect(drawnIdx).toBeGreaterThan(-1);
    expect(drawnIdx).toBeLessThan(res.content.indexOf('</body>'));
    expect(drawnIdx).toBeGreaterThan(res.content.indexOf('<slot'));
  });

  it('reconcile is idempotent and delete-to-zero strips the baked copy', async () => {
    const first = await applyWriteBackOverrides(LAYOUT_FILE, 'layouts/Layout.astro', {
      drawnReconcile: [{ markup: DRAWN }],
    });
    if (!first.ok) throw new Error('refused');
    const second = await applyWriteBackOverrides(first.content, 'layouts/Layout.astro', {
      drawnReconcile: [{ markup: DRAWN }],
    });
    if (!second.ok) throw new Error('refused');
    expect(second.content).toBe(first.content);
    expect(second.changed).toBe(false);

    const stripped = await applyWriteBackOverrides(first.content, 'layouts/Layout.astro', {
      drawnReconcile: [],
    });
    if (!stripped.ok) throw new Error('refused');
    expect(stripped.content).not.toContain('data-sq-drawn');
  });

  it('component files (no <body>) keep the last-closing-tag anchor', async () => {
    const comp = `<section class="hero">\n  <h1>Hi</h1>\n</section>\n`;
    const res = await applyWriteBackOverrides(comp, 'library/Hero.astro', {
      drawnReconcile: [{ markup: DRAWN }],
    });
    if (!res.ok) throw new Error('refused');
    expect(res.content.indexOf('data-sq-drawn')).toBeLessThan(res.content.indexOf('</section>'));
  });
});
