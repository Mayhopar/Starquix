// task-248 P2 (owner D2): site-wide tags go into every head of the project as one batch.
import { describe, it, expect } from 'vitest';
import { readSiteHead, editSiteHead } from '../headSeo';

const OWN = '<html lang="en">\n  <head>\n    <title>Home</title>\n  </head>\n  <body></body>\n</html>\n';
const LAYOUT = `---\nconst { title } = Astro.props;\n---\n<html lang="en">\n\t<head>\n\t\t<title>{title}</title>\n\t\t<link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n\t</head>\n\t<body><slot /></body>\n</html>\n`;
const ABOUT = "---\nimport L from '../layouts/Main.astro';\n---\n<L title=\"About\"><p/></L>\n";
const BLOG = ABOUT.replace('About', 'Blog');
const S = { 'src/pages/index.astro': OWN, 'src/pages/about.astro': ABOUT, 'src/pages/blog.astro': BLOG, 'src/layouts/Main.astro': LAYOUT };
const PAGES = ['src/pages/index.astro', 'src/pages/about.astro', 'src/pages/blog.astro'];

describe('site head', () => {
  it('reads values across heads; a head without the tag makes it mixed', () => {
    const st = readSiteHead(S, PAGES);
    expect(st.lang).toEqual({ value: 'en', mixed: false, fixedIn: [] });
    expect(st.favicon).toMatchObject({ value: '/favicon.svg', mixed: true });
  });
  it('a favicon goes into every head once (layout updated in place, page head gets one), type follows the file', () => {
    const out = editSiteHead(S, PAGES, 'favicon', '/uploads/icon.png');
    expect(Object.keys(out).sort()).toEqual(['src/layouts/Main.astro', 'src/pages/index.astro']);
    expect(out['src/layouts/Main.astro']).toContain('<link rel="icon" type="image/png" href="/uploads/icon.png" />');
    expect(out['src/pages/index.astro']).toContain('    <title>Home</title>\n    <link rel="icon" href="/uploads/icon.png" type="image/png" />\n  </head>');
    expect(readSiteHead({ ...S, ...out }, PAGES).favicon).toMatchObject({ value: '/uploads/icon.png', mixed: false });
  });
  it('language sets <html lang> in every head', () => {
    const out = editSiteHead(S, PAGES, 'lang', 'de');
    expect(out['src/pages/index.astro']).toContain('<html lang="de">');
    expect(out['src/layouts/Main.astro']).toContain('<html lang="de">');
    expect(() => editSiteHead(S, PAGES, 'lang', 'German')).toThrow(/code/);
  });
  it('site name and X handle are inserted, then cleared back to the original bytes', () => {
    const on = { ...S, ...editSiteHead(S, PAGES, 'siteName', 'Acme') };
    expect(on['src/layouts/Main.astro']).toContain('<meta property="og:site_name" content="Acme" />');
    const off = { ...on, ...editSiteHead(on, PAGES, 'siteName', '') };
    expect(off['src/layouts/Main.astro']).toBe(LAYOUT);
    expect(off['src/pages/index.astro']).toBe(OWN);
  });
  it('a value set by code is left alone and reported', () => {
    const L2 = LAYOUT.replace('href="/favicon.svg"', 'href={icon}');
    const s = { ...S, 'src/layouts/Main.astro': L2 };
    expect(readSiteHead(s, PAGES).favicon.fixedIn).toEqual(['src/layouts/Main.astro']);
    expect(Object.keys(editSiteHead(s, PAGES, 'favicon', '/x.png'))).toEqual(['src/pages/index.astro']);
  });
});
