// Instance lifecycle hook — open → identity probe → running, no polling after
// running, retry re-opens, unmount stops the instance. The driver is a fake
// (the real one is services/filesTruthDriver.ts); /__sq/local/* reads ride a
// fake transport — there is no host fetch any more.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLocalInstance, discoverDynamicInstances, type LocalInstanceDriver } from '../useLocalInstance';
import { resolveLocalPageFile, localPageId, markFilesTruth, unmarkFilesTruth, PROJECT_NOT_READY } from '@/utils/localMode';
import { setLocalTransport, resetLocalTransportForTests } from '@/utils/sqLocalBase';

const URL_ = 'http://localhost:5311';
const PAGES = [{ route: '/', file: 'src/pages/index.astro', editable: true }];

type Responder = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;

let fetchMock: ReturnType<typeof vi.fn>;
let probeOk = true;
let driver: LocalInstanceDriver & { open: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };

/** Every /__sq/local/* read goes through the transport; the driver
 *  owns open/probe/status/stop. `fetchMock` records the transport's calls. */
function installFetch(responder: Responder): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r = responder(url, init);
    if (!r) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response;
  });
  setLocalTransport({ projectPath: 'wc://browser_abc', fetch: (p, init) => fetchMock(p, init) as Promise<Response> });
  driver = {
    open: vi.fn(async () => ({ url: URL_ })),
    probe: async () => probeOk,
    status: async () => ({ status: 'starting' }),
    stop: vi.fn(),
  };
}

const happyResponder: Responder = (url) => {
  if (url.includes('/__sq/local/open')) return { status: 200, body: { url: URL_, port: 5311, status: 'starting' } };
  if (url.includes('/scripts/bridge.js')) return { status: 200 };
  if (url.includes('/__sq/local/pages')) return { status: 200, body: { pages: PAGES } };
  if (url.includes('/__sq/local/status')) return { status: 200, body: { status: 'starting' } };
  if (url.includes('/__sq/local/stop')) return { status: 200, body: { ok: true } };
  return undefined;
};

const OPTS = () => ({ probeIntervalMs: 10, maxWaitMs: 1000, autoRetryDelayMs: 5, driver });

beforeEach(() => { probeOk = true; markFilesTruth('browser_abc'); });
afterEach(() => { resetLocalTransportForTests(); unmarkFilesTruth('browser_abc'); vi.unstubAllGlobals(); });

