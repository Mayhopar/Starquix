/**
 * Web demo bridge (starquix-cloud web-demo/DESIGN.md): `SqDesktop` over HTTP, so a plain browser tab runs the editor
 * unchanged. Built with VITE_SQ_WEB=1, the entry (webDesktopEntry.ts) installs it as `globalThis.sqDesktop`, so
 * isDesktop() is true and desktopDriver opens projects the same way it does in Electron.
 *
 * The other end is web-host.mjs (Electron main's handlers without Electron), running in this visitor's own container
 * behind the demo Worker:
 *   POST {base}/call {name, args} → {ok, result} | {ok: false, error}   one call per SqDesktop method
 *   GET  {base}/events (SSE)      → data: {channel, args}               pushed `state` / `disk-changed`
 *   GET  {base}/session           → {active, endsAt, minutes, ...}     first request: sets the visitor cookie (Worker)
 *   POST {base}/session {token}   → begins a session after Turnstile   (sessionGate.ts; 401 on any call asks for one)
 * Binary values travel as {"$b64": "..."} both ways (web-host.mjs encode/decode).
 *
 * The event stream is the document's presence: when it drops, web-host releases every lease (ipc.mjs releaseAll), and
 * a container that slept or hit its time cap comes back empty. Either way the editor's leases are stale, so a loss
 * (stream error, silent stream, or a new container's boot id: see connect) reports each open lease as lost (phase
 * 'error'), and desktopDriver reopens on a fresh lease: web-host adopts the released instance, or `exists` is false
 * and the project re-seeds from Dexie.
 *
 * Not in the demo (DESIGN.md security #4, "Out for v1"): git (Versions, GitHub), terminal, MCP relay, update notifier.
 * There is no quit handshake: closing the tab is a renderer crash, and the durable journal covers that.
 */
import type { SqDesktop } from './desktopDriver';
import { createSessionGate, type GateReason, type SessionGate } from './sessionGate';

type State = Parameters<Parameters<SqDesktop['onState']>[0]>[0];
type DiskChange = Parameters<Parameters<SqDesktop['onDiskChanged']>[0]>[1];

export class WebDemoUnavailableError extends Error {
  constructor(feature: string) { super(`${feature} is not available in the web demo`); this.name = 'WebDemoUnavailableError'; }
}

