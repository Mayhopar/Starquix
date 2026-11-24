/**
 * task-133 wrong-file-write guard (live-smoke Critical).
 *
 * In local mode `currentPageFile` is derived from `currentPageId` and flips
 * SYNCHRONOUSLY when a Pages row is clicked, but the iframe navigation and the
 * rescan land milliseconds-to-seconds later — and if the switch never
 * propagates at all, never. In that window `scannedElements` still describes
 * the PREVIOUS page while `pageFile` names the new one, and every structural
 * op (⌘K insert, draw, delete, move, AI add) resolves its target from that
 * mismatched pair: the write lands in a real file the user is not looking at.
 * Observed live: a ⌘K on a freshly clicked page wrote `<Card />` into the
 * PREVIOUS page's `index.astro`. Same hazard class as task-145's alias bug.
 *
 * The gate is a POSITIVE check — "the last scan came from the route this page
 * expects" — never a timer, and never "some scanned element belongs to
 * pageFile" (a component-only page legitimately has NO node keyed to its own
 * file; that is exactly what the page-body anchor exists for).
 *
 * Two module-level values, each written by exactly ONE owner:
 * - expectedRoute: Editor (THE owner of currentPagePath) on every change;
 *   null disarms the gate entirely, so WC/server/legacy runtimes are
 *   byte-identical.
 * - scannedRoute: viewportMessages/scanning.ts from the ELEMENTS_SCANNED
 *   payload's `route` (window.location.pathname, stamped by the bridge — the
 *   parent cannot read a cross-origin iframe's URL).
 *
 * Arming a DIFFERENT expected route clears the scanned route: the old page's
 * scan must never vouch for the new page.
 */

import type * as Y from 'yjs';
import { db } from '@/db';
import { applyCommand } from '@/store/commands';
import { selectCurrentPageId } from '@/store/selectors';
import { announceLocalPage } from '@/store/localPages';
import { localPageId } from './localMode';
import { acceptFileChanges, finishAcceptedFiles, preparePageFilePlan, projectIdForFolder, type PageFilePlan } from '@/services/durableEdits/fileAcceptance';
import { localFetch } from './sqLocalBase';
import { routeForPageFile } from './localMode';
import type { SourceLocation } from '@/bridge';
import type { ScannedElement } from '@/context/SelectionContext';
import type { DurableFileChange, MaterializationCommand, SourceCoordinate } from '@/services/durableEdits/types';
import { getDurableEditStatus } from '@/services/durableEdits/status';
import { sourceVersion } from '@/services/durableEdits/sourceIdentity';
import { getActiveSaveProjectGeneration, getActiveSaveProjectId } from '@/services/pendingProjectMutations';

let expectedRoute: string | null = null;
let scannedRoute: string | null = null;
/** The elements of the scan that vouched for the current page — what a gesture
 *  made mid-switch runs against once that page lands (afterLocalPageArrives). */
let vouchedScan: ScannedElement[] | null = null;
/** The page the on-screen scan belongs to — kept through a pending switch. */
let scanPageFile: string | null = null;
let pageFile: string | null = null;
let surfaceGeneration = 0;
let scanStaleAfterWrite = false;
let staleReloadTimer: ReturnType<typeof setTimeout> | null = null;
/** How long a structural write may wait for HMR's full-reload before the
 *  canvas reloads itself (the iframe's HMR socket can be down — owner's Arc
 *  logs 2026-09-24: every load "[vite] failed to connect to websocket"). */
export const STALE_SCAN_RELOAD_MS = 3000;
const clearStaleReload = (): void => {
  if (staleReloadTimer) clearTimeout(staleReloadTimer);
  staleReloadTimer = null;
};
let sourceScanRevision = 0;
type AcceptedScanFile = { version: string | null; revision: number; locations?: SourceCoordinate[] };
/** `versions`: per file, the bytes version each accepted revision left behind
 *  (oldest first) — what lets a scan of an OLDER document name its revision. */
const acceptedSources = new Map<string, { revision: number; files: Map<string, AcceptedScanFile>; versions: Map<string, Array<{ revision: number; version: string }>> }>();
type SourceScanOwner = { generation: number; projectGeneration: number; revision: number };
const scannedSources = new Map<string, SourceScanOwner & { sourceVersion?: string }>();
const scannedClasses = new Map<string, SourceScanOwner & { sourceLocation: SourceLocation; classes: string }>();

