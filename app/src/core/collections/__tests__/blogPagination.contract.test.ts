// task-240 Phase 3: the library pagination chrome takes Astro's data —
// Numbered renders `page` (Astro's paginate() Page object), LoadMore takes a
// `pageSize` and reveals the next batch client-side — and BOTH still render
// a static preview with no props (the component view, the slot fallback).
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LIB = resolve(__dirname, '../../../../../preview-template/src/components/library');
const read = (f: string) => readFileSync(resolve(LIB, f), 'utf8');

describe('BlogPaginationNumbered.astro', () => {
  const src = read('BlogPaginationNumbered.astro');
  it('takes an optional page prop and renders prev/next + numbered links from it', () => {
    expect(src).toMatch(/const \{ page \} = Astro\.props/);
    expect(src).toContain('page.url.prev');
    expect(src).toContain('page.url.next');
    expect(src).toContain('page.lastPage');
    expect(src).toContain('page.currentPage');
  });
  it('keeps a static fallback when no page is passed', () => {
    expect(src).toMatch(/page \?/);
    expect(src).toContain('aria-current="page"');
  });
});

describe('BlogPaginationLoadMore.astro', () => {
  const src = read('BlogPaginationLoadMore.astro');
  it('takes pageSize (default 3) and ships an inline script that reveals the posts grid in batches', () => {
    expect(src).toMatch(/const \{ pageSize = 3 \} = Astro\.props/);
    expect(src).toMatch(/<script is:inline define:vars=\{\{ pageSize \}\}>/);
    expect(src).toContain('[data-blog-source="posts"]');
  });
  it('hides with style.display (the hidden attribute loses to Tailwind display utilities on the card root)', () => {
    expect(src).toContain("el.style.display = i >= shown ? 'none' : ''");
    expect(src).not.toMatch(/\.hidden = /);
  });
});
