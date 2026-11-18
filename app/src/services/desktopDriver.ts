/**
 * Desktop driver for useLocalInstance: the project's Astro child lives in
 * Electron main (desktop/src/main.mjs). The renderer only holds a lease; every
 * /__sq/local/* call and every preview document read rides the scoped preload
 * IPC (`window.sqDesktop`) — main adds the instance secret, the renderer never
 * chooses an origin.
 *
 * open:  seed from Dexie only if the project is not on disk yet → start →
 *        full disk snapshot into the P0 Dexie mirror → transport installed.
 * stop:  user acceptance + mirror drain, then the lease is released. Accepted
 *        but unmaterialized source commands stay in the durable journal.
 */
import { setSiteAstro } from '@/utils/siteAstro';
import { db } from '@/db';
import { readProjectFiles, putProjectFiles, deleteAllProjectFiles, deleteProjectFile, listProjectFilePaths } from '@/db/projectFiles';
import type { LocalInstanceDriver } from '@/hooks/useLocalInstance';
import { setLocalTransport, setWaitForLocalTransport } from '@/utils/sqLocalBase';
import { startFilesTruthSync, stopFilesTruthSync, syncChangedFiles } from './filesTruthSync';
import { setActiveProjectForSave } from './pendingProjectMutations';
import { awaitUserAccepted, pushUserHeldInput } from './durableEdits/acceptance';
import { makeTransport } from './localTransport';
import { isOwnWrite, noteAgentActivity } from './agentPresence';
import { noteAgentWrite } from './agentCanvasActivity';

interface State { id: string; lease: string; phase: string; generation?: number; url?: string | null; error?: string | null; detail?: string | null }
interface Result { url: string; generation: number }
interface IpcResponse { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer }
interface DiskChange { files: Record<string, Uint8Array>; gone: string[] }
export interface SqDesktop {
  exists(id: string): Promise<boolean>;
  start(id: string, lease: string, seed?: Record<string, string | Uint8Array>): Promise<Result>;
  stop(id: string, lease: string): Promise<void>;
  snapshot(id: string, lease: string): Promise<Record<string, Uint8Array>>;
  status(id: string, lease: string): Promise<{ phase: string; error?: string | null }>;
  fetch(id: string, lease: string, requestId: string, kind: string, route: string,
    init: { method: string; headers: [string, string][]; body?: ArrayBuffer }): Promise<IpcResponse>;
  abort(id: string, lease: string, requestId: string): Promise<void>;
  onState(callback: (state: State) => void): () => void;
  git(id: string, lease: string, op: string, args?: Record<string, unknown>): Promise<unknown>;
  terminal: {
    attach(id: string, lease: string): Promise<string>;
    input(id: string, lease: string, data: string): Promise<void>;
    resize(id: string, lease: string, cols: number, rows: number): Promise<void>;
    onOutput(callback: (id: string, data: string) => void): () => void;
  };
  onDiskChanged(callback: (id: string, change: DiskChange) => void): () => void;
  /** Quit / window-close handshake (desktop/src/quit-flush.mjs): main asks the editor to push what it holds and accept it. */
  onFlushForQuit?(callback: () => void): () => void;
  quitFlushed?(): void;
}
const api = (): SqDesktop => (globalThis as { sqDesktop?: SqDesktop }).sqDesktop!;
export const isDesktop = (): boolean => typeof globalThis !== 'undefined' && !!(globalThis as { sqDesktop?: SqDesktop }).sqDesktop;

interface Boot {
  id: string; path: string; lease: string; claimed: boolean; retired: boolean; sent: boolean;
  recovery: boolean; url: string; promise: Promise<Result>; stopping?: Promise<void>;
}

