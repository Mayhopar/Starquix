import { describe, it, expect } from 'vitest';
import { discoverLocalPages } from '../project-fs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-pages-'));
  mkdirSync(join(dir, 'src', 'pages', 'blog'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), '<h1>Home</h1>');
  writeFileSync(join(dir, 'src', 'pages', 'about.astro'), '<h1>About</h1>');
  writeFileSync(join(dir, 'src', 'pages', 'blog', '[slug].astro'), '<h1>Post</h1>');
  writeFileSync(join(dir, 'src', 'pages', 'notes.md'), '# Notes');
  writeFileSync(join(dir, 'src', 'pages', 'ignore.txt'), 'not a page');
  return dir;
}

describe('discoverLocalPages', () => {
  it('maps src/pages/** files to routes', () => {
    const pages = discoverLocalPages(scaffold());
    expect(pages).toEqual([
      { route: '/', file: 'src/pages/index.astro', editable: true },
      { route: '/about', file: 'src/pages/about.astro', editable: true },
      { route: '/blog/[slug]', file: 'src/pages/blog/[slug].astro', editable: true, dynamic: true },
      { route: '/notes', file: 'src/pages/notes.md', editable: false },
    ]);
  });

  it('returns [] when src/pages is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-pages-'));
    expect(discoverLocalPages(dir)).toEqual([]);
  });
});
