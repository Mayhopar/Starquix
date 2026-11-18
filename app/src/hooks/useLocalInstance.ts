// Lifecycle hook for a files-truth project's instance (desktop app boot).
// open → bounded start-poll (identity probe GET /scripts/bridge.js must be 200
// before we trust the url — squatter guard, ledger #4) → running → NO further
// polling (task-108 R1 discipline). Unmount stops the instance — we booted it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isLocalProjectId, PROJECT_NOT_READY, dynamicRoutePattern } from '@/utils/localMode';
import { slugify } from '@/utils/slugify';
import type { LocalPage } from '@/vite-plugin/project-fs';
import { localFetch } from '../utils/sqLocalBase';

/** Concrete instances of one dynamic route, discovered from the site's own
 *  links; parentRoute = the static page whose content links them (the page
 *  "where their content array is" — they nest under it in the Pages panel). */
export interface LocalDynamicInstances {
  route: string;
  parentRoute: string;
  paths: string[];
}

export interface LocalInstanceResult {
  status: 'idle' | 'starting' | 'running' | 'error';
  url: string | null;
  error: string | null;
  pages: LocalPage[];
  dynamicInstances: LocalDynamicInstances[];
  /** True once a discovery pass has RESOLVED for the current spawn — the gate
   *  that lets consumers trust dynamicInstances as complete (prune stale
   *  instance pages). False again on retry (mkState reset) so a re-starting
   *  instance's empty list is never mistaken for "all posts deleted". */
  discoveryDone: boolean;
  retry: () => void;
}

/** The status/url pick that iframe-src + writer gates consume. */
export type LocalInstanceLite = Pick<LocalInstanceResult, 'status' | 'url'>;

type LocalInstanceState = Omit<LocalInstanceResult, 'retry'>;

const mkState = (
  status: LocalInstanceState['status'],
  patch: Partial<LocalInstanceState> = {},
): LocalInstanceState => ({ status, url: null, error: null, pages: [], dynamicInstances: [], discoveryDone: false, ...patch });

/**
 * The instance lifecycle behind the hook. ONE contract, ONE implementation:
 * services/desktopDriver.ts — the desktop app boots the project's files with
 * the local-mode wrapper; the identity probe runs THROUGH its IPC transport
 * because the renderer never chooses an origin. (The host driver that
 * spawned a user's own folder was removed 2026-09-10 with the host-folder
 * disk; the interface stays so tests can inject a fake.)
 */
export type DocumentReaderFactory = (url: string) => (init: RequestInit) => Promise<Response>;
const nativeDocumentReader: DocumentReaderFactory = url => init => fetch(url, init);

export interface LocalInstanceDriver {
  open(path: string, projectId: string): Promise<{ url: string }>;
  /** The identity probe — the ONLY thing that promotes to running. */
  probe(url: string): Promise<boolean>;
  /** Capture one instance for a document GET; host callers default to native fetch. */
  captureDocumentReader?: DocumentReaderFactory;
  status(path: string): Promise<{ status?: string; error?: string } | null>;
  /** Fire-and-forget teardown (unmount AND pagehide). */
  stop(path: string): void;
}


const AUTO_RETRIES = 2;

interface Opts {
  probeIntervalMs?: number;
  maxWaitMs?: number;
  /** Backoff base for automatic restarts after a transient boot failure. */
  autoRetryDelayMs?: number;
  /** Required: there is no default driver any more. */
  driver: LocalInstanceDriver;
  /** Boot discovery waits for the canvas reveal (sq:canvas-revealed, 5 s cap): each
   *  discovery read compiles a page, and on a 17-page site those compiles in parallel with
   *  the visible page cost ~480 ms of open time (docs/plans/2026-10-04-desktop-perf-climb.md). */
  deferDiscovery?: boolean;
}

const DISCOVERY_READS = 3; // concurrent page compiles for discovery

/** Resolves when the canvas is first revealed (ViewportFrame), after capMs, or on abort. */
function afterCanvasPaint(signal: AbortSignal, capMs = 5000): Promise<void> {
  return new Promise(resolve => {
    const done = (): void => { clearTimeout(timer); window.removeEventListener('sq:canvas-revealed', done); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, capMs);
    window.addEventListener('sq:canvas-revealed', done);
    signal.addEventListener('abort', done);
  });
}