/** Rendered class baselines belong to the admitted element, not a reused key. */
export function captureLocalSourceScanClasses(projectId: string, key: string): { sourceLocation: SourceLocation; classes: string } | undefined {
  const entry = scannedClasses.get(`${projectId}:${key}`);
  if (entry?.generation !== surfaceGeneration || entry.projectGeneration !== getActiveSaveProjectGeneration()) return undefined;
  return { sourceLocation: { ...entry.sourceLocation }, classes: entry.classes };
}

/** The accepted revision represented by the last admitted coordinate scan. */
export function getLocalSourceScanRevision(): number { return sourceScanRevision; }

/** Read-only ownership of a source in the latest authenticated surface scan.
 * Producers copy this evidence into durable selector intent before deferral. */
export function captureLocalSourceScanOwnership(projectId: string, file: string): Pick<SourceLocation, 'sourceVersion' | 'sourceRevision'> {
  const owner = scannedSources.get(`${projectId}:${file}`);
  if (owner?.generation === surfaceGeneration && owner.projectGeneration === getActiveSaveProjectGeneration()) {
    return { sourceRevision: owner.revision, ...(owner.sourceVersion ? { sourceVersion: owner.sourceVersion } : {}) };
  }
  return { sourceRevision: sourceScanRevision };
}

/** Freeze scan evidence before an owner waits in the acceptance lane. */
export function captureLocalSourceScan(projectId: string): (file: string) => Pick<SourceLocation, 'sourceVersion' | 'sourceRevision'> {
  const fallback = { sourceRevision: sourceScanRevision };
  const owners = new Map<string, Pick<SourceLocation, 'sourceVersion' | 'sourceRevision'>>();
  for (const [key, owner] of scannedSources) {
    if (key.startsWith(`${projectId}:`) && owner.generation === surfaceGeneration
      && owner.projectGeneration === getActiveSaveProjectGeneration()) {
      owners.set(key.slice(projectId.length + 1), { sourceRevision: owner.revision,
        ...(owner.sourceVersion ? { sourceVersion: owner.sourceVersion } : {}) });
    }
  }
  return file => ({ ...(owners.get(file) ?? fallback) });
}

/** The insertion result names a line; its accepted map supplies the exact
 * first opening-tag column, including indentation and component invocations. */
export function getLocalAcceptedSourceLocation(projectId: string, file: string, line: number): SourceLocation | undefined {
  const accepted = acceptedSources.get(projectId)?.files.get(file);
  const point = accepted?.locations?.filter(loc => loc.line === line).sort((a, b) => a.column - b.column)[0];
  return point && accepted?.version ? { file, ...point, sourceVersion: accepted.version, sourceRevision: accepted.revision } : undefined;
}

/** Called only after durable acceptance. This is scan admission evidence,
 * never an identity-map store: restart reconstructs maps from durable rows. */
export function noteLocalAcceptedSourceRevision(projectId: string, revision: number, commands: MaterializationCommand[]): void {
  const state = acceptedSources.get(projectId) ?? { revision: 0, files: new Map<string, AcceptedScanFile>(), versions: new Map<string, { revision: number; version: string }[]>() };
  const remember = (file: string, at: number, version: string | null | undefined) => {
    if (!version) return;
    const list = state.versions.get(file) ?? [];
    if (!list.some(entry => entry.revision === at && entry.version === version)) list.push({ revision: at, version });
    list.sort((a, b) => a.revision - b.revision);
    if (list.length > 200) list.splice(0, list.length - 200);
    state.versions.set(file, list);
  };
  for (const command of commands) {
    const payload = command.payload as { files?: DurableFileChange[]; preparedFiles?: DurableFileChange[] };
    const files = command.kind === 'file-batch' ? payload.files : payload.preparedFiles;
    for (const file of files ?? []) {
      const maps = file.identityMaps;
      // The bytes before this revision belong to revision - 1; after it, to revision.
      remember(file.file, revision - 1, maps?.length ? maps[0].beforeVersion
        : typeof file.beforeSource === 'string' && !file.encoding ? sourceVersion(file.beforeSource) : null);
      remember(file.file, revision, maps?.length ? maps[maps.length - 1].afterVersion
        : typeof file.afterSource === 'string' && !file.encoding ? sourceVersion(file.afterSource) : null);
      if (file.afterSource === null) state.files.set(file.file, { version: null, revision });
      else if (maps?.length) {
        const last = maps[maps.length - 1];
        state.files.set(file.file, { version: last.afterVersion, revision,
          locations: last.entries.flatMap(entry => entry.after ? [entry.after] : []) });
      } else if (!file.encoding) state.files.set(file.file, { version: sourceVersion(file.afterSource), revision });
    }
  }
  state.revision = Math.max(state.revision, revision);
  acceptedSources.set(projectId, state);
}

