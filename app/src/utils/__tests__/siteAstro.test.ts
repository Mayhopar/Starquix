// What we generate follows the open site's Astro: content-layer code on Astro ≥5 (hosts build it with no compat
// shim), legacy shapes below. Every generator that writes entry code takes its shape from utils/siteAstro.
import { afterEach, describe, expect, it } from 'vitest';
import { setSiteAstro, siteUsesContentLayer } from '@/utils/siteAstro';
import { postRouteSource } from '@/core/post/postLayoutSource';
import { emitBlogBinding, parseBlogBinding } from '@/utils/blogBinding';
import { addBlogToContentConfig, addCollectionToContentConfig } from '@/components/Editor/localBlogScaffold';

afterEach(() => setSiteAstro(null));
const pkg = (astro: string) => JSON.stringify({ dependencies: { astro } });

describe('siteAstro', () => {
  it('reads the pin; unknown or unreadable = legacy', () => {
    setSiteAstro(pkg('^7.4.5')); expect(siteUsesContentLayer()).toBe(true);
    setSiteAstro(new TextEncoder().encode(pkg('^5.0.0'))); expect(siteUsesContentLayer()).toBe(true);
    setSiteAstro(pkg('^4.16.5')); expect(siteUsesContentLayer()).toBe(false);
    setSiteAstro('{nope'); expect(siteUsesContentLayer()).toBe(false);
  });

  it('the post route: render(post) and post.id on a content-layer site, the legacy calls below', () => {
    setSiteAstro(pkg('^7.4.5'));
    const route = postRouteSource('blog', '../../layouts/PostLayout.astro');
    expect(route).toContain("import { getCollection, render } from 'astro:content';");
    expect(route).toContain('params: { slug: post.id }');
    expect(route).toContain('await render(post);');
    setSiteAstro(pkg('^4.0.0'));
    expect(postRouteSource('blog', 'x')).toContain('await post.render();');
  });

  it('card links: post.id on a content-layer site, and the binding reads back either way', () => {
    const page = "---\nimport BlogSlot from '../components/BlogSlot.astro';\n---\n<BlogSlot />\n";
    const binding = { ...parseBlogBinding(page), collection: 'blog', href: '/blog/' };
    setSiteAstro(pkg('^7.4.5'));
    const out = emitBlogBinding(page, binding, { cardImport: '../components/BlogCard.astro' })!;
    expect(out).toContain('href={`/blog/${post.id}`}');
    expect(out).toContain('data-sq-post-slug={post.id}');
    expect(parseBlogBinding(out).href).toBe('/blog/');
  });

  it('content configs: the blog scaffold and a Content-tab collection get glob loaders on a content-layer site', () => {
    const blog = addBlogToContentConfig(null, true);
    expect(blog).toContain("import { glob } from 'astro/loaders';");
    expect(blog).toContain("loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/blog' }),");
    expect(addBlogToContentConfig(null, false)).not.toContain('glob');
    const added = addCollectionToContentConfig(blog, 'my-notes');
    expect(added).toContain(`"my-notes": defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/my-notes' }) }),`);
    expect(added.match(/import \{ glob \}/g)).toHaveLength(1);
    expect(addCollectionToContentConfig(added, 'my-notes')).toBe(added);
    expect(addCollectionToContentConfig(added, 'blog')).toBe(added);
    expect(addCollectionToContentConfig(null, 'works')).toBe("import { defineCollection } from 'astro:content';\nimport { glob } from 'astro/loaders';\n\nexport const collections = {\n  works: defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/works' }) }),\n};\n");
  });
});
