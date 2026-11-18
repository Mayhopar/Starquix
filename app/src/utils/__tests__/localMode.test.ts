import { describe, it, expect, beforeEach } from 'vitest';
import { PROJECT_NOT_READY, findLocalProjectEntry, isLocalProjectId, isLocalScanEmpty, localPageId, localPostTargetFor, markFilesTruth, resolveLocalPageDeletion, resolveLocalPageFile, resolveLocalPagePath, unmarkFilesTruth } from '../localMode';

describe('localMode (one disk: files-truth in the desktop app)', () => {
  beforeEach(() => { unmarkFilesTruth('browser_p'); localStorage.clear(); });

  it('a files-truth id is a local-runtime project with a wc:// transport path', () => {
    markFilesTruth('browser_p');
    expect(isLocalProjectId('browser_p')).toBe(true);
    expect(findLocalProjectEntry('browser_p')).toEqual({ path: 'wc://browser_p', name: 'browser_p' });
  });

  it('the host-folder disk is gone: a local_ id is not a project any more', () => {
    // A bookmark from before 2026-09-10 — the editor route redirects to /.
    expect(isLocalProjectId('local_1abc2')).toBe(false);
    expect(findLocalProjectEntry('local_1abc2')).toBeNull();
    // Old recents in localStorage are ignored, never read.
    localStorage.setItem('sq:local-projects', JSON.stringify([{ path: '/Users/me/site', name: 'site' }]));
    expect(findLocalProjectEntry('local_1abc2')).toBeNull();
  });

  it('an unresolved id (mirror not settled yet) is not ready, not an error', () => {
    expect(isLocalProjectId('browser_p')).toBe(false);
    expect(findLocalProjectEntry('browser_p')).toBeNull();
    expect(PROJECT_NOT_READY).toMatch(/not ready/);
  });
});

