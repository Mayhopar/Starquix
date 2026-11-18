/**
 * Blind review 2026-08-04 item 5: "The Pages panel lists routes in one runtime
 * and names in the other (`/`, `/about` vs `index`, `Page 2`)."
 *
 * Ruled: ROUTES, in both. A route is real, stable and derivable in every
 * runtime — local's page identity IS its route, and WC/server already derives
 * exported routes and internal links from `utils/slugify.pageHref`, which this
 * module reuses rather than reinvents. A NAME, by contrast, exists in only one
 * of the two: local pages come from the filesystem and have never had one, so
 * "names in both" would mean inventing a label per session — exactly what the
 * review warned against. A route also tells the user something `Page 2` cannot:
 * where the page actually lives.
 *
 * The branch is on the DATA, never on the runtime: a page whose name already
 * IS a route carries it verbatim. Nothing here reads a project id, a
 * localStorage key or a runtime flag.
 */
import { describe, it, expect } from 'vitest';
import { pageRoute } from '../pageRoute';
import { pageHref } from '@/utils/slugify';

describe('pageRoute — WC / server pages (a name, slugified)', () => {
  it('is exactly pageHref, the derivation export and links already share', () => {
    expect(pageRoute({ id: 'p2', name: 'Page 2' })).toBe(pageHref('p2', 'Page 2'));
    expect(pageRoute({ id: 'p2', name: 'Page 2' })).toBe('/page-2');
  });

  it('the home page is `/`', () => {
    expect(pageRoute({ id: 'p1', name: 'Landing', isHome: true })).toBe('/');
  });

  it('honours the legacy name-magic when isHome is absent', () => {
    expect(pageRoute({ id: 'default', name: 'Whatever' })).toBe('/');
    expect(pageRoute({ id: 'p9', name: 'Home' })).toBe('/');
  });

  it('a name that cannot be slugified still yields a route, never an empty string', () => {
    expect(pageRoute({ id: 'p3', name: '!!!' })).toBe('/untitled');
  });
});

describe('pageRoute — files-truth pages (the name already IS the route)', () => {
  it('carries the real route verbatim, never re-slugifies it', () => {
    expect(pageRoute({ id: 'index', name: '/' })).toBe('/');
    expect(pageRoute({ id: 'about', name: '/about' })).toBe('/about');
  });

  it('keeps a nested route whole — slugifying would flatten `/blog/first` to `/blog-first`', () => {
    expect(pageRoute({ id: 'blog-first', name: '/blog/first' })).toBe('/blog/first');
  });

  it('keeps a dynamic route file readable', () => {
    expect(pageRoute({ id: 'works-[slug]', name: '/works/[slug]' })).toBe('/works/[slug]');
  });

  it('never returns `/untitled` for the local index — the bug slugify would cause', () => {
    // slugify('/') === 'untitled'; a naive pageHref call would print `/untitled`
    // for every local home page.
    expect(pageRoute({ id: 'index', name: '/' })).not.toBe('/untitled');
  });
});

describe('pageRoute — degenerate input', () => {
  it('an empty name still yields a route', () => {
    expect(pageRoute({ id: 'p1', name: '' })).toBe('/untitled');
  });
});
