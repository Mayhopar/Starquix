// task-240 Phase 3: numbered pagination is Astro's `[...page].astro` route, so
// binding it MOVES the page file (src/pages/blog.astro → src/pages/blog/[...page].astro)
// and back. The move is a real rename inside src/pages, journaled by the route.
// `[...page]` is the pagination idiom: the editor lists that file as the
// parent route (/blog), static — one file, one page.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { moveLocalPage, routeForPageFile, discoverLocalPages } from '../project-fs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-page-move-'));
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), 'home');
  writeFileSync(join(dir, 'src', 'pages', 'blog.astro'), 'BLOG');
  return dir;
}

describe('moveLocalPage', () => {
  it('renames the file inside src/pages (creating folders) and returns both paths', () => {
    const dir = scaffold();
    expect(moveLocalPage(dir, 'src/pages/blog.astro', 'src/pages/blog/[...page].astro'))
      .toEqual({ ok: true, from: 'src/pages/blog.astro', to: 'src/pages/blog/[...page].astro' });
    expect(existsSync(join(dir, 'src', 'pages', 'blog.astro'))).toBe(false);
    expect(readFileSync(join(dir, 'src', 'pages', 'blog', '[...page].astro'), 'utf8')).toBe('BLOG');
    // and back
    moveLocalPage(dir, 'src/pages/blog/[...page].astro', 'src/pages/blog.astro');
    expect(readFileSync(join(dir, 'src', 'pages', 'blog.astro'), 'utf8')).toBe('BLOG');
  });

  it('refuses paths outside src/pages, a missing source and an existing target', () => {
    const dir = scaffold();
    expect(() => moveLocalPage(dir, 'src/components/X.astro', 'src/pages/x.astro')).toThrow(/src\/pages/);
    expect(() => moveLocalPage(dir, 'src/pages/blog.astro', 'src/x.astro')).toThrow(/src\/pages/);
    expect(() => moveLocalPage(dir, 'src/pages/nope.astro', 'src/pages/x.astro')).toThrow(/no such page/i);
    expect(() => moveLocalPage(dir, 'src/pages/blog.astro', 'src/pages/index.astro')).toThrow(/already exists/i);
    expect(existsSync(join(dir, 'src', 'pages', 'blog.astro'))).toBe(true);
  });
});

describe('[...page] pagination route', () => {
  it('routeForPageFile lists blog/[...page].astro as /blog (the first page)', () => {
    expect(routeForPageFile('src/pages/blog/[...page].astro')).toBe('/blog');
    expect(routeForPageFile('src/pages/[...page].astro')).toBe('/');
    // other rest params stay dynamic
    expect(routeForPageFile('src/pages/docs/[...slug].astro')).toBe('/docs/[...slug]');
  });

  it('discoverLocalPages lists it as a static, editable page', () => {
    const dir = scaffold();
    moveLocalPage(dir, 'src/pages/blog.astro', 'src/pages/blog/[...page].astro');
    const blog = discoverLocalPages(dir).find((p) => p.route === '/blog');
    expect(blog).toEqual({ route: '/blog', file: 'src/pages/blog/[...page].astro', editable: true });
  });
});
