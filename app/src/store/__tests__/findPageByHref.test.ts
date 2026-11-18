/**
 * findPageByHref (task-116) — THE href→page matcher, shared by LinkBlock's
 * "Go to page" and preview-mode link navigation.
 *
 * The leniency cases here are not hypothetical: hrefs are STORED, so old docs
 * carry the pre-2026-06-11 legacy derivation, and hand-typed hrefs arrive with
 * arbitrary case and trailing slashes. LinkBlock relied on all of it before the
 * extraction; these tests pin that behavior so preview can't drift from it.
 */
import { describe, it, expect } from 'vitest';
import { findPageByHref } from '../findPageByHref';
import type { PageData } from '../types';

function page(id: string, name: string, extra: Partial<PageData> = {}): PageData {
  return { id, name, rootElementIds: [], children: [], ...extra };
}

const PAGES: PageData[] = [
  page('p-home', 'Home', { isHome: true }),
  page('p-about', 'About', {}),
  page('p-contact', 'Contact Us', {}),
  page('p-qa', 'Q&A', {}),
];

describe('findPageByHref', () => {
  it('matches the home page at the root route', () => {
    expect(findPageByHref(PAGES, '/')?.id).toBe('p-home');
  });

  it('matches a slugged page', () => {
    expect(findPageByHref(PAGES, '/about')?.id).toBe('p-about');
  });

  it('matches a multi-word page through the slug', () => {
    expect(findPageByHref(PAGES, '/contact-us')?.id).toBe('p-contact');
  });

  it('tolerates a trailing slash', () => {
    expect(findPageByHref(PAGES, '/about/')?.id).toBe('p-about');
  });

  it('is case-insensitive', () => {
    expect(findPageByHref(PAGES, '/About')?.id).toBe('p-about');
    expect(findPageByHref(PAGES, '/CONTACT-US')?.id).toBe('p-contact');
  });

  it('matches a legacy stored href (Q&A → /qa, not the current /q-a)', () => {
    // pageHref mints '/q-a' today; docs written before 2026-06-11 stored '/qa'.
    // Both must resolve or old links silently break.
    expect(findPageByHref(PAGES, '/qa')?.id).toBe('p-qa');
    expect(findPageByHref(PAGES, '/q-a')?.id).toBe('p-qa');
  });

  it('matches a legacy home href (/home) as well as /', () => {
    expect(findPageByHref(PAGES, '/home')?.id).toBe('p-home');
  });

  // Files-truth pages are NAMED by their route (useProjectSync seeding). A
  // post page '/blog/first' slugified to '/blog-first', so "Go to page" never
  // matched a post link (owner 2026-10-17).
  it('matches a files-truth page by its route, multi-segment post routes included', () => {
    const routes = [page('index', '/'), page('blog', '/blog'), page('blog-first', '/blog/first')];
    expect(findPageByHref(routes, '/blog/first')?.id).toBe('blog-first');
    expect(findPageByHref(routes, '/Blog/First/')?.id).toBe('blog-first');
    expect(findPageByHref(routes, '/')?.id).toBe('index');
    expect(findPageByHref(routes, '/blog-first')).toBeNull();
  });

  it('returns null for an unmatched href — the caller treats it as inert', () => {
    expect(findPageByHref(PAGES, '/does-not-exist')).toBeNull();
  });

  it('returns null for an external href', () => {
    expect(findPageByHref(PAGES, 'https://example.com/about')).toBeNull();
  });

  it.each([['empty', ''], ['null', null], ['undefined', undefined]])(
    'returns null for an %s href',
    (_label, href) => {
      expect(findPageByHref(PAGES, href as string | null | undefined)).toBeNull();
    },
  );

  it('returns null when there are no pages', () => {
    expect(findPageByHref([], '/about')).toBeNull();
  });

  it('falls back to name-magic for un-migrated docs with no isHome flag', () => {
    // pageHref's documented fallback: pageId 'default' or a page named "home".
    const unmigrated = [page('default', 'Untitled'), page('p-x', 'About')];
    expect(findPageByHref(unmigrated, '/')?.id).toBe('default');
  });

  it('returns the first match when two pages share a slug', () => {
    const dupes = [page('p-1', 'About'), page('p-2', 'About')];
    expect(findPageByHref(dupes, '/about')?.id).toBe('p-1');
  });
});