describe('resolveLocalPagePath (task-145)', () => {
  const pages = [
    { route: '/' },
    { route: '/about' },
    { route: '/works/[slug]', dynamic: true },
  ];
  const dyn = [{ paths: ['/works/inito', '/works/petcube'] }];

  it('matched static page → its route', () => {
    expect(resolveLocalPagePath({ currentPageId: 'about', currentPageName: '/about', pages, dynamicInstances: dyn })).toBe('/about');
    expect(resolveLocalPagePath({ currentPageId: 'index', currentPageName: '/', pages, dynamicInstances: dyn })).toBe('/');
  });

  it('matched dynamic instance → the concrete path', () => {
    expect(resolveLocalPagePath({ currentPageId: localPageId('/works/inito'), currentPageName: '/works/inito', pages, dynamicInstances: dyn })).toBe('/works/inito');
  });

  it('dynamic route file itself (no instance) → its route', () => {
    expect(resolveLocalPagePath({ currentPageId: localPageId('/works/[slug]'), currentPageName: '/works/[slug]', pages, dynamicInstances: [] })).toBe('/works/[slug]');
  });

  it('unmatched page with a route-like name → that name (a just-created file the pages list has not refetched)', () => {
    expect(resolveLocalPagePath({ currentPageId: localPageId('/page-4'), currentPageName: '/page-4', pages, dynamicInstances: dyn })).toBe('/page-4');
  });

  it('REGRESSION: unmatched doc-only page NEVER aliases another page\'s route', () => {
    const out = resolveLocalPagePath({ currentPageId: 'page-someid', currentPageName: 'Page 4', pages, dynamicInstances: dyn });
    for (const p of pages) expect(out).not.toBe(p.route);
    expect(out).toMatch(/^\/__sq_missing_page\//); // guaranteed 404 — honest, nothing writable
  });

  it('boot (pages list not fetched yet) → /', () => {
    expect(resolveLocalPagePath({ currentPageId: 'index', currentPageName: null, pages: [], dynamicInstances: [] })).toBe('/');
  });
});

// task-133 Task 5: doc page → backing FILE for structural writes. Same
// matching as resolveLocalPagePath but returns the src/pages file; null =
// no backing file, so no structural target (never alias — task-145 law).
describe('resolveLocalPageFile (task-133)', () => {
  const pages = [
    { route: '/', file: 'src/pages/index.astro' },
    { route: '/about', file: 'src/pages/about.astro' },
    { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', dynamic: true },
  ];
  const dyn = [{ route: '/works/[slug]', paths: ['/works/inito'] }];

  it('static page → its file', () => {
    expect(resolveLocalPageFile({ currentPageId: 'about', pages, dynamicInstances: dyn })).toBe('src/pages/about.astro');
    expect(resolveLocalPageFile({ currentPageId: 'index', pages, dynamicInstances: dyn })).toBe('src/pages/index.astro');
  });

  it('dynamic instance → the dynamic route file', () => {
    expect(resolveLocalPageFile({ currentPageId: localPageId('/works/inito'), pages, dynamicInstances: dyn })).toBe('src/pages/works/[slug].astro');
  });

  it('component view overrides everything', () => {
    expect(resolveLocalPageFile({ currentPageId: 'index', pages, dynamicInstances: dyn, componentViewFile: 'src/components/Hero.astro' })).toBe('src/components/Hero.astro');
  });

  it('unmatched page → null (never aliases another file)', () => {
    expect(resolveLocalPageFile({ currentPageId: 'page-someid', pages, dynamicInstances: dyn })).toBeNull();
    expect(resolveLocalPageFile({ currentPageId: null, pages, dynamicInstances: dyn })).toBeNull();
  });
});

// task-146: an empty local page (scan = bare wrapper only) collapses
// the canvas through the SAME isEmpty gate the other runtimes use — no big
// white viewport for a page with nothing on it.
describe('isLocalScanEmpty', () => {
  const wrapper = { tagName: 'SqHmrWriteBridge' };
  it('nothing but editor infrastructure → empty', () => {
    expect(isLocalScanEmpty([], false)).toBe(true);
    expect(isLocalScanEmpty([wrapper], false)).toBe(true);
  });
  it('a single drawn element IS content (the old ≤1 rule hid it)', () => {
    expect(isLocalScanEmpty([{ tagName: 'section' }], false)).toBe(false);
    expect(isLocalScanEmpty([wrapper, { tagName: 'div' }], false)).toBe(false);
  });
  it('lone-component view is never treated as empty (its scan is legitimately tiny)', () => {
    expect(isLocalScanEmpty([], true)).toBe(false);
  });
});

// task-148 (task-133 follow-up): local page DELETE removes the real file, so
// the resolution rule is shared byte-for-byte between the confirm modal (what
// the user is told will be deleted) and the endpoint (what actually gets rm'd).
describe('resolveLocalPageDeletion (task-148)', () => {
  const pages = [
    { route: '/', file: 'src/pages/index.astro' },
    { route: '/about', file: 'src/pages/about.astro' },
    { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', dynamic: true },
    { route: '/notes', file: 'src/pages/notes.md' },
  ];

  it('resolves a static .astro page to its real file', () => {
    expect(resolveLocalPageDeletion(pages, localPageId('/about'))).toEqual({
      ok: true, route: '/about', file: 'src/pages/about.astro',
    });
    expect(resolveLocalPageDeletion(pages, 'index')).toEqual({
      ok: true, route: '/', file: 'src/pages/index.astro',
    });
  });

  it('refuses the LAST remaining page — a site needs one', () => {
    const one = [{ route: '/', file: 'src/pages/index.astro' }];
    const res = resolveLocalPageDeletion(one, 'index');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/last page/i);
  });

  it('refuses a dynamic-route file (deleting it kills every instance)', () => {
    const res = resolveLocalPageDeletion(pages, localPageId('/works/[slug]'));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/dynamic/i);
  });

  it('refuses non-.astro pages (md/mdx are listed but not editable)', () => {
    const res = resolveLocalPageDeletion(pages, localPageId('/notes'));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/\.astro/);
  });

  it('unknown page id → refusal, never a fallback file (task-145 no-alias law)', () => {
    expect(resolveLocalPageDeletion(pages, 'page-abc').ok).toBe(false);
    expect(resolveLocalPageDeletion(pages, '').ok).toBe(false);
    // a dynamic INSTANCE (/works/inito) has no file of its own
    expect(resolveLocalPageDeletion(pages, localPageId('/works/inito')).ok).toBe(false);
  });

  it('two routes collapsing to the same page id → refuse (never guess which file to rm)', () => {
    const ambiguous = [
      { route: '/', file: 'src/pages/index.astro' },
      { route: '/a-b', file: 'src/pages/a-b.astro' },
      { route: '/a b', file: 'src/pages/a b.astro' },
    ];
    const res = resolveLocalPageDeletion(ambiguous, 'a-b');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/more than one/i);
  });
});

// Owner, 2026-08-10: "no go to post icon anymore in design bar" — a local
// dynamic-instance page must resolve back to the post it renders.
import { localPostTargetFor } from '../localMode';

describe('localPostTargetFor', () => {
  const collections = [
    { name: 'works', posts: [{ slug: 'Timepad-Redesign' }, { slug: 'untitled-123' }] },
  ];

  it('resolves a /collection/slug page to the disk post (filename-cased slug)', () => {
    expect(localPostTargetFor('/works/timepad-redesign', collections))
      .toEqual({ collection: 'works', slug: 'Timepad-Redesign' });
  });

  it('resolves a deeper route (owner 2026-09-24: /test collection/posts/<slug> could not be deleted)', () => {
    const deep = [{ name: 'test collection', posts: [{ slug: 'untitled-1' }] }];
    expect(localPostTargetFor('/test collection/posts/untitled-1', deep)).toEqual({ collection: 'test collection', slug: 'untitled-1' });
    expect(localPostTargetFor('/test%20collection/posts/untitled-1', deep)).toEqual({ collection: 'test collection', slug: 'untitled-1' });
  });

  it('null for static pages, unknown collections and unknown slugs', () => {
    expect(localPostTargetFor('/works', collections)).toBeNull();
    expect(localPostTargetFor('/about', collections)).toBeNull();
    expect(localPostTargetFor('/blog/timepad-redesign', collections)).toBeNull();
    expect(localPostTargetFor('/works/nope', collections)).toBeNull();
    expect(localPostTargetFor(null, collections)).toBeNull();
  });
});
