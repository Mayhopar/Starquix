import { describe, it, expect } from 'vitest';
import { expandComponentTags, resolveCanvasHtml, inlineTopLevelLayout } from '../canvasHtml';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

function mkLib(name: string, path: string, html: string): ScannedComponent {
  return {
    name, path, source: 'built-in',
    html, category: '', props: [], slots: [], dependencies: [],
  };
}

describe('expandComponentTags + source markers', () => {
  it('injects data-sq-component-src on the inlined body\'s outer tag', () => {
    const library = [mkLib('Header', 'library/Header.astro', '<header class="x"><a>hi</a></header>')];
    const out = expandComponentTags('<Header />', library);
    expect(out).toMatch(/<header[^>]*data-sq-component-src="library\/Header\.astro"[^>]*class="x"/);
    expect(out).toContain('<a>hi</a>');
  });

  it('marks each top-level sibling when the body has fragmented roots', () => {
    const library = [mkLib('Footer', 'library/Footer.astro', '<footer>a</footer><nav>b</nav>')];
    const out = expandComponentTags('<Footer />', library);
    const matches = out.match(/data-sq-component-src="library\/Footer\.astro"/g) || [];
    expect(matches.length).toBe(2);
  });

  it('leaves the page-template\'s own tags untouched', () => {
    const library = [mkLib('Header', 'library/Header.astro', '<header>h</header>')];
    const out = expandComponentTags('<div><Header /></div>', library);
    expect(out).not.toMatch(/<div[^>]*data-sq-component-src/);
    expect(out).toMatch(/<header[^>]*data-sq-component-src="library\/Header\.astro"/);
  });

  it('is idempotent on already-marked HTML (no double-marking)', () => {
    const library = [mkLib('Header', 'library/Header.astro', '<header data-sq-component-src="library/Header.astro">h</header>')];
    const out = expandComponentTags('<Header />', library);
    const matches = out.match(/data-sq-component-src="library\/Header\.astro"/g) || [];
    expect(matches.length).toBe(1);
  });

  it('survives addDataKeysToHtml downstream (attributes preserved)', async () => {
    const { addDataKeysToHtml } = await import('@/store/constants');
    const library = [mkLib('Header', 'library/Header.astro', '<header><a>hi</a></header>')];
    const expanded = expandComponentTags('<Header />', library);
    const stamped = addDataKeysToHtml(expanded, (sel) => `el-1:${sel}`);
    expect(stamped).toMatch(/<header[^>]*data-sq-component-src="library\/Header\.astro"/);
    expect(stamped).toMatch(/data-key="el-1:header-0"/);
  });

  // Regression: BlogPost.astro uses `<Layout><Header /><slot /><Footer /></Layout>`.
  // Layout is NOT in the component library (it lives under preview-template/src/layouts/
  // and is scanned by a separate endpoint), so the wrapper tag should be left intact
  // and the inner Header/Footer should expand. The whole point is that the editor
  // canvas renders Header + slot + Footer chrome around the article — which it doesn't
  // today when this case breaks.
  it('expands inner Header/Footer when wrapped in an unknown paired tag (Layout case)', () => {
    const library = [
      mkLib('Header', 'library/Header.astro', '<header class="hdr">H</header>'),
      mkLib('Footer', 'library/Footer.astro', '<footer class="ftr">F</footer>'),
    ];
    const src = '<Layout>\n  <Header />\n  <slot />\n  <Footer />\n</Layout>';
    const out = expandComponentTags(src, library);
    // Header and Footer must be inlined with source markers.
    expect(out).toMatch(/<header[^>]*data-sq-component-src="library\/Header\.astro"[^>]*class="hdr"/);
    expect(out).toMatch(/<footer[^>]*data-sq-component-src="library\/Footer\.astro"[^>]*class="ftr"/);
    // The slot tag stays for downstream `normalizeSelfClosingSlots`.
    expect(out).toContain('<slot />');
  });
});

