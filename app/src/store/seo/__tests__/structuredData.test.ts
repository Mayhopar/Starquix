// task-248: JSON-LD lives in the page file (head, else inside its layout tag); post routes get a per-post BlogPosting.
import { describe, it, expect } from 'vitest';
import { readStructuredData, editStructuredData, normalizeJsonLd } from '../headSeo';

const OWN = '<html lang="en">\n  <head>\n    <title>Home</title>\n  </head>\n  <body></body>\n</html>\n';
const LAYOUT = `---\nconst { title } = Astro.props;\n---\n<html><head><title>{title}</title></head><body><slot /></body></html>`;
const ABOUT = "---\nimport L from '../layouts/Main.astro';\n---\n<L title=\"About\">\n  <p>Hi</p>\n</L>\n";
const ORG = '{"@context":"https://schema.org","@type":"Organization","name":"Acme </script>"}';

describe('structured data', () => {
  it('goes into the page head, reads back, edits in place, clears to the original', () => {
    const S = { 'src/pages/index.astro': OWN };
    const a = { ...S, ...editStructuredData(S, 'src/pages/index.astro', ORG) };
    expect(a['src/pages/index.astro']).toContain('<script type="application/ld+json">\n{\n  "@context": "https://schema.org"');
    expect(a['src/pages/index.astro']).toContain('Acme <\\/script>');
    expect(JSON.parse(readStructuredData(a, 'src/pages/index.astro').value).name).toBe('Acme </script>');
    const b = { ...a, ...editStructuredData(a, 'src/pages/index.astro', '{"@type":"WebSite"}') };
    expect(JSON.parse(readStructuredData(b, 'src/pages/index.astro').value)).toEqual({ '@type': 'WebSite' });
    expect(editStructuredData(b, 'src/pages/index.astro', '')['src/pages/index.astro']).toBe(OWN);
  });
  it('a layout page gets it inside the layout tag', () => {
    const S = { 'src/pages/about.astro': ABOUT, 'src/layouts/Main.astro': LAYOUT };
    const out = editStructuredData(S, 'src/pages/about.astro', ORG);
    expect(Object.keys(out)).toEqual(['src/pages/about.astro']);
    expect(out['src/pages/about.astro']).toMatch(/<p>Hi<\/p>\n  <script type="application\/ld\+json">[\s\S]*<\/script>\n<\/L>/);
  });
  it('refuses invalid JSON', () => {
    expect(() => normalizeJsonLd('{nope')).toThrow(/not valid JSON/);
    expect(() => normalizeJsonLd('"text"')).toThrow(/object or array/);
  });
  it('a post route toggles a per-post BlogPosting built from post fields', () => {
    const ROUTE = "---\nimport P from '../../layouts/Main.astro';\nconst { post } = Astro.props;\n---\n<P title={post.data.title}><p/></P>\n";
    const S = { 'src/pages/blog/[slug].astro': ROUTE, 'src/layouts/Main.astro': LAYOUT };
    const on = { ...S, ...editStructuredData(S, 'src/pages/blog/[slug].astro', 'on', true) };
    expect(on['src/pages/blog/[slug].astro']).toContain("'@type': 'BlogPosting', headline: post.data.title");
    expect(readStructuredData(on, 'src/pages/blog/[slug].astro', true)).toMatchObject({ kind: 'posts', value: 'on' });
    expect(editStructuredData(on, 'src/pages/blog/[slug].astro', '', true)['src/pages/blog/[slug].astro']).toBe(ROUTE);
  });
});
