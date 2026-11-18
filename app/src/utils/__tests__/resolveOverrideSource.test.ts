import { describe, it, expect } from 'vitest';
import { resolveOverrideSource } from '../resolveOverrideSource';

const PAGE_TPL_SRC = 'library/BlogPost.astro';

describe('resolveOverrideSource', () => {
  const headerSrc = 'library/Header.astro';
  const footerSrc = 'library/Footer.astro';

  // Resolved BlogPost HTML: <header> from Header (carrying marker),
  // followed by an in-page <div>, followed by <footer> from Footer.
  const html = `
    <header data-sq-component-src="${headerSrc}" data-key="el-1:header-0">
      <a data-key="el-1:a-0">Features</a>
      <a data-key="el-1:a-1">Pricing</a>
    </header>
    <div data-key="el-1:div-0"></div>
    <footer data-sq-component-src="${footerSrc}" data-key="el-1:footer-0">
      <a data-key="el-1:a-2">Privacy</a>
    </footer>
  `;

  it('returns the page-template source when the selector is not inside any sub-component', () => {
    const r = resolveOverrideSource(html, 'div-0', PAGE_TPL_SRC);
    expect(r).toEqual({ source: PAGE_TPL_SRC, subSelector: 'div-0' });
  });

  it('routes a tag inside Header to Header.astro with selector local to Header', () => {
    expect(resolveOverrideSource(html, 'a-0', PAGE_TPL_SRC)).toEqual({ source: headerSrc, subSelector: 'a-0' });
    expect(resolveOverrideSource(html, 'a-1', PAGE_TPL_SRC)).toEqual({ source: headerSrc, subSelector: 'a-1' });
  });

  it('routes a tag inside Footer to Footer.astro with selector recomputed local to Footer', () => {
    // a-2 in the resolved HTML is Footer's FIRST <a>, so subSelector = 'a-0'.
    expect(resolveOverrideSource(html, 'a-2', PAGE_TPL_SRC)).toEqual({ source: footerSrc, subSelector: 'a-0' });
  });

  it('matches by tag-N count within the sub-component boundary, not by document position', () => {
    const headerSrc2 = 'library/Header2.astro';
    const nested = `
      <header data-sq-component-src="${headerSrc2}" data-key="el-1:header-0">
        <div data-key="el-1:div-0"><a data-key="el-1:a-0">x</a></div>
        <a data-key="el-1:a-1">y</a>
      </header>
    `;
    // a-1 in the global count maps to the second <a> in Header2 → subSelector = 'a-1'.
    expect(resolveOverrideSource(nested, 'a-1', PAGE_TPL_SRC)).toEqual({ source: headerSrc2, subSelector: 'a-1' });
  });

  it('returns page-template source if the tag cannot be located', () => {
    const r = resolveOverrideSource(html, 'p-9', PAGE_TPL_SRC);
    expect(r).toEqual({ source: PAGE_TPL_SRC, subSelector: 'p-9' });
  });
});