/** Boot restores admission evidence before the editor can consume iframe scans. */
export async function restoreLocalSourceScanState(projectId: string): Promise<void> {
  const { db } = await import('@/db');
  const rows = await db.durableEdits.where('projectId').equals(projectId).sortBy('revision');
  acceptedSources.delete(projectId);
  for (const row of rows) noteLocalAcceptedSourceRevision(projectId, row.revision, row.commands);
}

/** True when `loc` names bytes an accepted write has since replaced — the frame
 *  still shows the file as it WAS. Unknown bytes (an outside edit) are current. */
export function rendersSupersededSource(projectId: string | undefined, loc: SourceLocation | undefined): boolean {
  const list = projectId && loc?.sourceVersion ? acceptedSources.get(projectId)?.versions.get(loc.file) : undefined;
  return !!list?.length && list[list.length - 1].version !== loc!.sourceVersion && list.some(entry => entry.version === loc!.sourceVersion);
}

/** A scan vouches for the page when its route matches the current page's
 * route — nothing else. (The 2026-09-14 token/document/revision handshake
 * refused every scan that did not echo a parent-issued token, so structural
 * ops refused until it arrived; deleted 2026-09-16.) Stale coordinates are
 * projected through the accepted identity maps downstream, never gated here. */
export function admitLocalSourceScan(projectId: string | undefined, route: string | null,
  elements: Array<{ key?: string; classes?: string; sourceLocation?: SourceLocation; usageLocation?: SourceLocation }>): boolean {
  if (expectedRoute === null) { setLocalScannedRoute(route); return true; }
  if (route === null || normalizeRoute(route) !== expectedRoute) return false;
  const state = projectId ? acceptedSources.get(projectId) : undefined;
  const revision = state?.revision ?? (projectId ? getDurableEditStatus(projectId).acceptedRevision : 0);
  for (const key of scannedClasses.keys()) if (key.startsWith(`${projectId}:`)) scannedClasses.delete(key);
  // A scan names the revision its BYTES belong to, not the one current when it
  // arrived: the old document can rescan after a newer edit was accepted
  // (desktop 2026-10-04 — typing right after a canvas reorder), and stamping
  // it with the new revision made its coordinates skip that edit's map.
  const bytesRevision = (loc: SourceLocation): number => {
    const list = loc.sourceVersion ? state?.versions.get(loc.file) : undefined;
    if (!list?.length || list[list.length - 1].version === loc.sourceVersion) return revision;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].version === loc.sourceVersion) return list[i].revision;
    return revision; // unknown bytes: not ours to name — downstream refuses a real conflict
  };
  let scanRevision = revision;
  for (const element of elements) {
    if (element.sourceLocation) element.sourceLocation = { ...element.sourceLocation, sourceRevision: bytesRevision(element.sourceLocation) };
    if (element.usageLocation) element.usageLocation = { ...element.usageLocation, sourceRevision: bytesRevision(element.usageLocation) };
    if (element.sourceLocation) scanRevision = Math.min(scanRevision, element.sourceLocation.sourceRevision!);
    if (element.key && element.sourceLocation?.sourceVersion && typeof element.classes === 'string') {
      scannedClasses.set(`${projectId}:${element.key}`, { revision: element.sourceLocation.sourceRevision ?? revision, generation: surfaceGeneration,
        projectGeneration: getActiveSaveProjectGeneration(), sourceLocation: { ...element.sourceLocation }, classes: element.classes });
    }
    for (const loc of [element.sourceLocation, element.usageLocation]) if (loc) {
      scannedSources.set(`${projectId}:${loc.file}`, { revision: loc.sourceRevision ?? revision, generation: surfaceGeneration,
        projectGeneration: getActiveSaveProjectGeneration(), ...(loc.sourceVersion ? { sourceVersion: loc.sourceVersion } : {}) });
    }
  }
  vouchedScan = elements as ScannedElement[];
  scanPageFile = pageFile;
  setLocalScannedRoute(route, scanRevision);
  return true;
}

