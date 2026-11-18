// Pages-lifecycle parity (2026-08-12 sweep, gap 23): local-mode page rename
// moves the REAL src/pages file. Before this endpoint existed, a rename was a
// doc-only RENAME_PAGE — the row displayed a route that didn't exist and the
// name evaporated on reopen. pageId in, never a path (page-delete contract).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { renameLocalPage } from '../../project-fs';

let base: string;
let userDir: string;

const PAGE = '---\n---\n<html><body><main>about</main></body></html>\n';

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-page-rename-'));
  userDir = path.join(base, 'their-site');
  await mkdir(path.join(userDir, 'src', 'pages', 'blog'), { recursive: true });
  await writeFile(path.join(userDir, 'src', 'pages', 'index.astro'), PAGE);
  await writeFile(path.join(userDir, 'src', 'pages', 'about.astro'), PAGE);
  await writeFile(path.join(userDir, 'src', 'pages', 'contact.astro'), PAGE);
  await writeFile(path.join(userDir, 'src', 'pages', 'notes.md'), '# notes\n');
  await writeFile(path.join(userDir, 'src', 'pages', 'blog', 'index.astro'), PAGE);
  await writeFile(path.join(userDir, 'src', 'pages', 'blog', '[slug].astro'), PAGE);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('renameLocalPage', () => {
  it('renames the real file and reports both sides for the doc rekey', () => {
    const r = renameLocalPage(userDir, 'about', 'Team');
    expect(r).toMatchObject({
      oldRoute: '/about',
      oldFile: 'src/pages/about.astro',
      route: '/team',
      file: 'src/pages/team.astro',
      editable: true,
    });
    expect(existsSync(path.join(userDir, 'src', 'pages', 'about.astro'))).toBe(false);
    // Bytes moved verbatim — a rename never rewrites content.
    expect(readFileSync(path.join(userDir, 'src', 'pages', 'team.astro'), 'utf8')).toBe(PAGE);
  });

  it('same-slug rename is a no-op, not an error', () => {
    const r = renameLocalPage(userDir, 'about', 'About');
    expect(r.route).toBe('/about');
    expect(r.oldRoute).toBe('/about');
    expect(existsSync(path.join(userDir, 'src', 'pages', 'about.astro'))).toBe(true);
  });

  it('refuses the home page (index.astro is the site root)', () => {
    expect(() => renameLocalPage(userDir, 'index', 'Landing')).toThrow(/site root/);
    expect(existsSync(path.join(userDir, 'src', 'pages', 'index.astro'))).toBe(true);
  });

  it('refuses directory-index pages — the route lives in the folder name', () => {
    expect(() => renameLocalPage(userDir, 'blog', 'News')).toThrow(/folder name/);
    expect(existsSync(path.join(userDir, 'src', 'pages', 'blog', 'index.astro'))).toBe(true);
  });

  it('refuses dynamic routes', () => {
    // localPageId('/blog/[slug]') keeps the brackets: 'blog-[slug]'
    expect(() => renameLocalPage(userDir, 'blog-[slug]', 'Post')).toThrow(/dynamic route/);
  });

  it('refuses non-.astro pages', () => {
    expect(() => renameLocalPage(userDir, 'notes', 'Journal')).toThrow(/not a \.astro page/);
  });

  it('refuses a collision — rename never overwrites', () => {
    expect(() => renameLocalPage(userDir, 'about', 'Contact')).toThrow(/already exists/);
    expect(existsSync(path.join(userDir, 'src', 'pages', 'about.astro'))).toBe(true);
    expect(readFileSync(path.join(userDir, 'src', 'pages', 'contact.astro'), 'utf8')).toBe(PAGE);
  });

  it('refuses an unknown page id (no-alias law applied to rename)', () => {
    expect(() => renameLocalPage(userDir, 'ghost', 'Anything')).toThrow(/No page file matches/);
  });

  it('slugifies punctuation-heavy names via the shared slugify (never crashes)', () => {
    // slugify falls back to 'untitled' for all-special-character names.
    const r = renameLocalPage(userDir, 'about', '!!!');
    expect(r.route).toBe('/untitled');
    expect(existsSync(path.join(userDir, 'src', 'pages', 'untitled.astro'))).toBe(true);
  });
});