describe('useLocalInstance', () => {
  it('sq:instance-lost (the driver saw the instance restart) re-opens the instance and runs at the NEW url — no banner, no manual retry', async () => {
    installFetch(happyResponder);
    driver.open = vi.fn().mockResolvedValueOnce({ url: URL_ }).mockResolvedValueOnce({ url: 'http://localhost:5312' });
    const { result } = renderHook(() => useLocalInstance('browser_abc', 'wc://browser_abc', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('running'));
    expect(result.current.url).toBe(URL_);
    act(() => { window.dispatchEvent(new CustomEvent('sq:instance-lost', { detail: { origin: URL_ } })); });
    await waitFor(() => expect(result.current.url).toBe('http://localhost:5312'));
    expect(result.current.status).toBe('running');
    expect(driver.stop).toHaveBeenCalledTimes(1); expect(driver.open).toHaveBeenCalledTimes(2);
  });

  it('inert for non-files-truth ids and null paths', () => {
    installFetch(happyResponder);
    const a = renderHook(() => useLocalInstance('browser_x', '/p', OPTS()));
    expect(a.result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    a.unmount();
    expect(fetchMock).not.toHaveBeenCalled(); // no stop for something never opened
  });

  it('files-truth id with no path yet: not-ready error, nothing opened', () => {
    installFetch(happyResponder);
    const { result } = renderHook(() => useLocalInstance('browser_abc', null, OPTS()));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(PROJECT_NOT_READY);
    expect(driver.open).not.toHaveBeenCalled();
  });

  it('open → identity probe 200 → pages → running; no polling after running; unmount stops', async () => {
    installFetch(happyResponder);
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('running'));
    expect(result.current.url).toBe(URL_);
    expect(result.current.pages).toEqual(PAGES);
    expect(driver.open).toHaveBeenCalledWith('/p', 'browser_abc');

    const countAtRunning = fetchMock.mock.calls.length;
    await act(() => new Promise(r => setTimeout(r, 100)));
    expect(fetchMock.mock.calls.length).toBe(countAtRunning); // bounded — no watchdog

    unmount();
    expect(driver.stop).toHaveBeenCalledWith('/p');
  });

  it('stays starting until the probe passes (squatter guard), then flips', async () => {
    probeOk = false;
    installFetch(happyResponder);
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('starting'));
    await act(() => new Promise(r => setTimeout(r, 50)));
    expect(result.current.status).toBe('starting'); // probe still failing → never running
    probeOk = true;
    await waitFor(() => expect(result.current.status).toBe('running'));
    unmount();
  });

  // task-133 Task 9 review: pages are fetched ONCE at boot — a page created
  // mid-session (Add Page / AI add_page → createLocalDocPage) must join the
  // session list or resolveLocalPageFile returns null and every structural
  // write on the new page refuses (dead-end retry loop).
  it('appends a sq:local-page-created page to the session pages list (deduped)', async () => {
    installFetch(happyResponder);
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('running'));

    const created = { route: '/about', file: 'src/pages/about.astro', editable: true };
    act(() => {
      window.dispatchEvent(new CustomEvent('sq:local-page-created', { detail: created }));
    });
    expect(result.current.pages).toEqual([...PAGES, created]);
    expect(resolveLocalPageFile({
      currentPageId: localPageId('/about'),
      pages: result.current.pages,
      dynamicInstances: result.current.dynamicInstances,
    })).toBe('src/pages/about.astro');

    // Duplicate route (e.g. a re-announce) must not double the entry.
    act(() => {
      window.dispatchEvent(new CustomEvent('sq:local-page-created', { detail: created }));
    });
    expect(result.current.pages).toEqual([...PAGES, created]);
    unmount();
  });

  // task-148: the mirror event — a deleted page's file is GONE, so its
  // route→file mapping must leave the session list too or structural writes
  // would keep targeting a file that no longer exists.
  it('drops a sq:local-page-deleted page from the session pages list', async () => {
    installFetch(happyResponder);
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('running'));

    const created = { route: '/about', file: 'src/pages/about.astro', editable: true };
    act(() => {
      window.dispatchEvent(new CustomEvent('sq:local-page-created', { detail: created }));
    });
    expect(result.current.pages).toEqual([...PAGES, created]);

    act(() => {
      window.dispatchEvent(new CustomEvent('sq:local-page-deleted', { detail: { route: '/about', file: 'src/pages/about.astro' } }));
    });
    expect(result.current.pages).toEqual(PAGES);
    expect(resolveLocalPageFile({
      currentPageId: localPageId('/about'),
      pages: result.current.pages,
      dynamicInstances: result.current.dynamicInstances,
    })).toBeNull();

    // An unknown route is a no-op — never a silent list reset.
    act(() => {
      window.dispatchEvent(new CustomEvent('sq:local-page-deleted', { detail: { route: '/ghost', file: 'x' } }));
    });
    expect(result.current.pages).toEqual(PAGES);
    unmount();
  });

  it('discoverDynamicInstances: slugs found in the linking page, nested under it', async () => {
    const pages = [
      { route: '/', file: 'src/pages/index.astro', editable: true },
      { route: '/about', file: 'src/pages/about.astro', editable: true },
      { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', editable: true, dynamic: true },
    ];
    installFetch((u) => {
      if (u === `${URL_}/`) return { status: 200, body: null };
      if (u === `${URL_}/about`) return { status: 200, body: null };
      return undefined;
    });
    // text() needed — extend the mock per-URL
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      const html = u === `${URL_}/`
        ? '<a href="/works/petcube">x</a><a href="/works/other/">y</a><a href="/about">a</a>'
        : '<a href="/">home</a>';
      return { ok: true, status: 200, text: async () => html } as unknown as Response;
    }));
    const found = await discoverDynamicInstances(URL_, pages);
    expect(found).toEqual([
      { route: '/works/[slug]', parentRoute: '/', paths: ['/works/petcube', '/works/other'] },
    ]);
  });

  // Content-tab post delete: discovery re-runs ~1.5s after sq:content-changed
  // and the SHRUNKEN result must replace dynamicInstances — even shrinking to
  // EMPTY (last post deleted), or the Pages tree keeps the stale row forever.
  // discoveryDone is the prune gate: false until a discovery pass resolves.
  it('content-changed rescan replaces dynamicInstances (even to empty) and sets discoveryDone', async () => {
    let files: Record<string, string> = { 'src/content/works/a.mdx': '' };
    const DPAGES = [
      { route: '/', file: 'src/pages/index.astro', editable: true },
      { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', editable: true, dynamic: true },
    ];
    installFetch((u) => {
      if (u.includes('/__sq/local/pages')) return { status: 200, body: { pages: DPAGES } };
      if (u.includes('/__sq/local/content')) return { status: 200, body: { files } };
      return { status: 200, body: {} };
    });
    // Page HTML for link scraping is a plain document GET on the instance url.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html></html>', json: async () => ({}) } as unknown as Response)));
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    expect(result.current.discoveryDone).toBe(false);
    await waitFor(() => expect(result.current.dynamicInstances).toEqual([
      { route: '/works/[slug]', parentRoute: '/', paths: ['/works/a'] },
    ]));
    expect(result.current.discoveryDone).toBe(true);

    files = {}; // the last post was deleted from the Content tab
    act(() => { window.dispatchEvent(new Event('sq:content-changed')); });
    await waitFor(() => expect(result.current.dynamicInstances).toEqual([]), { timeout: 4000 });
    unmount();
  });

  it('a transient boot failure restarts by itself and never surfaces an error state', async () => {
    let failures = 1;
    installFetch(happyResponder);
    const seen: string[] = [];
    driver.open = vi.fn(async () => {
      if (failures-- > 0) throw new Error('instance not ready');
      return { url: URL_ };
    });
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    const record = () => seen.push(result.current.status);
    await waitFor(() => { record(); expect(result.current.status).toBe('running'); });
    expect(driver.open).toHaveBeenCalledTimes(2);
    expect(seen).not.toContain('error');
    unmount();
  });

  it('driver-reported boot error → error state after automatic restarts; retry() re-runs open + probe', async () => {
    let failOpen = true;
    installFetch(happyResponder);
    driver.open = vi.fn(async () => {
      if (failOpen) throw new Error('Dependencies not installed — run npm install in /p');
      return { url: URL_ };
    });
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(driver.open).toHaveBeenCalledTimes(3);
    expect(result.current.error).toMatch(/npm install/);

    failOpen = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('running'));
    unmount();
  });
});