/** Promise.all over items with at most `limit` in flight, results in input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/**
 * Every entry in a content collection IS a page — that is the point of the
 * project, and it must not depend on whether the user's listing page happens to
 * link it. Link-scraping alone meant a post nothing linked yet simply did not
 * exist as far as the editor was concerned (owner, 2026-08-09).
 *
 * So the collection is the authority: for a dynamic route shaped
 * `/<segment>/[param]`, every file in the content collection named <segment>
 * contributes an instance. Astro derives the slug from the filename the same
 * way slugify does (lowercase, non-alphanumeric runs to single hyphens) —
 * confirmed against the served listing HTML: Timepad-Redesign.mdx →
 * /works/timepad-redesign.
 */
async function collectionInstances(
  projectPath: string,
  route: string,
): Promise<string[]> {
  const m = /^\/([^/]+)\/\[[^/\]]+\]$/.exec(route);
  if (!m) return [];                       // nested or multi-param: links only
  const collection = m[1];
  const files = await localFetch(`/__sq/local/content?path=${encodeURIComponent(projectPath)}`)
    .then(r => (r.ok ? (r.json() as Promise<{ files?: Record<string, string> }>) : null))
    .then(d => d?.files ?? {})
    .catch(() => ({} as Record<string, string>));
  const prefix = `src/content/${collection}/`;
  return Object.keys(files)
    .filter(f => f.startsWith(prefix) && /\.mdx?$/.test(f))
    .map(f => f.slice(prefix.length).replace(/\.mdx?$/, ''))
    .filter(name => !name.includes('/'))   // assets/subfolders are not entries
    .map(name => `/${collection}/${slugify(name)}`);
}

/** Scan each static page's rendered HTML for links matching each dynamic
 *  route's pattern ([...rest] → .+, [param] → [^/]+). First static page with
 *  a match becomes the parent (the listing page). Exported for tests. */
