/**
 * task-133 wrong-file-write guard: a structural write must never target a
 * page the user is not actually looking at.
 *
 * currentPageFile flips SYNCHRONOUSLY with currentPageId, but the iframe
 * navigation and the rescan land later — in that window the (pageFile, scan)
 * pair belongs to two different pages and any structural op writes the wrong
 * real file. The gate is a POSITIVE check: the route the last scan came from
 * must be the route the current page expects.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { acquireStructuralWrite, tryAcquireStructuralWrite, releaseStructuralWrite, _resetStructuralWriteInFlightForTests } from '@/store/structuralWriteGuard';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';
import { vi, afterEach } from 'vitest';
import {
  fetchLocalPages,
  fetchLocalPageRoutes,
  moveLocalPageFile,
  setLocalPageFile,
  subscribeLocalPageFile,
  waitForLocalScan,
  setLocalExpectedRoute,
  setLocalScannedRoute,
  getLocalScannedRoute,
  isLocalPageInSync,
  admitLocalSourceScan,
  markLocalScanStaleAfterWrite,
  STALE_SCAN_RELOAD_MS,
  sortByLocalPageOrder,
  afterLocalPageArrives,
  LOCAL_PAGE_ARRIVAL_TIMEOUT_MS,
  type LocalPageArrival,
  _resetLocalPageSyncForTests,
} from '../localPageSync';

beforeEach(() => {
  _resetLocalPageSyncForTests();
});

describe('isLocalPageInSync', () => {
  it('expected route not armed (WC / server / legacy runtimes) → always in sync', () => {
    expect(isLocalPageInSync()).toBe(true);
    setLocalScannedRoute('/anything');
    expect(isLocalPageInSync()).toBe(true);
  });

  it('armed but no scan yet (boot) → NOT in sync', () => {
    setLocalExpectedRoute('/about');
    expect(isLocalPageInSync()).toBe(false);
  });

  it('scan route matches the expected route → in sync', () => {
    setLocalExpectedRoute('/about');
    setLocalScannedRoute('/about');
    expect(isLocalPageInSync()).toBe(true);
  });

  it('THE BUG: scan still on the previous page → NOT in sync', () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/'); // last scan was the index page
    expect(isLocalPageInSync()).toBe(false);
  });

  it('trailing slashes are normalized on both sides', () => {
    setLocalExpectedRoute('/about/');
    setLocalScannedRoute('/about');
    expect(isLocalPageInSync()).toBe(true);
    setLocalExpectedRoute('/about');
    setLocalScannedRoute('/about/');
    expect(isLocalPageInSync()).toBe(true);
  });

  it('root route: "/" and "" and "/index.html" all mean the index page', () => {
    setLocalExpectedRoute('/');
    setLocalScannedRoute('/');
    expect(isLocalPageInSync()).toBe(true);
    setLocalScannedRoute('');
    expect(isLocalPageInSync()).toBe(true);
    setLocalScannedRoute('/index.html');
    expect(isLocalPageInSync()).toBe(true);
  });

  it('route comparison is case-sensitive but ignores query/hash', () => {
    setLocalExpectedRoute('/blog/post-1');
    setLocalScannedRoute('/blog/post-1?x=1#top');
    expect(isLocalPageInSync()).toBe(true);
    setLocalScannedRoute('/blog/post-2');
    expect(isLocalPageInSync()).toBe(false);
  });

  it('component-view route (deep path with dots) compares literally', () => {
    setLocalExpectedRoute('/__sq_component_view/src/components/Card.astro');
    setLocalScannedRoute('/__sq_component_view/src/components/Card.astro');
    expect(isLocalPageInSync()).toBe(true);
    setLocalScannedRoute('/__sq_component_view/src/components/Other.astro');
    expect(isLocalPageInSync()).toBe(false);
  });

  it('disarming (leaving local mode) restores the always-in-sync default', () => {
    setLocalExpectedRoute('/about');
    setLocalScannedRoute('/');
    expect(isLocalPageInSync()).toBe(false);
    setLocalExpectedRoute(null);
    expect(isLocalPageInSync()).toBe(true);
  });

  it('changing the expected route INVALIDATES the recorded scan route', () => {
    setLocalExpectedRoute('/');
    setLocalScannedRoute('/');
    expect(isLocalPageInSync()).toBe(true);
    // user clicks another page: the old scan must not keep vouching for it
    setLocalExpectedRoute('/about');
    expect(getLocalScannedRoute()).toBeNull();
    expect(isLocalPageInSync()).toBe(false);
  });

  it('re-arming the SAME expected route keeps the scan (no spurious refusals)', () => {
    setLocalExpectedRoute('/about');
    setLocalScannedRoute('/about');
    setLocalExpectedRoute('/about');
    expect(isLocalPageInSync()).toBe(true);
  });

  it('2026-09-16: a route-matching scan vouches with no token/document/revision handshake', () => {
    setLocalExpectedRoute('/about');
    expect(isLocalPageInSync()).toBe(false);
    expect(admitLocalSourceScan('any-project', '/about', [])).toBe(true);
    expect(isLocalPageInSync()).toBe(true);
    expect(admitLocalSourceScan(undefined, '/about/', [])).toBe(true);
  });

  it('a scan for an unrelated route never marks a page in sync', () => {
    setLocalExpectedRoute('/about');
    setLocalScannedRoute(null);
    expect(isLocalPageInSync()).toBe(false);
  });
});

describe('stale canvas after a structural write (owner 2026-09-24: HMR socket down)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reloads the preview when no fresh scan follows the write', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    window.addEventListener('sq:reload-preview', reload);
    setLocalExpectedRoute('/');
    setLocalScannedRoute('/');
    markLocalScanStaleAfterWrite();
    vi.advanceTimersByTime(STALE_SCAN_RELOAD_MS);
    window.removeEventListener('sq:reload-preview', reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when HMR already rescanned the canvas', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    window.addEventListener('sq:reload-preview', reload);
    setLocalExpectedRoute('/');
    markLocalScanStaleAfterWrite();
    setLocalScannedRoute('/');
    vi.advanceTimersByTime(STALE_SCAN_RELOAD_MS * 2);
    window.removeEventListener('sq:reload-preview', reload);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('sortByLocalPageOrder (gap 26: page order persists)', () => {
  it('saved routes first in saved order, unknown routes after in discovered order', () => {
    const pages = ['/', '/about', '/blog', '/new'].map(route => ({ route }));
    expect(sortByLocalPageOrder(pages, ['/blog', '/', '/gone']).map(p => p.route)).toEqual(['/blog', '/', '/about', '/new']);
    expect(sortByLocalPageOrder(pages, undefined)).toBe(pages);
  });
});

describe('fetchLocalPageRoutes (task-240 post-link detection)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the routes of /__sq/local/pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pages: [{ route: '/', file: 'src/pages/index.astro' }, { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', dynamic: true }] }),
    }));
    expect(await fetchLocalPageRoutes('wc://p')).toEqual(['/', '/works/[slug]']);
  });

  it('[] on a failed or malformed answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchLocalPageRoutes('wc://p')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await fetchLocalPageRoutes('wc://p')).toEqual([]);
  });
});

describe('moveLocalPageFile (task-240 pagination route move)', () => {
  // Migrated 2026-09-23 (fdd2d12f made the move a durable file acceptance
  // planned by `/__sq/local/page-plan`; the direct `/__sq/local/page-move`
  // POST is gone): real route table + temp disk + fake-indexeddb.
  const BLOG = '---\n---\n<main>Blog</main>\n';
  let projectId: string;
  let runtime: ReturnType<typeof projectFsRuntime>;
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    await db.delete(); await db.open();
    projectId = `browser_move_${webcrypto.randomUUID()}`;
    setActiveSaveProjectId(projectId);
    runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': BLOG, 'src/pages/blog.astro': BLOG, 'src/pages/b.astro': BLOG });
  });
  afterEach(async () => {
    const { acceptedRevision } = await storage.getDurableProjectState(projectId);
    if (acceptedRevision) await flushDurableSourceWritesThrough(projectId, acceptedRevision);
    runtime.close();
    setActiveSaveProjectId(null);
    vi.unstubAllGlobals();
  });

  it('moves the real page file and re-announces the route with its new file', async () => {
    const events: Array<{ type: string; detail: unknown }> = [];
    const rec = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail });
    window.addEventListener('sq:local-page-deleted', rec);
    window.addEventListener('sq:local-page-created', rec);
    await moveLocalPageFile(`wc://${projectId}`, 'src/pages/blog.astro', 'src/pages/blog/[...page].astro');
    window.removeEventListener('sq:local-page-deleted', rec);
    window.removeEventListener('sq:local-page-created', rec);
    expect(events).toEqual([
      { type: 'sq:local-page-deleted', detail: { route: '/blog', file: 'src/pages/blog.astro' } },
      { type: 'sq:local-page-created', detail: { route: '/blog', file: 'src/pages/blog/[...page].astro', editable: true } },
    ]);
    await flushDurableSourceWritesThrough(projectId, (await storage.getDurableProjectState(projectId)).acceptedRevision);
    expect(existsSync(join(runtime.root, 'src/pages/blog.astro'))).toBe(false);
    expect(runtime.read('src/pages/blog/[...page].astro')).toBe(BLOG);
  });

  it('throws with the route error on a refused move', async () => {
    await expect(moveLocalPageFile(`wc://${projectId}`, 'src/pages/blog.astro', 'src/pages/b.astro')).rejects.toThrow(/already exists/);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read('src/pages/blog.astro')).toBe(BLOG);
  });
});

describe('subscribeLocalPageFile (task-240: the file can change under an unchanged route)', () => {
  it('notifies on a changed file only', () => {
    const cb = vi.fn();
    const unsub = subscribeLocalPageFile(cb);
    setLocalPageFile('src/pages/blog.astro');
    setLocalPageFile('src/pages/blog.astro'); // same → no notify
    setLocalPageFile('src/pages/blog/[...page].astro');
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    setLocalPageFile(null);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('waitForLocalScan', () => {
  it('resolves on the next scan, or on the timeout', async () => {
    let resolved = false;
    const p = waitForLocalScan(5000).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    setLocalScannedRoute('/blog');
    await p;
    expect(resolved).toBe(true);
    const t0 = Date.now();
    await waitForLocalScan(30);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});

describe('fetchLocalPages', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns route + file pairs; [] on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ pages: [{ route: '/blog', file: 'src/pages/blog.astro', editable: true }] }) }));
    expect(await fetchLocalPages('wc://p')).toEqual([{ route: '/blog', file: 'src/pages/blog.astro' }]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await fetchLocalPages('wc://p')).toEqual([]);
  });
});

// Owner 2026-11-10: "still switching pages try in the moment – it must just
// SWITCH, no delays no errors". An edit made before the switched-to page has
// scanned is never refused: it runs ON that page, with that page's own scan
// and file, as soon as the scan lands.
describe('afterLocalPageArrives', () => {
  const index = { key: 'src/pages/index.astro:4:1' };
  const about = { key: 'src/pages/about.astro:4:1' };
  const blog = { key: 'src/pages/blog.astro:4:1' };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const onIndex = () => { setLocalExpectedRoute('/'); setLocalPageFile('src/pages/index.astro'); admitLocalSourceScan(undefined, '/', [index] as never); };
  const clickPage = (route: string, file: string) => { setLocalExpectedRoute(route); setLocalPageFile(file); };
  afterEach(() => { vi.useRealTimers(); setActiveSaveProjectId(null); _resetStructuralWriteInFlightForTests(); });

  it('in sync → runs at once with the current page', async () => {
    onIndex();
    expect(await afterLocalPageArrives(async (page) => page, null)).toEqual({ pageFile: 'src/pages/index.astro', scanned: [index] });
  });

  it('mid-switch → waits, then runs with the switched-to page’s own scan and file', async () => {
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const run = vi.fn(async (page: LocalPageArrival) => page);
    const done = afterLocalPageArrives(run, null);
    await tick();
    expect(run).not.toHaveBeenCalled();
    admitLocalSourceScan(undefined, '/', [index] as never); // the outgoing document's late scan
    await tick();
    expect(run).not.toHaveBeenCalled();
    admitLocalSourceScan(undefined, '/about', [about] as never);
    expect(await done).toEqual({ pageFile: 'src/pages/about.astro', scanned: [about] });
  });

  it('rapid clicks → the newest page wins', async () => {
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const done = afterLocalPageArrives(async (page) => page, null);
    clickPage('/blog', 'src/pages/blog.astro');
    admitLocalSourceScan(undefined, '/about', [about] as never);
    admitLocalSourceScan(undefined, '/blog', [blog] as never);
    expect(await done).toEqual({ pageFile: 'src/pages/blog.astro', scanned: [blog] });
  });

  it('a route change re-arms in the same commit: never read as the editor going away', async () => {
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const done = afterLocalPageArrives(async (page) => page.pageFile, null);
    setLocalExpectedRoute(null); clickPage('/blog', 'src/pages/blog.astro'); // Editor effect cleanup → setup
    await tick();
    admitLocalSourceScan(undefined, '/blog', [blog] as never);
    expect(await done).toBe('src/pages/blog.astro');
  });

  it('edits queued behind one switch run one after another, in order', async () => {
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const order: string[] = [];
    let finishFirst!: () => void;
    const first = afterLocalPageArrives(async () => { order.push('first'); await new Promise<void>((r) => { finishFirst = r; }); order.push('first done'); }, undefined);
    const second = afterLocalPageArrives(async () => { order.push('second'); }, undefined);
    admitLocalSourceScan(undefined, '/about', [about] as never);
    await tick();
    expect(order).toEqual(['first']);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'first done', 'second']);
  });

  // Live 2026-11-10 (Blog page): the scan that releases the edit also starts
  // the page's own automatic slot re-emit, which takes the write guard first —
  // the edit then hit "Still saving the last change". It waits its turn instead.
  it('an edit released by the scan waits its write turn behind the page\'s own write, then runs', async () => {
    onIndex();
    clickPage('/blog', 'src/pages/blog.astro');
    let wrote = false;
    const done = afterLocalPageArrives(async () => {
      await acquireStructuralWrite();
      try { wrote = true; return true; } finally { releaseStructuralWrite(); }
    }, false);
    admitLocalSourceScan(undefined, '/blog', [blog] as never);
    expect(tryAcquireStructuralWrite()).toBe(true); // the page's automatic upgrade got there first
    await tick();
    expect(wrote).toBe(false);
    releaseStructuralWrite();
    expect(await done).toBe(true);
    expect(wrote).toBe(true);
  });

  it('the editor goes away while waiting → dropped, never run', async () => {
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const run = vi.fn();
    const done = afterLocalPageArrives(run, 'dropped');
    setLocalExpectedRoute(null);
    expect(await done).toBe('dropped');
    expect(run).not.toHaveBeenCalled();
  });

  it('another project is open when the page lands → dropped, never run', async () => {
    setActiveSaveProjectId('browser_a');
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const run = vi.fn();
    const done = afterLocalPageArrives(run, 'dropped');
    setActiveSaveProjectId('browser_b');
    admitLocalSourceScan(undefined, '/about', [about] as never);
    expect(await done).toBe('dropped');
    expect(run).not.toHaveBeenCalled();
  });

  it('the page never scans → dropped after the timeout', async () => {
    vi.useFakeTimers();
    onIndex();
    clickPage('/about', 'src/pages/about.astro');
    const run = vi.fn();
    const done = afterLocalPageArrives(run, 'dropped');
    await vi.advanceTimersByTimeAsync(LOCAL_PAGE_ARRIVAL_TIMEOUT_MS);
    expect(await done).toBe('dropped');
    expect(run).not.toHaveBeenCalled();
  });
});