/**
 * Every MDX file in a content collection IS a page. Discovery used to depend on
 * the user's listing page linking it, so a post nothing linked yet did not
 * exist as far as the editor was concerned (owner, 2026-08-09).
 */
describe('discoverDynamicInstances from the collection itself', () => {
  const PAGES = [
    { route: '/', file: 'src/pages/index.astro', editable: true },
    { route: '/works', file: 'src/pages/works.astro', editable: true },
    { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', editable: true, dynamic: true },
  ] as never as Parameters<typeof discoverDynamicInstances>[1];

  // /__sq/local/content rides the transport; page HTML is a plain GET.
  function mockFetch(html: string, files: Record<string, string>) {
    setLocalTransport({ fetch: async () => new Response(JSON.stringify({ files })) });
    return vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) })) as unknown as typeof fetch;
  }

  it('lists a post no page links to, nested under the listing route', async () => {
    vi.stubGlobal('fetch', mockFetch('<html></html>', {
      'src/content/works/Timepad-Redesign.mdx': '---\n---\n',
      'src/content/works/brand-new.mdx': '---\n---\n',
    }));

    const found = await discoverDynamicInstances('http://x', PAGES, '/proj');

    expect(found).toEqual([{
      route: '/works/[slug]',
      parentRoute: '/works',
      paths: ['/works/brand-new', '/works/timepad-redesign'],
    }]);
  });

  it('ignores collection assets and subfolders', async () => {
    vi.stubGlobal('fetch', mockFetch('<html></html>', {
      'src/content/works/a.mdx': '',
      'src/content/works/images/hero.png': '',
      'src/content/works/nested/b.mdx': '',
    }));

    const [found] = await discoverDynamicInstances('http://x', PAGES, '/proj');
    expect(found.paths).toEqual(['/works/a']);
  });

  it('still unions in a linked path the collection cannot know about', async () => {
    vi.stubGlobal('fetch', mockFetch('<a href="/works/hand-written">x</a>', {
      'src/content/works/a.mdx': '',
    }));

    const [found] = await discoverDynamicInstances('http://x', PAGES, '/proj');
    // Linked paths keep the order the site lists them in; the collection's
    // own entries follow, sorted.
    expect(found.paths).toEqual(['/works/hand-written', '/works/a']);
  });
});