export function createDesktopDriver(getApi: () => SqDesktop) {
  let latest: Boot | null = null; let owner: Boot | null = null; let off: (() => void) | null = null;
  const cancelled = (): DOMException => new DOMException('Desktop owner changed', 'AbortError');
  const valid = (b: Boot): boolean => b.claimed && !b.retired && latest === b;
  function ensure(b: Boot): void { if (!valid(b)) throw cancelled(); }

  async function request(b: Boot, kind: string, route: string, init?: RequestInit): Promise<Response> {
    if (owner !== b) throw cancelled();
    const req = new Request(b.url + route, init); const requestId = crypto.randomUUID();
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
    req.signal.throwIfAborted();
    const abort = (): void => { void getApi().abort(b.id, b.lease, requestId).catch(() => {}); };
    const sent = getApi().fetch(b.id, b.lease, requestId, kind, route, { method: req.method, headers: [...req.headers], body });
    req.signal.addEventListener('abort', abort, { once: true });
    try {
      const r = await sent; req.signal.throwIfAborted();
      if (owner !== b) throw cancelled();
      return new Response([204, 205, 304].includes(r.status) || req.method === 'HEAD' ? null : r.body,
        { status: r.status, statusText: r.statusText, headers: r.headers });
    } finally { req.signal.removeEventListener('abort', abort); }
  }

  /** Disk → Dexie. Catches uploads/external edits made while no renderer ran. */
  async function mirror(b: Boot): Promise<void> {
    const files = await getApi().snapshot(b.id, b.lease); ensure(b);
    setSiteAstro(files['package.json']); // generators write this site's Astro shapes (utils/siteAstro)
    await db.transaction('rw', db.projectFiles, async () => {
      ensure(b); await deleteAllProjectFiles(b.id);
      await putProjectFiles(b.id, Object.entries(files).map(([path, content]) => ({ path, content })));
    });
    ensure(b);
  }

  /** Disk writes in the open project (ours echoed, and every outside writer's —
   *  an agent in the terminal, another app): the changed paths → Dexie; a gone
   *  path takes everything under it. Then the open editors merge them live
   *  (`sq:files-changed`, agent multiplayer 2026-11-08) and a write that is not
   *  ours shows the agent at work (ledger G2/G5). */
  async function applyDiskChange(b: Boot, change: DiskChange): Promise<void> {
    const rows = change.gone.length ? await listProjectFilePaths(b.id) : [];
    if (owner !== b) return;
    await db.transaction('rw', db.projectFiles, async () => {
      for (const p of rows) if (change.gone.some(g => p === g || p.startsWith(`${g}/`))) await deleteProjectFile(b.id, p);
      await putProjectFiles(b.id, Object.entries(change.files).map(([path, content]) => ({ path, content })));
    });
    window.dispatchEvent(new CustomEvent('sq:files-changed', { detail: { projectId: b.id, files: Object.keys(change.files), gone: change.gone } }));
    const theirs = Object.entries(change.files).find(([path, bytes]) => /^src\/.+\.(astro|mdx?|css|[jt]sx?|json)$/.test(path)
      && !isOwnWrite(b.id, path, new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)));
    if (theirs) { noteAgentActivity({ projectId: b.id, file: theirs[0] }); noteAgentWrite(b.id); }
  }
  function withOwner<T>(id: string, run: (b: Boot) => Promise<T>): Promise<T> {
    const b = owner; return b && b.id === id ? run(b) : Promise.reject(cancelled());
  }

  function retire(b: Boot): Promise<void> {
    if (b.stopping) return b.stopping;
    b.retired = true;
    b.stopping = (async () => {
      if (owner === b) {
        await awaitUserAccepted(b.id);
        // Mirror-only drain. Pending accepted source intents stay in the
        // durable journal; navigation does not force all source work.
        await syncChangedFiles().catch(error => console.error('[desktop mirror]', error));
        stopFilesTruthSync(); setLocalTransport(null); owner = null;
      }
      if (b.sent) await getApi().stop(b.id, b.lease);
      await b.promise.catch(() => {});
      if (latest === b) { setWaitForLocalTransport(false); latest = null; }
    })();
    return b.stopping;
  }

  function subscribe(): void {
    if (off) return;
    const offState = getApi().onState(state => {
      // Boot progress (e.g. installing a site's packages on its first open) for the current boot.
      if (latest && state.id === latest.id && state.lease === latest.lease && 'detail' in state) {
        window.dispatchEvent(new CustomEvent('sq:preview-progress', { detail: state.detail ?? null }));
      }
      const b = owner;
      if (!b || b.retired || b.recovery || state.id !== b.id || state.lease !== b.lease) return;
      // Main is already restarting the child; the hook reopens on a fresh lease.
      if (state.phase === 'starting' || state.phase === 'error') {
        b.recovery = true;
        window.dispatchEvent(new CustomEvent('sq:instance-lost', { detail: { reason: state.phase } }));
      }
    });
    const offDisk = getApi().onDiskChanged((id, change) => {
      const b = owner;
      if (b && b.id === id && !b.retired) void applyDiskChange(b, change).catch(error => console.error('[desktop outside edit]', error));
    });
    // Quit / window close: main stops the Astro sessions right after our answer (<= 2 s there whatever happens here). Push
    // the input the user is still typing, wait until the lane accepted it, then say so. A reload has no handshake: the
    // gesture stash is its net.
    const offFlush = getApi().onFlushForQuit?.(() => {
      const b = owner;
      void (async () => {
        try { if (b) { pushUserHeldInput(b.id); await awaitUserAccepted(b.id); } }
        catch (error) { console.error('[desktop quit flush]', error); }
        getApi().quitFlushed?.();
      })();
    });
    off = () => { offState(); offDisk(); offFlush?.(); };
  }

  const driver = {
    open(path: string, id: string): Promise<Result> {
      subscribe(); setWaitForLocalTransport(true, path);
      if (latest && latest.id === id && !latest.retired && !latest.recovery) {
        latest.claimed = true; return latest.promise;
      }
      const previous = latest; if (previous) previous.claimed = false;
      const b: Boot = { id, path, lease: crypto.randomUUID(), claimed: true, retired: false,
        sent: false, recovery: false, url: '', promise: Promise.resolve({ url: '', generation: 0 }) };
      latest = b;
      b.promise = Promise.resolve().then(async () => {
        if (previous) await retire(previous); ensure(b);
        const exists = await getApi().exists(id); ensure(b);
        const seed = exists ? undefined : await readProjectFiles(id); ensure(b);
        b.sent = true; const result = await getApi().start(id, b.lease, seed); ensure(b);
        b.url = result.url;
        await mirror(b); ensure(b);
        owner = b; setActiveProjectForSave(id); startFilesTruthSync(id);
        setLocalTransport(makeTransport(path, (route, init) => request(b, 'local', route, init)));
        // Our Stack/Media components ship improvements: upgrade stale copies once the instance answers.
        void import('./sqComponentUpgrade').then((m) => m.upgradeSqComponentsOnOpen())
          .catch((err) => console.warn('[desktop] sq component upgrade skipped', err));
        return result;
      });
      void b.promise.catch(() => { queueMicrotask(() => { void retire(b).catch(console.error); }); });
      return b.promise;
    },
    async probe(url: string): Promise<boolean> {
      const b = owner; if (!b || b.url !== url) return false;
      try { const r = await request(b, 'bridge', '/scripts/bridge.js'); return r.ok && /javascript/i.test(r.headers.get('content-type') ?? ''); }
      catch { return false; }
    },
    captureDocumentReader(url: string) {
      const b = owner; const target = new URL(url);
      return (init: RequestInit): Promise<Response> => {
        if (!b || target.origin !== b.url) return Promise.reject(cancelled());
        return request(b, 'document', target.pathname + target.search, init);
      };
    },
    /** A document GET on the current owner (no url in hand), e.g. a route-ready poll. */
    fetchDocument(route: string, init?: RequestInit): Promise<Response> {
      const b = owner; if (!b) return Promise.reject(cancelled());
      return request(b, 'document', route, init);
    },
    async status() {
      if (!latest) return null;
      const s = await getApi().status(latest.id, latest.lease).catch(() => ({ phase: 'error', error: 'Instance unavailable' }));
      return { status: s.phase, error: s.error ?? undefined };
    },
    stop(path: string): void {
      const b = latest; if (!b || b.path !== path) return;
      b.claimed = false;
      queueMicrotask(() => { if (!b.claimed) void retire(b).catch(console.error); });
    },
    /** Versions + GitHub op on the open project (desktop/src/git/ops.mjs); the lease proves ownership. */
    git(id: string, op: string, args?: Record<string, unknown>): Promise<unknown> {
      const b = owner; if (!b || b.id !== id) return Promise.reject(cancelled());
      return getApi().git(b.id, b.lease, op, args);
    },
    /** Disk → Dexie again after an op rewrote the folder (restore, pull, branch switch…). */
    async remirror(id: string): Promise<void> {
      const b = owner; if (!b || b.id !== id) throw cancelled();
      await mirror(b);
    },
    /** The open project's MCP-mode terminal (desktop/src/terminal.mjs); every call rides the CURRENT owner's lease. */
    terminal: {
      attach: (id: string): Promise<string> => withOwner(id, b => getApi().terminal.attach(b.id, b.lease)),
      input: (id: string, data: string): Promise<void> => withOwner(id, b => getApi().terminal.input(b.id, b.lease, data)),
      resize: (id: string, cols: number, rows: number): Promise<void> => withOwner(id, b => getApi().terminal.resize(b.id, b.lease, cols, rows)),
      onOutput: (callback: (id: string, data: string) => void): (() => void) => getApi().terminal.onOutput(callback),
    },
    async close(): Promise<void> { const b = latest; if (b) { b.claimed = false; await retire(b); } off?.(); off = null; },
  } satisfies LocalInstanceDriver & { close(): Promise<void>; fetchDocument(route: string, init?: RequestInit): Promise<Response>;
    git(id: string, op: string, args?: Record<string, unknown>): Promise<unknown>; remirror(id: string): Promise<void>; terminal: object };
  return driver;
}

export const desktopDriver = createDesktopDriver(api);
import.meta.hot?.dispose(() => { if (isDesktop()) void desktopDriver.close(); });

