import { describe, it, expect } from 'vitest';
import { mapKeyToPosition } from './key-to-position';

const SAMPLE_ASTRO = `---
/**
 * @category Hero
 */
---
<section class="hero">
  <h1>Title</h1>
  <p>Description</p>
  <div>
    <p>Nested paragraph</p>
  </div>
</section>`;

describe('mapKeyToPosition', () => {
  it('maps section-0 to the first section element', async () => {
    const pos = await mapKeyToPosition(SAMPLE_ASTRO, 'section-0');
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(6); // Line 6 is <section>
    expect(pos!.column).toBe(1);
  });

  it('maps h1-0 to the first h1 element', async () => {
    const pos = await mapKeyToPosition(SAMPLE_ASTRO, 'h1-0');
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(7);
  });

  it('maps p-0 to the first p element', async () => {
    const pos = await mapKeyToPosition(SAMPLE_ASTRO, 'p-0');
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(8);
  });

  it('maps p-1 to the second p element (nested)', async () => {
    const pos = await mapKeyToPosition(SAMPLE_ASTRO, 'p-1');
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(10);
  });

  it('returns null for non-existent selector', async () => {
    const pos = await mapKeyToPosition(SAMPLE_ASTRO, 'span-0');
    expect(pos).toBeNull();
  });

  // Regression: reordering Header/slot/Footer inside BlogPost.astro silently
  // no-op'd because `<Header />` and `<Footer />` parse as `type === 'component'`
  // nodes in the Astro AST (PascalCase component refs), while `<slot />` parses
  // as `type === 'element'`. The reorder branch in the write-back endpoint
  // requires ALL selectors to resolve, so header-0/footer-0 returning null
  // caused the whole reorder to be skipped — the file stayed unchanged even
  // though the write-back call returned OK.
  it('resolves PascalCase component references (Header, Footer) the same as lowercase elements', async () => {
    const BLOG_POST_ASTRO = `---
import Layout from '../../layouts/Layout.astro';
import Header from './Header.astro';
import Footer from './Footer.astro';
---
<Layout>
  <Header />
  <slot />
  <Footer />
</Layout>`;

    const header = await mapKeyToPosition(BLOG_POST_ASTRO, 'header-0');
    const slot = await mapKeyToPosition(BLOG_POST_ASTRO, 'slot-0');
    const footer = await mapKeyToPosition(BLOG_POST_ASTRO, 'footer-0');
    const layout = await mapKeyToPosition(BLOG_POST_ASTRO, 'layout-0');

    expect(header).not.toBeNull();
    expect(slot).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(layout).not.toBeNull();

    expect(header!.line).toBe(7);
    expect(slot!.line).toBe(8);
    expect(footer!.line).toBe(9);
    expect(layout!.line).toBe(6);
  });
});
