// task-145: local-mode Add Page writes a REAL src/pages file — doc-only pages
// aliased the index route and deletes destroyed the real index file.
import { describe, it, expect } from 'vitest';
import { createLocalPage, discoverLocalPages } from '../project-fs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-page-'));
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), '<html><body><h1>Home</h1></body></html>');
  writeFileSync(join(dir, 'src', 'pages', 'about.astro'), '<html><body><h1>About</h1></body></html>');
  return dir;
}

describe('createLocalPage (task-145)', () => {
  it('writes src/pages/<slug>.astro from the display name and returns the page', () => {
    const dir = scaffold();
    const page = createLocalPage(dir, 'Page 4');
    expect(page).toEqual({ route: '/page-4', file: 'src/pages/page-4.astro', editable: true });
    const full = join(dir, 'src', 'pages', 'page-4.astro');
    expect(existsSync(full)).toBe(true);
    const src = readFileSync(full, 'utf8');
    expect(src).toContain('<title>Page 4</title>');
    // WC parity: a new page is EMPTY — no placeholder heading/content (the
    // tagged <main> is the invisible scan anchor + insert target).
    expect(src).not.toContain('<h1>');
    expect(src).toContain('<main></main>');
    // the discoverer must see it exactly like any hand-made page
    expect(discoverLocalPages(dir)).toContainEqual(expect.objectContaining({ route: '/page-4' }));
  });

  it('collision → first free -N suffix, NEVER an error, NEVER overwrites user files', () => {
    const dir = scaffold();
    const page = createLocalPage(dir, 'About');
    expect(page.route).toBe('/about-2');
    // the user's original file is untouched
    expect(readFileSync(join(dir, 'src', 'pages', 'about.astro'), 'utf8')).toContain('<h1>About</h1>');
    expect(readFileSync(join(dir, 'src', 'pages', 'about-2.astro'), 'utf8')).toContain('About 2');
    // repeat clicks keep advancing, no toast wall
    expect(createLocalPage(dir, 'About').route).toBe('/about-3');
  });

  it('repeated default-name clicks produce new-page, new-page-2, …', () => {
    const dir = scaffold();
    expect(createLocalPage(dir, 'New Page').route).toBe('/new-page');
    expect(createLocalPage(dir, 'New Page').route).toBe('/new-page-2');
    expect(createLocalPage(dir, 'New Page').route).toBe('/new-page-3');
  });

  it('all-special-character names fall back to the shared slugify untitled route', () => {
    const dir = scaffold();
    expect(createLocalPage(dir, '!!!').route).toBe('/untitled');
  });

  it('refuses when src/pages does not exist (not an astro project root)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-page-empty-'));
    expect(() => createLocalPage(dir, 'Page 1')).toThrow();
  });
});

// Security (audit 2026-10-18): `{…}` in .astro markup is server-side code.
describe('createLocalPage — braces in the page name', () => {
  it('writes them as entities, never as an Astro expression', () => {
    const dir = scaffold();
    const page = createLocalPage(dir, 'Docs {v2}');
    const src = readFileSync(join(dir, page.file), 'utf8');
    expect(src).toContain('<title>Docs &#123;v2&#125;</title>');
    expect(src).not.toContain('{v2}');
  });
});