describe('inlineTopLevelLayout', () => {
  it('rewrites <Layout>…</Layout> as a <layout> tag with default class when source has none', () => {
    const src = '<Layout>\n  <Header />\n  <slot />\n  <Footer />\n</Layout>';
    const out = inlineTopLevelLayout(src);
    expect(out).toMatch(/^<layout\b/);
    expect(out).toMatch(/class="bg-white"/);
    expect(out).not.toMatch(/min-h-screen/);
    // No data-sq-component-src on the wrapper — Layout-class edits route to the
    // page-template source (BlogPost.astro), not Layout.astro.
    expect(out).not.toMatch(/data-sq-component-src/);
    expect(out).toContain('<Header />');
    expect(out).toContain('<slot />');
    expect(out).toContain('<Footer />');
    expect(out).toMatch(/<\/layout>$/);
    // The case-mixed source <Layout>/<Layout> must NOT survive.
    expect(out).not.toMatch(/<Layout\b/);
    expect(out).not.toMatch(/<\/Layout>/);
  });

  it('carries an existing class attribute from <Layout class="…"> through to the wrapper', () => {
    const src = '<Layout class="bg-stone-50 p-8"><Header /></Layout>';
    const out = inlineTopLevelLayout(src);
    expect(out).toMatch(/class="bg-stone-50 p-8"/);
    expect(out).not.toMatch(/class="bg-white"/);
  });

  it('drops non-class attrs (Astro props are build-time inputs, not DOM)', () => {
    const src = '<Layout title="X">  <slot />  </Layout>';
    const out = inlineTopLevelLayout(src);
    expect(out).toMatch(/^<layout\b/);
    expect(out).not.toMatch(/title="X"/);
    expect(out).toContain('<slot />');
  });

  it('is a no-op when no top-level Layout', () => {
    const src = '<div><Header /></div>';
    expect(inlineTopLevelLayout(src)).toBe(src);
  });

  it('preserves content when Layout is nested mid-stream (only top-level rewritten)', () => {
    const src = '<div><Layout><Header /></Layout></div>';
    expect(inlineTopLevelLayout(src)).toBe(src);
  });
});

describe('resolveCanvasHtml — BlogPost end-to-end', () => {
  // The actual on-disk BlogPost.astro form. After the full pipeline the iframe
  // should receive a <layout> wrapping Header (marked → routes to Header.astro),
  // slot, and Footer (marked → routes to Footer.astro). The wrapper itself
  // carries NO source marker — class edits on it route to BlogPost.astro's
  // `<Layout>` opener via the lowercase tag-name match in mapKeysToPositions.
  it('produces a <layout> wrapping Header → slot → Footer for BlogPost source', () => {
    const library = [
      mkLib('Header', 'library/Header.astro', '<header class="hdr">H</header>'),
      mkLib('Footer', 'library/Footer.astro', '<footer class="ftr">F</footer>'),
    ];
    const blogPostSrc = `---
import Layout from '../../layouts/Layout.astro';
import Header from './Header.astro';
import Footer from './Footer.astro';
---
<Layout>
  <Header />
  <slot />
  <Footer />
</Layout>`;
    const out = resolveCanvasHtml(blogPostSrc, library);
    expect(out).not.toMatch(/<Layout\b/);
    expect(out).not.toMatch(/<\/Layout>/);
    expect(out).toMatch(/<layout[^>]*class="bg-white"/);
    // No marker on the wrapper.
    expect(out).not.toMatch(/<layout[^>]*data-sq-component-src/);
    // Sub-component markers must still be present so Header/Footer edits route
    // to their own sources.
    expect(out).toMatch(/<header[^>]*data-sq-component-src="library\/Header\.astro"/);
    expect(out).toMatch(/<footer[^>]*data-sq-component-src="library\/Footer\.astro"/);
    expect(out).toMatch(/<slot\b[^>]*><\/slot>/);
  });

  it('carries user-edited class on <Layout> through the pipeline (persistence on re-open)', () => {
    const library = [
      mkLib('Header', 'library/Header.astro', '<header>H</header>'),
      mkLib('Footer', 'library/Footer.astro', '<footer>F</footer>'),
    ];
    const blogPostSrc = `---
import Layout from '../../layouts/Layout.astro';
---
<Layout class="bg-stone-50 p-12"><Header /><slot /><Footer /></Layout>`;
    const out = resolveCanvasHtml(blogPostSrc, library);
    expect(out).toMatch(/<layout[^>]*class="bg-stone-50 p-12"/);
    expect(out).not.toMatch(/class="bg-white"/);
  });
});
