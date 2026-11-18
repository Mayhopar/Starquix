import { describe, it, expect } from 'vitest';
import { resolveDeleteTarget } from '../resolveDeleteTarget';

const PAGE_TPL_SRC = 'library/BlogPost.astro';
const ctaSrc = 'library/CTA.astro';
const headerSrc = 'library/Header.astro';

describe('resolveDeleteTarget', () => {
  // Rendered BlogPost HTML: an inlined <Header />'s <header>, a page-template
  // <div>, and an inlined <CTA />'s <section> followed by a second <CTA />.
  const html = `
    <header data-sq-component-src="${headerSrc}" data-key="el-1:header-0">
      <a data-key="el-1:a-0">Features</a>
    </header>
    <div data-key="el-1:div-0"></div>
    <section data-sq-component-src="${ctaSrc}" data-key="el-1:section-0">
      <h2 data-key="el-1:h2-0">Sign up</h2>
    </section>
    <section data-sq-component-src="${ctaSrc}" data-key="el-1:section-1">
      <h2 data-key="el-1:h2-1">Sign up again</h2>
    </section>
  `;

  it('returns the page-template selector unchanged for a page-template-native tag (case 2)', () => {
    expect(resolveDeleteTarget(html, 'div-0', PAGE_TPL_SRC)).toEqual({
      kind: 'page-template',
      sourceSelector: 'div-0',
    });
  });

  it('translates a subRoot selector to <componentName>-<perComponentIdx> against the page-template (case 1)', () => {
    expect(resolveDeleteTarget(html, 'section-0', PAGE_TPL_SRC)).toEqual({
      kind: 'page-template',
      sourceSelector: 'cta-0',
    });
    expect(resolveDeleteTarget(html, 'section-1', PAGE_TPL_SRC)).toEqual({
      kind: 'page-template',
      sourceSelector: 'cta-1',
    });
  });

  it('indexes subRoots per-componentSrc, ignoring other component tags of the same DOM tag', () => {
    // header-0 is the only <header data-sq-component-src> in the DOM — its
    // perComponentIdx among Header subRoots is 0.
    expect(resolveDeleteTarget(html, 'header-0', PAGE_TPL_SRC)).toEqual({
      kind: 'page-template',
      sourceSelector: 'header-0',
    });
  });

  it('rejects a mid-tree tag inside an inlined component (case 3)', () => {
    expect(resolveDeleteTarget(html, 'h2-0', PAGE_TPL_SRC)).toEqual({
      kind: 'reject',
      reason: 'inside-component',
      componentSrc: ctaSrc,
    });
    // a-0 lives inside the Header subRoot — also rejected.
    expect(resolveDeleteTarget(html, 'a-0', PAGE_TPL_SRC)).toEqual({
      kind: 'reject',
      reason: 'inside-component',
      componentSrc: headerSrc,
    });
  });

  it('rejects a stale selector that cannot be located (case "not-found")', () => {
    expect(resolveDeleteTarget(html, 'p-9', PAGE_TPL_SRC)).toEqual({
      kind: 'reject',
      reason: 'not-found',
    });
  });

  it('rejects a syntactically malformed selector as not-found', () => {
    expect(resolveDeleteTarget(html, 'not-a-real-selector', PAGE_TPL_SRC)).toEqual({
      kind: 'reject',
      reason: 'not-found',
    });
  });
});

describe('resolveDeleteTarget — sq-child placements (task-098)', () => {
  // Regression: deleting a placement child was skipped as not-found — the
  // editor markup carries the placeholder, not the inlined component tag,
  // so the deleted Footer resurrected from source on the next open.
  it('routes a placement selector to the page template', () => {
    const html = `<layout class="bg-white"><slot ></slot><sq-child data-sq-astro-source="library/Footer.astro" data-sq-placement="footer-0"></sq-child></layout>`;
    expect(resolveDeleteTarget(html, 'footer-0', 'library/BlogPost.astro')).toEqual({
      kind: 'page-template',
      sourceSelector: 'footer-0',
    });
  });
});
