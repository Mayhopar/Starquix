import { describe, it, expect } from 'vitest';
import { translateChildKeysToSourceSelectors } from '../translateChildKeysToSourceSelectors';

describe('translateChildKeysToSourceSelectors', () => {
  it('returns rendered selector when child has no componentSrc', () => {
    const childKeys = ['inst:header-0', 'inst:footer-0'];
    const out = translateChildKeysToSourceSelectors(childKeys, [
      { key: 'inst:header-0' },
      { key: 'inst:footer-0' },
    ]);
    expect(out).toEqual(['header-0', 'footer-0']);
  });

  it('translates expanded sub-component renders to component-tag selectors', () => {
    // BlogPost.astro contains <Header />, <slot />, <Footer />, <CTA />.
    // CTA renders to <section data-sq-component-src="library/CTA.astro">.
    const childKeys = ['inst:header-0', 'inst:slot-0', 'inst:footer-0', 'inst:section-0'];
    const out = translateChildKeysToSourceSelectors(childKeys, [
      { key: 'inst:header-0', componentSrc: 'library/Header.astro' },
      { key: 'inst:slot-0' },
      { key: 'inst:footer-0', componentSrc: 'library/Footer.astro' },
      { key: 'inst:section-0', componentSrc: 'library/CTA.astro' },
    ]);
    expect(out).toEqual(['header-0', 'slot-0', 'footer-0', 'cta-0']);
  });

  it('indexes multiple instances of the same component independently per name', () => {
    const childKeys = ['inst:section-0', 'inst:section-1', 'inst:section-2'];
    const out = translateChildKeysToSourceSelectors(childKeys, [
      { key: 'inst:section-0', componentSrc: 'library/CTA.astro' },
      { key: 'inst:section-1', componentSrc: 'library/Feature.astro' },
      { key: 'inst:section-2', componentSrc: 'library/CTA.astro' },
    ]);
    expect(out).toEqual(['cta-0', 'feature-0', 'cta-1']);
  });

  it('preserves user-given order when assigning per-component indices', () => {
    // After a drag, the user moves the second CTA before the first. The
    // translated selectors must reflect the NEW order so the source rewrite
    // produces `<CTA />, <CTA />` matching what the editor shows.
    const childKeys = ['inst:section-1', 'inst:section-0'];
    const out = translateChildKeysToSourceSelectors(childKeys, [
      { key: 'inst:section-0', componentSrc: 'library/CTA.astro' },
      { key: 'inst:section-1', componentSrc: 'library/CTA.astro' },
    ]);
    expect(out).toEqual(['cta-0', 'cta-1']);
  });

  it('handles unknown childKeys (not in scanned set) by parsing the rendered selector', () => {
    const childKeys = ['inst:header-0'];
    const out = translateChildKeysToSourceSelectors(childKeys, []);
    expect(out).toEqual(['header-0']);
  });

  it('reindexes plain-tag children within the child set, ignoring rendered-DOM index inflation', () => {
    // BlogPost.astro source: <Header /><CTA /><div>extra</div><Footer />
    // CTA expands to <section> that itself contains a <div>. The bridge scan
    // assigns the INNER div as data-key div-0 (it's first in DOM order) and
    // the literal <div>extra</div> as div-1.
    //
    // childOrders for parentKey=instanceRoot only includes top-level rendered
    // children. The inner CTA <div> sits under parentKey=inst:section-0, so it
    // is NOT in this child set. The top-level child set is:
    //   header-0, section-0 (CTA), div-1 (extra), footer-0
    //
    // The parent BlogPost.astro AST only has ONE <div> tag (the extra one),
    // indexed div-0 server-side. Passing the rendered "div-1" through would
    // hit a null resolution and the reorder would partial-skip that child.
    //
    // The translator must re-index per-tag within the child set so the
    // extra <div> becomes "div-0" — matching the parent source AST count.
    const childKeys = ['inst:header-0', 'inst:section-0', 'inst:div-1', 'inst:footer-0'];
    const out = translateChildKeysToSourceSelectors(childKeys, [
      { key: 'inst:header-0', componentSrc: 'library/Header.astro' },
      { key: 'inst:section-0', componentSrc: 'library/CTA.astro' },
      { key: 'inst:div-1' },
      { key: 'inst:footer-0', componentSrc: 'library/Footer.astro' },
    ]);
    expect(out).toEqual(['header-0', 'cta-0', 'div-0', 'footer-0']);
  });

  it('per-tag index for plain-tag children counts only within the child set, not the parsed render index', () => {
    // Source: <main><p>a</p><p>b</p></main>. Reorder is at parentKey=inst:main-0.
    // Render keys for those two <p>'s are p-0 and p-1 — same as source — so
    // the trivial case works. But if there's a preceding sibling component
    // whose expansion contains a <p>, the rendered index inflates.
    //
    // Top-level children of an instance: <Header />, <main>, where <Header />
    // expands to contain a <p>. Now <main>'s rendered key is still main-0.
    // Drilling into childOrders for parentKey=inst:main-0: two <p>'s with
    // rendered keys p-1 and p-2 (since Header's inner <p> is p-0).
    //
    // After translation, those should become p-0 and p-1 (per-tag within
    // the child set), matching the AST count when the server parses
    // <main>'s parent file.
    const childKeys = ['inst:main-0:p-1', 'inst:main-0:p-2'];
    const out = translateChildKeysToSourceSelectors(childKeys, [
      { key: 'inst:main-0:p-1' },
      { key: 'inst:main-0:p-2' },
    ]);
    expect(out).toEqual(['p-0', 'p-1']);
  });
});