/** Detect navigation away and back while an asynchronous gesture is pending. */
export function getLocalSurfaceGeneration(): number { return surfaceGeneration; }

/** Strip query/hash, drop a trailing slash, treat '' and '/index.html' as '/'. */
function normalizeRoute(route: string): string {
  let r = route.split('#')[0].split('?')[0];
  if (r === '' ) return '/';
  r = r.replace(/\/index\.html?$/i, '/');
  if (r.length > 1) r = r.replace(/\/+$/, '');
  return r === '' ? '/' : r;
}

/**
 * Editor: the route the CURRENT page expects the iframe to be showing
 * (resolveLocalPagePath / the component-view route). null = not local mode →
 * the gate is disarmed and every op behaves exactly as before.
 */
export function setLocalExpectedRoute(route: string | null): void {
  const next = route === null ? null : normalizeRoute(route);
  if (next !== expectedRoute) {
    surfaceGeneration++;
    expectedRoute = next;
    scannedRoute = null; // the previous page's scan must not vouch for this one
    vouchedScan = null;
    scanStaleAfterWrite = false; // route gate takes over; new page's scan re-vouches
    clearStaleReload();
    // Editor re-arms a changed route in the same effect flush (cleanup → null,
    // setup → route); only a null that survives it is the editor going away.
    if (next === null) queueMicrotask(() => { if (expectedRoute === null) settleArrivals(false); });
  }
}

/** scanning.ts: the route the just-arrived ELEMENTS_SCANNED came from. */
export function setLocalScannedRoute(route: string | null, revision?: number): void {
  scannedRoute = route === null ? null : normalizeRoute(route);
  const projectId = getActiveSaveProjectId();
  sourceScanRevision = revision ?? (projectId ? getDurableEditStatus(projectId).acceptedRevision : 0);
  scanStaleAfterWrite = false; // a fresh scan re-vouches post-write coordinates
  clearStaleReload();
  scanVersion++;
  for (const cb of scanListeners) cb();
  if (expectedRoute !== null && scannedRoute === expectedRoute) settleArrivals(true);
}

/**
 * Monotonic scan counter + subscription, bumped on EVERY ELEMENTS_SCANNED —
 * including one whose element array is shallow-equal to the last (an EMPTY
 * page's scans always are, so SelectionContext suppresses the state update and
 * nothing re-renders). File-truth consumers (useLocalPageLayoutName) key their
 * re-reads on this, not on scannedElements identity — that identity gap is why
 * an empty-page layout apply left the Layers tree on the start-preview empty
 * state (round-3 blind-judge S1).
 */
let scanVersion = 0;
const scanListeners = new Set<() => void>();

export function getLocalScanVersion(): number {
  return scanVersion;
}

export function subscribeLocalScan(cb: () => void): () => void {
  scanListeners.add(cb);
  return () => scanListeners.delete(cb);
}

/** Resolves on the next scan arrival (or after `timeoutMs`): a write that
 *  full-reloads the iframe must not be followed by a bridge write until the
 *  reload has landed — it would never be delivered (task-240). */
export function waitForLocalScan(timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); unsub(); resolve(); };
    const unsub = subscribeLocalScan(done);
    const timer = setTimeout(done, timeoutMs);
  });
}

/**
 * Accepted source edits can leave the rendered scan behind. Source owners
 * project its owned coordinates through durable identity maps, so this flag
 * must never gate a subsequent edit. The canvas normally refreshes through
 * HMR's full-reload; when no fresh scan arrives in STALE_SCAN_RELOAD_MS the
 * preview reloads itself (a canvas that still shows a deleted element makes
 * the next edit on it fail — owner 2026-09-24).
 *
 * Set is a no-op while the gate is disarmed (expectedRoute null → WC/server/
 * legacy runtimes stay byte-identical).
 */
