/**
 * orderPermutation: a PAGE-tree reorder of a layout's chrome can't name file
 * selectors — the slot renders as a div and a component renders as its root
 * tag, so the client's rendered selectors ("div-0") never resolve against the
 * file ("slot-0"). The client sends the new order as a permutation of the
 * body's top-level scannable tags; the server, which has the real AST,
 * translates it into the existing orderOverrides pipeline. Bug proven live
 * 2026-08-27: the page-tree reorder queued NOTHING and reset on rescan.
 */
import { describe, it, expect } from 'vitest';
import { applyWriteBackOverrides } from '../write-back-apply';

const FILE = '/fake/layouts/Layout1.astro';
// Mirrors the real fixture layout: slot first, a bridge script between the
// slot and the components — the script must neither count nor move.
const LAYOUT = `---
import Header from '../components/library/Header.astro';
import Footer from '../components/library/Footer.astro';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>t</title>
  </head>
  <body>
    <slot />
    <script is:inline src="/scripts/bridge.js"></script>
    <Footer />
    <Header />
</body>
</html>
`;

const order = (content: string, tags: string[]) => {
  const idx = tags.map((t) => content.indexOf(t));
  return idx.every((i, n) => i >= 0 && (n === 0 || i > idx[n - 1]));
};

describe('applyWriteBackOverrides — orderPermutation', () => {
  it('reorders the top-level scannable tags by position, leaving the script alone', async () => {
    // Scannable top-level order: [slot, Footer, Header]; perm [0,2,1] → slot, Header, Footer.
    const r = await applyWriteBackOverrides(LAYOUT, FILE, { orderPermutation: [0, 2, 1] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.changed).toBe(true);
    expect(r.report.applied.reordered).toBe(3);
    expect(order(r.content, ['<slot', '<Header', '<Footer'])).toBe(true);
    expect(r.content).toContain('bridge.js');
  });

  it('skips editor-infra components when counting positions', async () => {
    const src = LAYOUT.replace('<Footer />', '<SqHmrWriteBridge />\n    <Footer />');
    // Scannable top-level order is still [slot, Footer, Header].
    const r = await applyWriteBackOverrides(src, FILE, { orderPermutation: [0, 2, 1] });
    if (!r.ok) throw new Error('expected ok');
    expect(order(r.content, ['<slot', '<Header', '<Footer'])).toBe(true);
    expect(r.content).toContain('<SqHmrWriteBridge />');
  });

  it('records a length mismatch in skipped.reorder and changes nothing', async () => {
    const r = await applyWriteBackOverrides(LAYOUT, FILE, { orderPermutation: [0, 1] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.changed).toBe(false);
    expect(r.report.skipped.reorder).toEqual(['permutation:0,1']);
  });

  it('records an invalid permutation (dupe / out of range) and changes nothing', async () => {
    for (const bad of [[0, 0, 1], [0, 1, 3]]) {
      const r = await applyWriteBackOverrides(LAYOUT, FILE, { orderPermutation: bad });
      if (!r.ok) throw new Error('expected ok');
      expect(r.changed).toBe(false);
      expect(r.report.skipped.reorder).toEqual([`permutation:${bad.join(',')}`]);
    }
  });

  it('pairs rendered rows to file tags by selector, so a doc whose visual order diverged from the file still maps right', async () => {
    // Pre-fix docs carry stranded page childOrders: file is [slot, Footer,
    // Header] but the page RENDERS [slot(div), header, footer]. The user drags
    // footer above header — desired result [slot, Footer, Header], which the
    // file already has: the write must be a NO-OP, not a positional shuffle.
    const r = await applyWriteBackOverrides(LAYOUT, FILE, {
      orderPermutation: [0, 2, 1],
      orderRendered: ['div-0', 'header-0', 'footer-0'],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.changed).toBe(false);
    expect(order(r.content, ['<slot', '<Footer', '<Header'])).toBe(true);
  });

  it('pairs the slot-as-div leftover positionally while exact names pin the components', async () => {
    // Same diverged doc, dragging header above the slot: desired file order
    // [Header, slot, Footer].
    const r = await applyWriteBackOverrides(LAYOUT, FILE, {
      orderPermutation: [1, 0, 2],
      orderRendered: ['div-0', 'header-0', 'footer-0'],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.changed).toBe(true);
    expect(order(r.content, ['<Header', '<slot', '<Footer'])).toBe(true);
  });

  it('yields to explicit orderOverrides when both are present', async () => {
    const r = await applyWriteBackOverrides(LAYOUT, FILE, {
      orderOverrides: ['slot-0', 'header-0', 'footer-0'],
      orderPermutation: [2, 1, 0],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(order(r.content, ['<slot', '<Header', '<Footer'])).toBe(true);
  });
});
