// task-148 (task-133 follow-up): local-mode page DELETE removes the REAL
// src/pages file. Doc-only delete left orphan files behind (a real project
// accumulated new-page{,-2..-6}.astro) and the page re-seeded on reopen.
// Irreversible from the editor — every refusal rule is tested here.
import { describe, it, expect } from 'vitest';
import { deleteLocalPage, restoreLocalPage, routeForPageFile, discoverLocalPages } from '../project-fs';
import { localPageId } from '../../utils/localMode';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-page-del-'));
  mkdirSync(join(dir, 'src', 'pages', 'works'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), '<html><body><h1>Home</h1></body></html>');
  writeFileSync(join(dir, 'src', 'pages', 'about.astro'), '<html><body><h1>About</h1></body></html>');
  writeFileSync(join(dir, 'src', 'pages', 'works', '[slug].astro'), '<html><body>slug</body></html>');
  writeFileSync(join(dir, 'src', 'pages', 'notes.md'), '# notes');
  return dir;
}

describe('deleteLocalPage (task-148)', () => {
  it('deletes the real src/pages file and returns the removed route+file+BYTES', () => {
    const dir = scaffold();
    const removed = deleteLocalPage(dir, localPageId('/about'));
    // content is what makes ⌘Z possible — the bytes ride the undo entry
    expect(removed).toEqual({
      route: '/about',
      file: 'src/pages/about.astro',
      editable: true,
      content: '<html><body><h1>About</h1></body></html>',
    });
    expect(existsSync(join(dir, 'src', 'pages', 'about.astro'))).toBe(false);
    // every other page survives byte-identical
    expect(readFileSync(join(dir, 'src', 'pages', 'index.astro'), 'utf8')).toContain('<h1>Home</h1>');
    expect(discoverLocalPages(dir).map(p => p.route)).not.toContain('/about');
  });

  it('deletes a nested-directory page', () => {
    const dir = scaffold();
    mkdirSync(join(dir, 'src', 'pages', 'blog'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pages', 'blog', 'hello.astro'), 'x');
    deleteLocalPage(dir, localPageId('/blog/hello'));
    expect(existsSync(join(dir, 'src', 'pages', 'blog', 'hello.astro'))).toBe(false);
  });

  it('refuses the last remaining page — nothing is removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-page-del-one-'));
    mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pages', 'index.astro'), 'home');
    expect(() => deleteLocalPage(dir, 'index')).toThrow(/last page/i);
    expect(existsSync(join(dir, 'src', 'pages', 'index.astro'))).toBe(true);
  });

  it('refuses a dynamic-route file (one file renders every instance)', () => {
    const dir = scaffold();
    expect(() => deleteLocalPage(dir, localPageId('/works/[slug]'))).toThrow(/dynamic/i);
    expect(existsSync(join(dir, 'src', 'pages', 'works', '[slug].astro'))).toBe(true);
  });

  it('refuses md/mdx pages', () => {
    const dir = scaffold();
    expect(() => deleteLocalPage(dir, localPageId('/notes'))).toThrow(/\.astro/);
    expect(existsSync(join(dir, 'src', 'pages', 'notes.md'))).toBe(true);
  });

  it('unknown page id → refusal (404-shaped), nothing removed', () => {
    const dir = scaffold();
    expect(() => deleteLocalPage(dir, 'page-nope')).toThrow(/no page file/i);
    expect(discoverLocalPages(dir)).toHaveLength(4);
  });

  // The client sends a page ID; the FILE is resolved server-side from the same
  // discovery /__sq/local/pages uses. A client-supplied path can therefore
  // never point the rm anywhere — these pin that there is no path channel.
  it('path-shaped ids cannot escape src/pages', () => {
    const dir = scaffold();
    for (const evil of ['../../etc/passwd', '/etc/passwd', '..%2F..%2Fetc%2Fpasswd', 'src/pages/../../package.json']) {
      expect(() => deleteLocalPage(dir, evil)).toThrow();
    }
    expect(discoverLocalPages(dir)).toHaveLength(4);
    expect(existsSync(join(dir, 'src', 'pages', 'index.astro'))).toBe(true);
  });

  it('refuses when the resolved file is missing on disk (raced delete)', () => {
    const dir = scaffold();
    deleteLocalPage(dir, localPageId('/about'));
    expect(() => deleteLocalPage(dir, localPageId('/about'))).toThrow(/no page file/i);
  });
});