export function markLocalScanStaleAfterWrite(): void {
  if (expectedRoute === null) return;
  scanStaleAfterWrite = true;
  clearStaleReload();
  staleReloadTimer = setTimeout(() => {
    staleReloadTimer = null;
    if (scanStaleAfterWrite && typeof window !== 'undefined') window.dispatchEvent(new Event('sq:reload-preview'));
  }, STALE_SCAN_RELOAD_MS);
}

/** True between a successful local structural write and the next scan. */
export function isLocalScanStaleAfterWrite(): boolean {
  return scanStaleAfterWrite;
}

export function getLocalScannedRoute(): string | null {
  return scannedRoute;
}

export function getLocalExpectedRoute(): string | null {
  return expectedRoute;
}

/**
 * true when a structural write may proceed: either the gate is disarmed
 * (non-local runtime) or the last scan came from the current page's route.
 * A page whose scan has not landed yet is NOT in sync — refusing is the only
 * safe answer, since the alternative is writing into the previous page's file.
 */
export function isLocalPageInSync(): boolean {
  if (expectedRoute === null) return true;
  return scannedRoute !== null && scannedRoute === expectedRoute;
}

/** ponytail: fixed bound, covers a cold boot on a loaded machine (first scan
 *  ~25 s, 2026-11-10); a page that never scans shows its own failure state. */
export const LOCAL_PAGE_ARRIVAL_TIMEOUT_MS = 60_000;
/** A page-level edit whose page never arrived (editor closed, page never scanned). */
export const LOCAL_PAGE_NOT_LOADED_REASON = 'the canvas never finished loading the page — nothing was written';
const arrivalWaiters = new Set<(arrived: boolean) => void>();
function settleArrivals(arrived: boolean): void {
  for (const settle of [...arrivalWaiters]) settle(arrived);
}

/** true once the current page's scan has landed (at once when it has); false
 *  when the editor goes away or the page never lands. Newest switch wins. */
export function whenLocalPageInSync(): Promise<boolean> {
  if (isLocalPageInSync()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (arrived: boolean): void => { clearTimeout(timer); arrivalWaiters.delete(settle); resolve(arrived); };
    const timer = setTimeout(() => {
      console.warn(`[local-page-sync] ${expectedRoute} never scanned in ${LOCAL_PAGE_ARRIVAL_TIMEOUT_MS} ms — a pending edit was dropped`);
      settle(false);
    }, LOCAL_PAGE_ARRIVAL_TIMEOUT_MS);
    arrivalWaiters.add(settle);
  });
}

export type LocalPageArrival = { pageFile: string | null; scanned: ScannedElement[] };
let arrivalQueue: Promise<unknown> = Promise.resolve();
let insideArrivalRun = false;

/**
 * Owner 2026-11-10 ("it must just SWITCH, no delays no errors"): a page-level
 * edit made before the switched-to page has scanned is never refused — it runs
 * ON that page, with that page's own scan and file, once the scan lands (the
 * gate above still never lets a write resolve against another page's scan).
 * Edits queued behind one switch run one after another (each op then waits its
 * write turn — store/structuralWriteGuard — e.g. behind the Blog page's own
 * automatic slot re-emit that the same scan starts). `fallback` when the page
 * never lands, the editor goes away, or another project became active meanwhile.
 */
export function afterLocalPageArrives<T>(run: (page: LocalPageArrival) => Promise<T>, fallback: T): Promise<T> {
  const generation = getActiveSaveProjectGeneration();
  const armed = expectedRoute !== null;
  const arrive = async (): Promise<T> => {
    const arrived = await whenLocalPageInSync();
    if (!arrived || (armed && expectedRoute === null) || getActiveSaveProjectGeneration() !== generation) return fallback;
    // A run re-enters its op; should that op wait again it must not queue
    // behind itself (deadlock) — its synchronous prefix runs right here.
    insideArrivalRun = true;
    try { return run({ pageFile, scanned: vouchedScan ?? [] }); } finally { insideArrivalRun = false; }
  };
  if (insideArrivalRun) return arrive();
  const next = arrivalQueue.then(arrive);
  arrivalQueue = next.catch(() => undefined);
  return next;
}

