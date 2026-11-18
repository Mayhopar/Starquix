import { describe, it, expect } from 'vitest';
import { generatePostPage, generateListingPage, generateJsonEndpoint, generateDetailPage } from './template-generator';

describe('generatePostPage', () => {
  const baseOpts = {
    collectionName: 'ger',
    layoutMarkup: '<article class="prose"><h1>Title</h1></article>',
    bindings: {},
  };

  it('wraps the user-designed markup in <BlogPost>...</BlogPost>', () => {
    const out = generatePostPage(baseOpts);
    expect(out).toContain('<BlogPost title={entry.data.title}>');
    expect(out).toContain('</BlogPost>');
    expect(out).toContain('<article class="prose"><h1>Title</h1></article>');
    // The article must sit inside BlogPost — not before its opening tag
    const openIdx = out.indexOf('<BlogPost');
    const articleIdx = out.indexOf('<article');
    const closeIdx = out.indexOf('</BlogPost>');
    expect(openIdx).toBeGreaterThan(-1);
    expect(articleIdx).toBeGreaterThan(openIdx);
    expect(closeIdx).toBeGreaterThan(articleIdx);
  });

  it('imports BlogPost via the correct relative path from src/pages/<coll>/posts/', () => {
    const out = generatePostPage(baseOpts);
    expect(out).toContain("import BlogPost from '../../../components/library/BlogPost.astro';");
  });

  it('passes the frontmatter title into BlogPost', () => {
    const out = generatePostPage(baseOpts);
    expect(out).toContain('<BlogPost title={entry.data.title}>');
  });

  it('still emits getStaticPaths bound to the collection name', () => {
    const out = generatePostPage(baseOpts);
    expect(out).toContain("await getCollection('ger',");
    expect(out).toContain('export async function getStaticPaths()');
  });

  it('body-binding injects <Content /> as the bound element\'s inner content', () => {
    const out = generatePostPage({
      collectionName: 'ger',
      layoutMarkup: '<div data-key="el-1:div-0" class="prose">Post content goes here...</div>',
      bindings: { 'el-1:div-0': 'body' },
    });
    // <Content /> must replace the bound element's inner HTML — not be added
    // as an attribute. Reason: the prior `set:html={renderedContent}` form
    // referenced an undefined identifier and broke every post build.
    expect(out).toContain('<div data-key="el-1:div-0" class="prose"><Content /></div>');
    expect(out).not.toContain('set:html');
    expect(out).not.toContain('renderedContent');
    // Binding rewrite still happens inside the wrapper, not above it.
    expect(out.indexOf('<Content />')).toBeGreaterThan(out.indexOf('<BlogPost>'));
  });

  it('fills the collection-content slot div and strips editor slot attrs', () => {
    const out = generatePostPage({
      collectionName: 'blog',
      layoutMarkup: '<article><div data-key="el-1-content:div-0" data-sq-slot name="content" class="prose prose-lg">placeholder</div></article>',
      bindings: { 'el-1-content:div-0': 'body' },
    });
    expect(out).toContain('<Content />');
    expect(out).not.toContain('placeholder');
    expect(out).not.toContain('data-sq-slot');
    expect(out).not.toContain('name="content"');
  });

  it('substitutes frontmatter field bindings with {entry.data.<field>}', () => {
    const out = generatePostPage({
      collectionName: 'blog',
      layoutMarkup: '<article><h1 data-key="el-1:h1-0" class="big">Placeholder title</h1>' +
        '<div data-key="el-1:div-0" class="prose">body here</div></article>',
      bindings: { 'el-1:h1-0': 'title', 'el-1:div-0': 'body' },
    });
    expect(out).toContain('<h1 data-key="el-1:h1-0" class="big">{entry.data.title}</h1>');
    expect(out).not.toContain('Placeholder title');
    expect(out).toContain('<Content />');
  });

  it('leaves the markup untouched when there is no body binding', () => {
    const out = generatePostPage({
      collectionName: 'ger',
      layoutMarkup: '<div data-key="el-1:div-0" class="prose">verbatim</div>',
      bindings: {},
    });
    expect(out).toContain('<div data-key="el-1:div-0" class="prose">verbatim</div>');
    expect(out).not.toContain('<Content />');
  });
});

describe('generateDetailPage — draft filter', () => {
  it('filters draft posts out of getStaticPaths', () => {
    const out = generateDetailPage('blog');
    expect(out).toContain("getCollection('blog', ({ data }) => !data.draft)");
    expect(out).not.toMatch(/getCollection\('blog'\)\s*[;\n]/);
  });
});

describe('generatePostPage — draft filter', () => {
  it('filters draft posts out of getStaticPaths in user-designed post page', () => {
    const out = generatePostPage({
      collectionName: 'blog',
      layoutMarkup: '<article><h1>title</h1></article>',
      bindings: {},
    });
    expect(out).toContain("getCollection('blog', ({ data }) => !data.draft)");
    expect(out).not.toMatch(/getCollection\('blog'\)\s*[;\n]/);
  });
});

describe('generateJsonEndpoint — draft filter', () => {
  it('filters draft posts in both getStaticPaths and GET', () => {
    const out = generateJsonEndpoint('blog', 6, 'date-desc');
    const filtered = out.match(/getCollection\('blog', \(\{ data \}\) => !data\.draft\)/g) || [];
    // One in getStaticPaths (for totalPages math) and one in GET (for slice).
    expect(filtered.length).toBe(2);
    // No un-filtered survivors.
    expect(out).not.toMatch(/getCollection\('blog'\)\s*[;\n]/);
  });
});

describe('generateListingPage — draft filter', () => {
  const base = {
    collectionName: 'blog',
    cardComponentPath: '../../components/sq-templates/blog-card.astro',
  };

  it('pagination "none" filters draft posts from getCollection', () => {
    const out = generateListingPage({
      ...base,
      settings: { postsPerPage: 6, sortBy: 'date-desc', pagination: 'none', layout: 'grid', columns: 3, gap: 'gap-4' },
    });
    expect(out).toContain("getCollection('blog', ({ data }) => !data.draft)");
    // Defensive: should NOT also keep the un-filtered call (regression guard).
    expect(out).not.toMatch(/getCollection\('blog'\)\s*[;\n]/);
  });

  it('pagination "numbered" filters draft posts', () => {
    const out = generateListingPage({
      ...base,
      settings: { postsPerPage: 6, sortBy: 'date-desc', pagination: 'numbered', layout: 'grid', columns: 3, gap: 'gap-4' },
    });
    expect(out).toContain("getCollection('blog', ({ data }) => !data.draft)");
    expect(out).not.toMatch(/getCollection\('blog'\)\s*[;\n]/);
  });

  it('pagination "load-more" filters draft posts', () => {
    const out = generateListingPage({
      ...base,
      settings: { postsPerPage: 6, sortBy: 'date-desc', pagination: 'load-more', layout: 'grid', columns: 3, gap: 'gap-4' },
    });
    expect(out).toContain("getCollection('blog', ({ data }) => !data.draft)");
    expect(out).not.toMatch(/getCollection\('blog'\)\s*[;\n]/);
  });
});
