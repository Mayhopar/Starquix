import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebaseCss, rebaseHtml, rebaseUrl } from '../src/git/pages-rebase.mjs';

// Ledger 24/25 (docs/plans/2026-10-14-github-publish-design.md): a Pages project site lives under /<repo>/.
it('rebaseUrl: root URLs move under the base; everything else stays', () => {
  const b = '/site';
  expect(rebaseUrl('/about', b)).toBe('/site/about');
  expect(rebaseUrl('/', b)).toBe('/site/');
  expect(rebaseUrl('/site-two', b)).toBe('/site/site-two');
  for (const u of ['/site/_astro/x.css', '/site', '//cdn.example.com/x.js', 'https://x.dev/a', '#top', 'mailto:a@b.c', 'img.png', '../x']) {
    expect(rebaseUrl(u, b)).toBe(u);
  }
  expect(rebaseUrl('/about', '')).toBe('/about');
});

it('rebaseHtml: href/src/action/poster, every srcset candidate, style="" and <style> — never class=""', () => {
  const html = `<a href="/about">a</a><a href='/'>h</a><img src="/assets/a.webp" srcset="/assets/a.webp 1x, /assets/b.webp 2x">`
    + `<form action="/send"></form><video poster="/p.jpg"></video>`
    + `<div class="bg-[url(/assets/hero.webp)]" style="background:url('/assets/x.webp')"></div>`
    + `<style>.h{background-image:url(/assets/hero.webp)}</style><a href="https://x.dev/">x</a><a href="#top">t</a>`;
  expect(rebaseHtml(html, '/site')).toBe(
    `<a href="/site/about">a</a><a href='/site/'>h</a><img src="/site/assets/a.webp" srcset="/site/assets/a.webp 1x, /site/assets/b.webp 2x">`
    + `<form action="/site/send"></form><video poster="/site/p.jpg"></video>`
    + `<div class="bg-[url(/assets/hero.webp)]" style="background:url('/site/assets/x.webp')"></div>`
    + `<style>.h{background-image:url(/site/assets/hero.webp)}</style><a href="https://x.dev/">x</a><a href="#top">t</a>`);
  expect(rebaseHtml(html, '')).toBe(html);
});

it('rebaseCss: url() declarations move; the escaped Tailwind selector they came from does not', () => {
  const css = '.bg-\\[url\\(\\/assets\\/hero\\.webp\\)\\]{background-image:url(/assets/hero.webp)}@font-face{src:url("/fonts/a.woff2")}';
  expect(rebaseCss(css, '/site')).toBe(
    '.bg-\\[url\\(\\/assets\\/hero\\.webp\\)\\]{background-image:url(/site/assets/hero.webp)}@font-face{src:url("/site/fonts/a.woff2")}');
});

it('CLI rewrites dist/**/*.html|css in place, leaves .js alone, and is a no-op without a base', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-rebase-'));
  try {
    await fsp.mkdir(path.join(dir, 'about'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'about/index.html'), '<a href="/">home</a>');
    await fsp.writeFile(path.join(dir, 'x.css'), 'a{b:url(/i.png)}');
    await fsp.writeFile(path.join(dir, 'x.js'), 'fetch("/api")');
    const script = fileURLToPath(new URL('../src/git/pages-rebase.mjs', import.meta.url));
    execFileSync(process.execPath, [script, dir, '']);
    expect(await fsp.readFile(path.join(dir, 'about/index.html'), 'utf8')).toBe('<a href="/">home</a>');
    execFileSync(process.execPath, [script, dir, '/site/']);
    expect(await fsp.readFile(path.join(dir, 'about/index.html'), 'utf8')).toBe('<a href="/site/">home</a>');
    expect(await fsp.readFile(path.join(dir, 'x.css'), 'utf8')).toBe('a{b:url(/site/i.png)}');
    expect(await fsp.readFile(path.join(dir, 'x.js'), 'utf8')).toBe('fetch("/api")');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

// Altitude review: a repo named like a route ("blog" with /blog/…) must still get its links rebased — only URLs that
// exist as-is in the build are routes; Astro's own based URLs (/blog/_astro/…) do not.
it('CLI: links into a route that shares the repo name are rebased; Astro\'s already-based URLs are not', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-rebase-'));
  try {
    await fsp.mkdir(path.join(dir, 'blog/post'), { recursive: true });
    await fsp.mkdir(path.join(dir, '_astro'), { recursive: true });
    await fsp.writeFile(path.join(dir, '_astro/x.css'), 'a{}');
    await fsp.writeFile(path.join(dir, 'blog/post/index.html'), 'post');
    await fsp.writeFile(path.join(dir, 'index.html'), '<link href="/blog/_astro/x.css"><a href="/blog/post">p</a><a href="/blog">b</a><a href="/about">a</a>');
    execFileSync(process.execPath, [fileURLToPath(new URL('../src/git/pages-rebase.mjs', import.meta.url)), dir, '/blog']);
    expect(await fsp.readFile(path.join(dir, 'index.html'), 'utf8'))
      .toBe('<link href="/blog/_astro/x.css"><a href="/blog/blog/post">p</a><a href="/blog/blog">b</a><a href="/blog/about">a</a>');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});