/**
 * task-133 cross-file structural guard: the project-relative FILE backing the
 * current page (Editor's currentPageFile — src/pages/… or, in the component
 * view, the component's own file). Owned by the SAME Editor effect that arms
 * expectedRoute, so route and file can never describe different pages.
 *
 * A structural op whose target file differs from this one is a CROSS-FILE
 * edit: it changes a shared component for every page that uses it. null (boot,
 * non-local runtime, doc-only page) means "unknown" — callers must treat that
 * as cross-file, never as same-file (default-deny; the real incident was a
 * cross-file delete that gutted src/components/Header.astro).
 */
export function setLocalPageFile(file: string | null): void {
  if (file === pageFile) return;
  surfaceGeneration++;
  pageFile = file;
  for (const cb of pageFileListeners) cb();
}

export function getLocalPageFile(): string | null {
  return pageFile;
}

/** The page whose elements are on screen: the current page, or — while a
 *  switch is pending — the page being left. An element picked on the canvas or
 *  in Layers belongs to THIS page, and its edit lands there (owner 2026-11-10:
 *  nothing is lost). null: nothing on screen yet. */
export function getLocalScreenPageFile(): string | null {
  return isLocalPageInSync() ? pageFile : scanPageFile;
}

/** task-240: the page FILE can change under an unchanged route (the
 *  pagination move `blog.astro` ⇄ `blog/[...page].astro`). File-truth readers
 *  keyed on the scan alone raced the Editor's effect that publishes the new
 *  path (child effects run first) and read a 404; subscribe here too. */
const pageFileListeners = new Set<() => void>();
export function subscribeLocalPageFile(cb: () => void): () => void {
  pageFileListeners.add(cb);
  return () => pageFileListeners.delete(cb);
}

/**
 * Read a local project page file's current bytes off the host endpoint.
 * The ONE spelling of the `/__sq/local/page-source` call (both params are
 * encodeURIComponent'd; the endpoint answers `{ content: string }`).
 *
 * Returns null for EVERY failure — non-2xx, network error, unparseable or
 * contentless body — so callers branch on one value instead of re-deriving
 * the same try/catch. Files are truth: a null here means "couldn't read it",
 * never "the file is empty" (an empty file answers with '').
 */
export async function fetchLocalPageSource(
  projectPath: string,
  file: string,
): Promise<string | null> {
  try {
    const r = await localFetch(
      `/__sq/local/page-source?path=${encodeURIComponent(projectPath)}&file=${encodeURIComponent(file)}`,
    );
    if (!r.ok) return null;
    const body = (await r.json()) as { content?: unknown };
    return typeof body?.content === 'string' ? body.content : null;
  } catch {
    return null;
  }
}

/**
 * The project's page ROUTES off `/__sq/local/pages` (the same list the
 * instance discovery reads). [] on any failure — a missing list only means
 * "no detail route detected", never an error surface (task-240 post links).
 */
export async function fetchLocalPages(projectPath: string): Promise<Array<{ route: string; file: string }>> {
  try {
    const r = await localFetch(`/__sq/local/pages?path=${encodeURIComponent(projectPath)}`);
    if (!r.ok) return [];
    const body = (await r.json()) as { pages?: Array<{ route?: unknown; file?: unknown }> };
    return (body?.pages ?? [])
      .filter((p): p is { route: string; file: string } => typeof p.route === 'string' && typeof p.file === 'string')
      .map((p) => ({ route: p.route, file: p.file }));
  } catch {
    return [];
  }
}
export async function fetchLocalPageRoutes(projectPath: string): Promise<string[]> {
  return (await fetchLocalPages(projectPath)).map((p) => p.route);
}

/**
 * task-240 pagination: move a page FILE (`blog.astro` ⇄ `blog/[...page].astro`)
 * through the journaled `/__sq/local/page-move` route, then re-announce the
 * (unchanged) route with its new file so useLocalInstance re-maps it. Throws
 * with the route's error on refusal; the doc page row is untouched.
 */
export async function moveLocalPageFile(projectPath: string, from: string, to: string): Promise<{ from: string; to: string }> {
  let body!: PageFilePlan;
  const accepted = await acceptFileChanges(projectPath, async () => {
    body = await preparePageFilePlan(projectPath, { action: 'move', from, to }); return body.files;
  });
  void finishAcceptedFiles(accepted);
  if (typeof window !== 'undefined') {
    const route = routeForPageFile(to);
    window.dispatchEvent(new CustomEvent('sq:local-page-deleted', { detail: { route, file: body.from ?? from } }));
    window.dispatchEvent(new CustomEvent('sq:local-page-created', { detail: { route, file: body.to, editable: true } }));
  }
  return { from, to };
}