// ⌘Z restores the FILE, not a doc row: the delete hands its bytes to the undo
// entry and this endpoint writes them back verbatim. It must never clobber —
// a file that reappeared (git checkout, the user's own editor) wins.
describe('restoreLocalPage (task-148)', () => {
  it('round-trips the exact bytes a delete returned', () => {
    const dir = scaffold();
    const before = readFileSync(join(dir, 'src', 'pages', 'about.astro'), 'utf8');
    const removed = deleteLocalPage(dir, localPageId('/about'));

    const restored = restoreLocalPage(dir, removed.route, removed.content, removed.file);
    expect(restored).toEqual({ route: '/about', file: 'src/pages/about.astro' });
    expect(readFileSync(join(dir, 'src', 'pages', 'about.astro'), 'utf8')).toBe(before);
    expect(discoverLocalPages(dir).map(p => p.route)).toContain('/about');
  });

  it('round-trips a nested directory-index page to its ORIGINAL file, not the flat route file', () => {
    const dir = scaffold();
    mkdirSync(join(dir, 'src', 'pages', 'blog'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pages', 'blog', 'index.astro'), 'nested-index');
    const removed = deleteLocalPage(dir, localPageId('/blog'));
    expect(removed.file).toBe('src/pages/blog/index.astro');

    restoreLocalPage(dir, removed.route, removed.content, removed.file);
    expect(readFileSync(join(dir, 'src', 'pages', 'blog', 'index.astro'), 'utf8')).toBe('nested-index');
    expect(existsSync(join(dir, 'src', 'pages', 'blog.astro'))).toBe(false);
  });

  it('derives the file from the route when none is supplied', () => {
    const dir = scaffold();
    const removed = deleteLocalPage(dir, localPageId('/about'));
    expect(restoreLocalPage(dir, removed.route, removed.content).file).toBe('src/pages/about.astro');
  });

  it('REFUSES to clobber an existing file', () => {
    const dir = scaffold();
    expect(() => restoreLocalPage(dir, '/about', 'overwritten!', 'src/pages/about.astro')).toThrow(/exists/i);
    expect(readFileSync(join(dir, 'src', 'pages', 'about.astro'), 'utf8')).toContain('<h1>About</h1>');
  });

  it('refuses paths outside src/pages, whatever the client sends', () => {
    const dir = scaffold();
    writeFileSync(join(dir, 'package.json'), '{"real":true}');
    for (const [route, file] of [
      ['/x', '../../etc/passwd'],
      ['/x', '/etc/passwd'],
      ['/x', 'src/pages/../../package.json'],
      ['/../../evil', undefined],
      ['../../evil', undefined],
    ] as Array<[string, string | undefined]>) {
      expect(() => restoreLocalPage(dir, route, 'pwned', file)).toThrow();
    }
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"real":true}');
  });

  it('refuses a file whose own route disagrees with the route being restored', () => {
    const dir = scaffold();
    expect(() => restoreLocalPage(dir, '/about', 'x', 'src/pages/other.astro')).toThrow(/route/i);
    expect(existsSync(join(dir, 'src', 'pages', 'other.astro'))).toBe(false);
  });

  it('refuses non-.astro targets', () => {
    const dir = scaffold();
    expect(() => restoreLocalPage(dir, '/readme', 'x', 'src/pages/readme.md')).toThrow(/\.astro/);
  });

  it('recreates a directory the delete left empty', () => {
    const dir = scaffold();
    mkdirSync(join(dir, 'src', 'pages', 'deep', 'nest'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pages', 'deep', 'nest', 'page.astro'), 'deep');
    const removed = deleteLocalPage(dir, localPageId('/deep/nest/page'));
    rmSync(join(dir, 'src', 'pages', 'deep'), { recursive: true });

    restoreLocalPage(dir, removed.route, removed.content, removed.file);
    expect(readFileSync(join(dir, 'src', 'pages', 'deep', 'nest', 'page.astro'), 'utf8')).toBe('deep');
  });
});

describe('routeForPageFile (task-148)', () => {
  it('is the inverse mapping discoverLocalPages uses', () => {
    expect(routeForPageFile('src/pages/index.astro')).toBe('/');
    expect(routeForPageFile('src/pages/about.astro')).toBe('/about');
    expect(routeForPageFile('src/pages/blog/index.astro')).toBe('/blog');
    expect(routeForPageFile('src/pages/works/[slug].astro')).toBe('/works/[slug]');
  });
});