describe('tab-close kill (lifecycle law, 2026-08-26)', () => {
  // Closing the editor TAB never runs the React cleanup, so the spawned astro
  // child outlived the editor as an orphan on the user's machine — the
  // unmount-kills-child law only covered in-app unmounts. pagehide must send
  // the stop too (sendBeacon survives page teardown; keepalive fetch is the
  // fallback).
  it('pagehide sends the stop for an opened instance', async () => {
    installFetch(happyResponder);
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const { result, unmount } = renderHook(() => useLocalInstance('browser_abc', '/p', OPTS()));
    await waitFor(() => expect(result.current.status).toBe('running'));

    window.dispatchEvent(new Event('pagehide'));
    expect(driver.stop).toHaveBeenCalledTimes(1);

    // Already stopped — unmount must not send a second stop.
    unmount();
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });

  it('pagehide before open resolves sends nothing', async () => {
    installFetch(happyResponder);
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const { unmount } = renderHook(() => useLocalInstance('browser_x', '/p', OPTS()));
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).not.toHaveBeenCalled();
    expect(driver.stop).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useLocalInstance — driver seam (files-truth)', () => {
  it('a custom driver replaces open/probe/status/stop; no host fetches happen', async () => {
    const { markFilesTruth, unmarkFilesTruth } = await import('@/utils/localMode');
    markFilesTruth('browser_ft');
    const calls: string[] = [];
    const driver = {
      open: vi.fn(async (path: string, id: string) => { calls.push(`open ${path} ${id}`); return { url: 'https://instance.test' }; }),
      probe: vi.fn(async (url: string) => { calls.push(`probe ${url}`); return true; }),
      status: vi.fn(async () => null),
      stop: vi.fn((path: string) => { calls.push(`stop ${path}`); }),
    };
    const { setLocalTransport } = await import('@/utils/sqLocalBase');
    const transportRead = vi.fn(async (url: string) => {
      if (url.startsWith('/__sq/local/pages')) return new Response(JSON.stringify({ pages: [{ route: '/', file: 'src/pages/index.astro', editable: true }] }));
      throw new Error(`unexpected transport read: ${url}`);
    });
    fetchMock = vi.fn(async () => { throw new Error('fixture must not fetch from the host'); });
    vi.stubGlobal('fetch', fetchMock);
    setLocalTransport({ projectPath: 'wc://browser_ft', fetch: transportRead });
    let unmount: (() => void) | undefined;
    try {
      const view = renderHook(() => useLocalInstance('browser_ft', 'wc://browser_ft', { ...OPTS(), driver }));
      unmount = view.unmount;
      await waitFor(() => expect(view.result.current.status).toBe('running'));
      expect(view.result.current.url).toBe('https://instance.test');
      expect(calls.slice(0, 2)).toEqual(['open wc://browser_ft browser_ft', 'probe https://instance.test']);
      expect(transportRead).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
      unmount(); unmount = undefined;
      expect(driver.stop).toHaveBeenCalledWith('wc://browser_ft');
    } finally {
      unmount?.(); setLocalTransport(null); unmarkFilesTruth('browser_ft');
    }
  });
});

describe('discovery document reader ownership', () => {
  const pages = [...PAGES, { route: '/products/[slug]', file: 'src/pages/products/[slug].astro', dynamic: true, editable: true }];
  function setup() {
    installFetch(url => {
      if (url.includes('/__sq/local/pages')) return { status: 200, body: { pages } };
      if (url.includes('/__sq/local/content')) return { status: 200, body: { files: {} } };
      return undefined; // native instance HTML is forbidden
    });
    const pending: { url: string; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
    const driver = {
      open: vi.fn(async (path: string) => ({ url: `https://${path.slice(1)}.test` })),
      probe: vi.fn(async () => true), status: vi.fn(async () => null), stop: vi.fn(),
      captureDocumentReader: vi.fn((url: string) => (init: RequestInit) => new Promise<Response>(resolve => pending.push({ url, signal: init.signal!, resolve }))),
    };
    return { driver, pending };
  }
  const html = (slug: string) => new Response(`<a href="/products/${slug}">${slug}</a>`);

  it('uses the selected reader for boot and content rescan; a superseded pass cannot publish', async () => {
    const { driver, pending } = setup();
    const { result, unmount } = renderHook(() => useLocalInstance('browser_lf_a', '/a', { ...OPTS, maxWaitMs: 10_000, driver }));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => window.dispatchEvent(new Event('sq:content-changed')));
    await waitFor(() => expect(pending).toHaveLength(2), { timeout: 3000 });
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => { pending[0].resolve(html('old')); });
    expect(result.current.discoveryDone).toBe(false);
    await act(async () => { pending[1].resolve(html('current')); });
    await waitFor(() => expect(result.current.dynamicInstances[0]?.paths).toEqual(['/products/current']));
    expect(driver.captureDocumentReader).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('aborts reads on replacement/unmount and rejects old completion after the new owner starts', async () => {
    const { driver, pending } = setup();
    const { result, rerender, unmount } = renderHook(({ path }) => useLocalInstance('browser_lf_a', path, { ...OPTS, driver }), { initialProps: { path: '/a' } });
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ path: '/b' });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => { pending[0].resolve(html('old')); });
    expect(result.current.url).toBe('https://b.test');
    expect(result.current.dynamicInstances).toEqual([]);
    expect(result.current.discoveryDone).toBe(false);
    unmount();
    expect(pending[1].signal.aborted).toBe(true);
    await act(async () => { pending[1].resolve(html('unmounted')); });
  });

  it('deferDiscovery: no page is compiled for discovery before the canvas is revealed; then at most 3 at a time', async () => {
    const { driver, pending } = setup();
    const many = [...PAGES, ...Array.from({ length: 6 }, (_, i) => ({ route: `/p${i}`, file: `src/pages/p${i}.astro`, editable: true })),
      { route: '/products/[slug]', file: 'src/pages/products/[slug].astro', dynamic: true, editable: true }];
    installFetch(url => {
      if (url.includes('/__sq/local/pages')) return { status: 200, body: { pages: many } };
      if (url.includes('/__sq/local/content')) return { status: 200, body: { files: {} } };
      return undefined;
    });
    const { result, unmount } = renderHook(() => useLocalInstance('browser_lf_a', '/a', { ...OPTS(), maxWaitMs: 10_000, driver, deferDiscovery: true }));
    await waitFor(() => expect(result.current.status).toBe('running'));
    await new Promise(r => setTimeout(r, 50));
    expect(pending).toHaveLength(0);
    act(() => { window.dispatchEvent(new CustomEvent('sq:canvas-revealed')); });
    await waitFor(() => expect(pending).toHaveLength(3));
    await new Promise(r => setTimeout(r, 20));
    expect(pending).toHaveLength(3);
    await act(async () => { pending[0].resolve(html('a')); });
    await waitFor(() => expect(pending).toHaveLength(4));
    for (let i = 1; i < 7; i++) await act(async () => { await waitFor(() => expect(pending.length).toBeGreaterThan(i)); pending[i].resolve(html('x')); });
    await waitFor(() => expect(result.current.discoveryDone).toBe(true));
    unmount();
  });

  it('bounds document reads separately from the unchanged content endpoint', async () => {
    const { driver, pending } = setup();
    const { unmount } = renderHook(() => useLocalInstance('browser_lf_a', '/a', { ...OPTS, maxWaitMs: 40, driver }));
    await waitFor(() => expect(pending).toHaveLength(1));
    await waitFor(() => expect(pending[0].signal.aborted).toBe(true));
    unmount();
    pending[0].resolve(html('late'));
  });
});