/** Test-only reset. */
export function _resetLocalPageSyncForTests(): void {
  expectedRoute = null;
  scannedRoute = null;
  vouchedScan = null;
  scanPageFile = null;
  arrivalWaiters.clear();
  arrivalQueue = Promise.resolve();
  insideArrivalRun = false;
  pageFile = null;
  sourceScanRevision = 0;
  acceptedSources.clear();
  scannedSources.clear();
  scannedClasses.clear();
  scanStaleAfterWrite = false;
  clearStaleReload();
  scanVersion = 0;
  scanListeners.clear();
  pageFileListeners.clear();
}

// ============================================================================
// Local pages-lifecycle parity (2026-08-12 sweep, gaps 23/24/26)
// ============================================================================

/** Gap 24: 'Set as home' in local mode. A doc flag flip is a lie (savePageNow
 *  no-ops for local, seeding re-stamps isHome onto '/' every open) and a file
 *  swap (index.astro ↔ page) is too destructive to do silently — refuse
 *  honestly instead, so the Home badge never moves. ONE message for the UI
 *  toast and the AI tool refusal. */
export const LOCAL_HOME_IS_INDEX =
  'The home page is your index.astro — rename page files in your editor to change it.';

/** Gap 26: page order in local mode. src/pages has no order, so the editor
 *  keeps the root order (as routes) on the project row and the open-time
 *  seed sorts by it. Routes it has never seen keep their discovered order,
 *  after the known ones. */
export function sortByLocalPageOrder<T extends { route: string }>(pages: T[], order?: string[]): T[] {
  if (!order?.length) return pages;
  const rank = new Map(order.map((route, i) => [route, i]));
  const at = (route: string) => rank.get(route) ?? order.length;
  return [...pages].sort((a, b) => at(a.route) - at(b.route));
}

/** Persist the doc's root page order (a local page's name IS its route). */
export async function saveLocalPageOrder(doc: Y.Doc, projectId: string): Promise<void> {
  const pages = doc.getMap('pages');
  const order = doc.getArray<string>('rootPages').toArray()
    .map((id) => (pages.get(id) as Y.Map<unknown> | undefined)?.get('name'))
    .filter((name): name is string => typeof name === 'string');
  // An empty tree is a doc mid-hydrate, never a user's order.
  if (order.length) await db.projects.update(projectId, { pageOrder: order });
}

/**
 * Gap 23: THE local page rename. RENAME_PAGE on a local doc was a cosmetic
 * session-only edit — the row displayed a route that did not exist and the
 * name evaporated on reopen (seeding resets name = route). Files are truth:
 * the host endpoint moves the REAL src/pages file FIRST; only on success is
 * the doc row rekeyed to localPageId(newRoute), reusing the delete/restore
 * doc halves so the sq:local-page-created/-deleted events keep
 * useLocalInstance's route→file map current. The new row is added BEFORE the
 * old one is dropped — DELETE_PAGE refuses when the doc holds a single page.
 * Returns the new doc page id (=== pageId when the slug didn't change).
 */
export async function renameLocalDocPage(
  doc: Y.Doc,
  projectPath: string,
  pageId: string,
  name: string,
): Promise<string> {
  projectIdForFolder(projectPath, doc);
  let body!: PageFilePlan;
  const wasCurrent = selectCurrentPageId(doc) === pageId;
  const accepted = await acceptFileChanges(projectPath, async () => {
    body = await preparePageFilePlan(projectPath, { action: 'rename', pageId, name }); return body.files;
  }, doc, staged => {
    if (body.route === body.oldRoute) return;
    if (!applyCommand(staged, { type: 'ADD_PAGE', page: { id: localPageId(body.route), name: body.route, children: [], rootElementIds: [] } })
      || !applyCommand(staged, { type: 'DELETE_PAGE', pageId })) throw new Error('Page rename refused');
  });
  void finishAcceptedFiles(accepted);
  if (body.route === body.oldRoute) return pageId;
  const newId = localPageId(body.route);
  announceLocalPage('created', body.route, body.file);
  announceLocalPage('deleted', body.oldRoute!, body.oldFile!);
  if (wasCurrent) applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: newId });
  return newId;
}