// btoa/atob work on binary strings; chunked so a 25 MB body does not overflow the argument list.
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encode(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { $b64: toBase64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { $b64: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
export function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$b64 === 'string' && Object.keys(o).length === 1) return fromBase64(o.$b64);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

/** GET /api/session (the demo Worker; web-host answers it too, always active, under dev-local.sh). */
interface SessionInfo { active: boolean; endsAt: number | null; minutes: number; turnstileSiteKey: string }
/** The Worker's error shape ({error, message}, web-demo/src/policy.ts); plain text from anything else. */
async function errorOf(r: Response): Promise<{ code: string | null; message: string }> {
  const text = await r.text().catch(() => '');
  try { const j = JSON.parse(text) as { error?: string; message?: string }; if (j.message) return { code: j.error ?? null, message: j.message }; }
  catch { /* not JSON */ }
  return { code: null, message: text || `Demo host error (${r.status})` };
}

interface Deps {
  fetch?: typeof fetch; EventSource?: typeof EventSource;
  /** The Turnstile modal (default: sessionGate.ts, created on first need). */
  gate?: SessionGate;
  sendBeacon?: (url: string, data: Blob) => boolean;
  /** Where pagehide is heard (default: window, when there is one). */
  page?: Pick<Window, 'addEventListener'>;
}

/** Owner liveness (web-host.mjs `owners`): an open project's lease is touched this often. A start that finds the
 *  project owned waits there for the owner's next touch (alive: "Project still owned") or 15 s of silence (gone: the
 *  reload takes over its running Astro), so a lost pagehide beacon only costs that wait. */
export const TOUCH_MS = 5_000;

/** web-host.mjs pings every 5 s; this long without any message means nothing is behind the stream. */
export const STALE_MS = 15_000;
/** desktop/src/ipc.mjs sessions.get: the (id, lease) has no live session in this container. */
const STALE_LEASE = 'Stale instance lease';
/** Calls whose first two args are (id, lease). */
const LEASED = new Set(['snapshot', 'status', 'fetch', 'abort']);

export function createWebDesktop(base = '/api', deps: Deps = {}): SqDesktop {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const Source = deps.EventSource ?? globalThis.EventSource;
  let gateUi: SessionGate | null = deps.gate ?? null;
  // One request first, alone: without the visitor cookie, parallel first requests would each get a fresh container.
  // It is GET /session, which the Worker answers itself: it never starts a container.
  let info: Promise<SessionInfo> | null = null;
  const handshake = (): Promise<SessionInfo> => info ??= doFetch(`${base}/session`, { credentials: 'same-origin' })
    .then(async r => { if (!r.ok) throw new Error((await errorOf(r)).message); return await r.json() as SessionInfo; })
    .catch((error: unknown) => { info = null; throw error; }); // retry on the next call, don't poison the bridge

  // Sessions (DESIGN.md security #9): the Worker starts a container only inside one, and ends it at its time cap.
  // Without one, every call answers 401 and the gate asks the visitor to pass Turnstile and begin one.
  let active = false; let gating: Promise<void> | null = null;
  async function session(): Promise<void> {
    if (active) return;
    if ((await handshake()).active) { active = true; return; }
    await ensureSession('required');
  }
  function ensureSession(reason: GateReason): Promise<void> {
    active = false;
    return gating ??= (async () => {
      const i = await handshake(); let message: string | undefined;
      gateUi ??= createSessionGate();
      for (;;) {
        const token = await gateUi.prompt({ reason, minutes: i.minutes, siteKey: i.turnstileSiteKey, message });
        const r = await doFetch(`${base}/session`, { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
        if (r.ok) break;
        message = (await errorOf(r)).message; // full, budget, paused, per-IP, failed check: shown, then try again
      }
      gateUi.close(); active = true;
      if (reason === 'ended') markLost(); // the container went with the session: every lease is gone
      restartStream(); // a stream refused without a session is closed for good
    })().finally(() => { gating = null; });
  }

  async function call<T>(name: string, ...args: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await session();
      const r = await doFetch(`${base}/call`, { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args: encode(args) }) });
      if (r.status === 401 && attempt < 2) {
        const { code } = await errorOf(r);
        await ensureSession(code === 'session-ended' ? 'ended' : 'required');
        continue;
      }
      // The Worker's own refusals ({error, message}: full, ...) and anything else that is not web-host answering.
      if (!r.ok) throw new Error((await errorOf(r)).message);
      return await answer<T>(name, args, r);
    }
  }
  async function answer<T>(name: string, args: unknown[], r: Response): Promise<T> {
    const out = await r.json() as { ok: boolean; result?: unknown; error?: string };
    if (!out.ok) {
      // A lease we hold was refused: the container behind it is not the one that granted it. The fastest of the loss
      // signals (see connect), since it rides the user's own next action.
      if (out.error === STALE_LEASE && LEASED.has(name) && open.get(args[0] as string) === args[1]) markLost();
      throw new Error(out.error ?? 'Demo host error');
    }
    return decode(out.result) as T;
  }

  const stateListeners = new Set<(state: State) => void>();
  const diskListeners = new Set<(id: string, change: DiskChange) => void>();
  const open = new Map<string, string>(); // id → lease of every started, not yet stopped, project
  let stream: EventSource | null = null; let connecting = false;
  let lost = false; let boot: string | null = null; let lastSeen = 0;
  let watchdog: ReturnType<typeof setInterval> | null = null;

  /** Every lease the editor holds is gone (see the header): report each once per loss; desktopDriver reopens. */
  function markLost(): void {
    if (lost) return; lost = true;
    for (const [id, lease] of open) for (const cb of stateListeners) cb({ id, lease, phase: 'error', error: 'Connection to the demo was lost' });
  }

  // Three ways to learn the container is gone, because the first one alone is not enough:
  //  - the stream errors (the browser then reconnects by itself);
  //  - the stream stays open but goes silent: the Worker and proxies can hold it after the container died, so web-host's
  //    `ping` stops arriving and the watchdog drops and reopens it;
  //  - a reconnect lands on a fresh container: its `hello` carries a different boot id.
  function connect(): void {
    if (stream || connecting || !Source) return;
    connecting = true;
    void handshake().then(() => {
      const s = new Source(`${base}/events`, { withCredentials: true });
      stream = s; lastSeen = Date.now();
      s.onmessage = (e: MessageEvent<string>) => {
        if (stream !== s) return;
        lastSeen = Date.now();
        const { channel, args } = decode(JSON.parse(e.data)) as { channel: string; args: unknown[] };
        if (channel === 'hello') {
          const id = args[0] as string;
          if (boot !== null && id !== boot) markLost();
          boot = id; lost = false; // a live stream again: the next loss reports
        } else if (channel === 'state') for (const cb of stateListeners) cb(args[0] as State);
        else if (channel === 'disk-changed') for (const cb of diskListeners) cb(args[0] as string, args[1] as DiskChange);
      };
      s.onerror = () => { if (stream === s) markLost(); };
      watchdog ??= setInterval(() => {
        // Armed only once the host said `hello`: a web-host without pings (an older image) must not look dead.
        // Quiet while the session gate is up: without a session the stream is refused anyway.
        if (!stream || boot === null || gating || Date.now() - lastSeen <= STALE_MS) return;
        stream.close(); stream = null; markLost(); connect();
      }, STALE_MS / 4);
    }, error => console.error('[web demo] event stream', error)).finally(() => { connecting = false; });
  }
  function restartStream(): void {
    if (stream) { stream.close(); stream = null; }
    if (stateListeners.size || diskListeners.size) connect();
  }
  // Owner liveness (see TOUCH_MS): touch the open leases while there are any, and give them back when the page goes.
  let toucher: ReturnType<typeof setInterval> | null = null;
  function keepAlive(): void {
    // A touch after the session's cap gets 401, which brings up the "session ended" gate: that is how a tab left open
    // learns it. While the gate is up, no touches pile up behind it.
    toucher ??= setInterval(() => { if (open.size && !gating) void call('touch', [...open]).catch(() => {}); }, TOUCH_MS);
  }
  const page = deps.page ?? (typeof window !== 'undefined' ? window : undefined);
  const beacon = deps.sendBeacon ?? (typeof navigator !== 'undefined' && navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : undefined);
  page?.addEventListener('pagehide', () => {
    if (!open.size || !beacon) return;
    // text/plain: a beacon must use a CORS-safelisted type; web-host parses the body whatever its type.
    beacon(`${base}/call`, new Blob([JSON.stringify({ name: 'release', args: [[...open]] })], { type: 'text/plain' }));
  });

  function listen<T>(set: Set<T>, cb: T): () => void { set.add(cb); connect(); return () => { set.delete(cb); }; }

  return {
    exists: id => call('exists', id),
    async start(id, lease, seed) {
      open.set(id, lease); keepAlive();
      try { return await call('start', id, lease, seed); }
      catch (error) { if (open.get(id) === lease) open.delete(id); throw error; }
    },
    async stop(id, lease) { if (open.get(id) === lease) open.delete(id); await call('stop', id, lease); },
    snapshot: (id, lease) => call('snapshot', id, lease),
    status: (id, lease) => call('status', id, lease),
    async fetch(id, lease, requestId, kind, route, init) {
      const r = await call<{ status: number; statusText: string; headers: [string, string][]; body: Uint8Array }>(
        'fetch', id, lease, requestId, kind, route, init);
      const body = r.body ?? new Uint8Array(0);
      return { ...r, body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer };
    },
    abort: (id, lease, requestId) => call('abort', id, lease, requestId),
    onState: cb => listen(stateListeners, cb),
    onDiskChanged: cb => listen(diskListeners, cb),
    git: () => Promise.reject(new WebDemoUnavailableError('Versions and GitHub')),
    terminal: {
      attach: () => Promise.reject(new WebDemoUnavailableError('The terminal')),
      input: () => Promise.reject(new WebDemoUnavailableError('The terminal')),
      resize: () => Promise.reject(new WebDemoUnavailableError('The terminal')),
      onOutput: () => () => {},
    },
  };
}

/** The editor is the web demo build (VITE_SQ_WEB=1): desktop-only surfaces (Versions, Publish, Terminal, MCP) hide. */
export const isWebDemo = (): boolean => import.meta.env.VITE_SQ_WEB === '1';