export async function discoverDynamicInstances(
  url: string,
  pages: LocalPage[],
  projectPath?: string | null,
  captureDocumentReader: DocumentReaderFactory = nativeDocumentReader,
  signal?: AbortSignal,
): Promise<LocalDynamicInstances[]> {
  const dynamic = pages.filter(p => p.dynamic);
  if (!dynamic.length) return [];
  const statics = pages.filter(p => !p.dynamic && p.route !== '/404');
  // Fetch + href-extract each static page once, DISCOVERY_READS at a time (cold astro dev
  // compiles per page: serial reads would sum those latencies, unbounded ones starve the canvas).
  const hrefsByRoute = new Map(await mapLimit(statics, DISCOVERY_READS, async (s): Promise<[string, string[]]> => {
    let html = '';
    try {
      const read = captureDocumentReader(`${url}${s.route}`);
      const response = await read({ cache: 'no-store', headers: { accept: 'text/html' }, signal });
      html = response.ok ? await response.text() : '';
    } catch { /* unavailable document; collection authority remains below */ }
    return [s.route, [...html.matchAll(/href="(\/[^"#?]*)"/g)]
      .map(m => (m[1].length > 1 ? m[1].replace(/\/$/, '') : m[1]))];
  }));
  const found: LocalDynamicInstances[] = [];
  for (const d of dynamic) {
    const pattern = dynamicRoutePattern(d.route);
    let parentRoute: string | null = null;
    const paths = new Set<string>();
    for (const s of statics) {
      const matches = (hrefsByRoute.get(s.route) ?? []).filter(h => pattern.test(h));
      if (matches.length && parentRoute === null) parentRoute = s.route;
      for (const m of matches) paths.add(m);
    }
    // The collection is the authority; links only add pages it cannot know
    // about (a hand-written route, an instance from another source).
    if (projectPath) {
      for (const p of (await collectionInstances(projectPath, d.route)).sort()) paths.add(p);
    }
    // With no linking page, nest under the listing route the dynamic route
    // lives in (/works for /works/[slug]) — or the site root as a last resort.
    if (parentRoute === null) {
      const listing = d.route.replace(/\/\[[^/\]]+\]$/, '');
      parentRoute = statics.some(s2 => s2.route === listing) ? listing
        : (statics.some(s2 => s2.route === '/') ? '/' : null);
    }
    if (paths.size && parentRoute) {
      found.push({ route: d.route, parentRoute, paths: [...paths] });
    }
  }
  return found;
}

export function useLocalInstance(
  projectId: string,
  path: string | null,
  opts: Opts,
): LocalInstanceResult {
  const { probeIntervalMs = 2000, maxWaitMs = 60_000, autoRetryDelayMs = 2000, driver, deferDiscovery = false } = opts;
  const isLocal = isLocalProjectId(projectId);
  const [attempt, setAttempt] = useState(0);
  const autoRetries = useRef(0);
  /** A full restart: forget the boot-failure budget and re-run open. */
  const restart = useCallback(() => { autoRetries.current = 0; setAttempt(a => a + 1); }, []);
  const [state, setState] = useState<LocalInstanceState>(() =>
    isLocal && !path ? mkState('error', { error: PROJECT_NOT_READY }) : mkState('idle'),
  );
  const openedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const discoveryRef = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelDiscovery = useCallback(() => {
    const previous = discoveryRef.current;
    discoveryRef.current = null;
    if (previous) { clearTimeout(previous.timer); previous.controller.abort(); }
  }, []);
  const runDiscovery = useCallback((url: string, pages: LocalPage[], afterPaint = false) => {
    cancelDiscovery();
    const controller = new AbortController();
    // This deadline bounds document reads only. The existing content endpoint
    // retains its own timing; ownership checks also fence its late completion.
    const pass = { controller, timer: setTimeout(() => controller.abort(), maxWaitMs) };
    discoveryRef.current = pass;
    void (afterPaint ? afterCanvasPaint(controller.signal) : Promise.resolve())
      .then(() => discoverDynamicInstances(url, pages, path, driver.captureDocumentReader, controller.signal)).then(found => {
      if (discoveryRef.current !== pass) return;
      setState(previous => discoveryRef.current === pass && previous.status === 'running' && previous.url === url
        ? { ...previous, dynamicInstances: found, discoveryDone: true } : previous);
    }).finally(() => { clearTimeout(pass.timer); });
  }, [cancelDiscovery, driver, path, maxWaitMs]);

  // task-133 Task 9 review: pages are fetched ONCE at boot — a page created
  // mid-session (Add Page / AI add_page → createLocalDocPage announces
  // sq:local-page-created) must join the session list or its route→file
  // mapping is missing (resolveLocalPageFile → null → structural writes
  // refuse). Appended with route-dedupe; a later full refetch (retry/reopen)
  // remains the server-truth reset.
  useEffect(() => {
    if (!isLocal) return;
    /**
     * A new POST is a new page too, and dynamic instances were discovered only
     * at boot — so a post created mid-session never showed up as a page until
     * the editor was reloaded (owner, 2026-08-09). contentOps already announces
     * every content change; re-scan on it.
     *
     * Cheap because discovery only refetches the static pages' HTML, and it is
     * debounced: creating a post fires several content-changed events.
     */
    let rescan: ReturnType<typeof setTimeout> | null = null;
    const onContentChanged = (): void => {
      if (rescan) clearTimeout(rescan);
      rescan = setTimeout(() => {
        const current = stateRef.current;
        // A successful current pass replaces even an empty result (deletion).
        // Superseded/canceled passes cannot publish into a newer owner.
        if (current.status === 'running' && current.url) runDiscovery(current.url, current.pages);
      // Astro has to re-sync the content collection AND re-render the listing
      // page before its HTML mentions the new post, so a tight debounce
      // re-scans too early and finds nothing. Deliberately slow.
      }, 1500);
    };
    window.addEventListener('sq:content-changed', onContentChanged);

    const onCreated = (e: Event): void => {
      const page = (e as CustomEvent<LocalPage>).detail;
      if (!page?.route || !page.file) return;
      setState(prev => prev.pages.some(p => p.route === page.route)
        ? prev
        : { ...prev, pages: [...prev.pages, page] });
    };
    // task-148 mirror: a deleted page's FILE is gone (deleteLocalDocPage
    // announces sq:local-page-deleted), so its route→file mapping must leave
    // the session list too — otherwise resolveLocalPageFile keeps handing
    // structural writes a path that no longer exists.
    const onDeleted = (e: Event): void => {
      const route = (e as CustomEvent<{ route?: string }>).detail?.route;
      if (!route) return;
      setState(prev => prev.pages.some(p => p.route === route)
        ? { ...prev, pages: prev.pages.filter(p => p.route !== route) }
        : prev);
    };
    window.addEventListener('sq:local-page-created', onCreated);
    window.addEventListener('sq:local-page-deleted', onDeleted);
    // The desktop driver saw the instance restart or fail under a live canvas.
    // Re-open: stop → warm respawn → new url → transport re-attached → the
    // canvas reloads. No banner, no manual retry.
    const onLost = (): void => {
      if (stateRef.current.status !== 'running') return;
      console.warn('[local instance] instance lost — rebooting the dev server');
      restart();
    };
    window.addEventListener('sq:instance-lost', onLost);
    return () => {
      if (rescan) clearTimeout(rescan);
      window.removeEventListener('sq:content-changed', onContentChanged);
      window.removeEventListener('sq:local-page-created', onCreated);
      window.removeEventListener('sq:local-page-deleted', onDeleted);
      window.removeEventListener('sq:instance-lost', onLost);
    };
  }, [isLocal, runDiscovery, restart]);

  useEffect(() => {
    if (!isLocal || !path) {
      if (isLocal && !path) {
        setState(mkState('error', { error: PROJECT_NOT_READY }));
      }
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const set = (s: LocalInstanceState): void => { if (!cancelled) setState(s); };
    // ponytail: a boot that dies is restarted a couple of times before anyone
    // is told.
    const fail = (s: LocalInstanceState): void => {
      if (cancelled) return;
      if (autoRetries.current >= AUTO_RETRIES) { set(s); return; }
      autoRetries.current++;
      console.warn('[local instance] restarting after a boot failure', s.error);
      retryTimer = setTimeout(() => { if (!cancelled) setAttempt(a => a + 1); }, autoRetryDelayMs * autoRetries.current);
    };

    (async () => {
      set(mkState('starting'));
      let url: string;
      try {
        openedRef.current = true; // an open that throws mid-boot still needs its stop
        url = (await driver.open(path, projectId)).url;
      } catch (e) {
        fail(mkState('error', { error: e instanceof Error ? e.message : String(e) }));
        return;
      }

      const deadline = Date.now() + maxWaitMs;
      while (!cancelled) {
        // Identity probe — the ONLY thing that promotes to running.
        const ok = await driver.probe(url);
        if (cancelled) return;
        if (ok) {
          let pages: LocalPage[] = [];
          try {
            const pr = await localFetch(`/__sq/local/pages?path=${encodeURIComponent(path)}`);
            pages = ((await pr.json()) as { pages?: LocalPage[] }).pages ?? [];
          } catch { /* pages list is non-fatal */ }
          if (cancelled) return;
          autoRetries.current = 0;
          set(mkState('running', { url, pages }));
          // Slug discovery (after running, non-blocking): scan static pages'
          // HTML for links matching each dynamic route; concrete instances
          // nest under the page whose content links them.
          runDiscovery(url, pages, deferDiscovery);
          return;
        }
        // Not up yet — ask the host whether the spawn died (stderr surfaced).
        const st = await driver.status(path);
        if (cancelled) return;
        if (st?.status === 'error') {
          fail(mkState('error', { url, error: st.error || 'astro dev crashed on startup.' }));
          return;
        }
        if (Date.now() > deadline) {
          fail(mkState('error', { url, error: 'Timed out waiting for the local instance to start.' }));
          return;
        }
        await new Promise(r => setTimeout(r, probeIntervalMs));
      }
    })();

    // ONE stop for both teardown vectors. React cleanup never runs when the
    // TAB closes, so the spawned astro child used to outlive the editor as an
    // orphan process on the user's machine (lifecycle law: we spawned it, we
    // kill it — 2026-08-26). sendBeacon survives page teardown; keepalive
    // fetch is the fallback. openedRef guards the double-fire (pagehide then
    // unmount).
    const sendStop = (): void => {
      if (!openedRef.current) return;
      openedRef.current = false;
      cancelDiscovery();
      driver.stop(path);
    };
    // ponytail: pagehide also fires on a tab RELOAD — the instance is killed
    // and the remount's /open respawns it. Slower reload, no orphans.
    window.addEventListener('pagehide', sendStop);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      cancelDiscovery();
      window.removeEventListener('pagehide', sendStop);
      sendStop();
    };
  }, [isLocal, path, attempt, probeIntervalMs, maxWaitMs, autoRetryDelayMs, driver, projectId, runDiscovery, cancelDiscovery, deferDiscovery]);

  return { ...state, retry: restart };
}
