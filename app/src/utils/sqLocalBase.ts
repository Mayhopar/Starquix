/**
 * THE seam for every /__sq/local/* call (files-truth unification, Phase 1+2).
 *
 * The instance lives in the desktop app's main process; calls ride the
 * transport the desktop driver installs (services/desktopDriver.ts, scoped
 * preload IPC) and come back as a real `Response`, so every call site keeps
 * `resp.ok / json() / text() / blob()`.
 *
 * `localUrl` is the "is this a local path" guard. No endpoint string is
 * spelled outside its call site.
 */
import { pm, probeStack } from '@/utils/probeMark';

export interface LocalTransport {
  /** Exact synthetic project path served by this transport; absent for unscoped callers. */
  projectPath?: string;
  fetch(pathAndQuery: string, init?: RequestInit): Promise<Response>;
}

let transport: LocalTransport | null = null;
interface TransportWaiter {
  projectPath: string | null;
  ready: (transport: LocalTransport) => void;
  cancel: () => void;
}
const transportWaiters = new Set<TransportWaiter>();

export function localUrl(pathAndQuery: string): string {
  if (!pathAndQuery.startsWith('/__sq/local/')) throw new Error(`localUrl: not a /__sq/local path: ${pathAndQuery}`);
  return pathAndQuery;
}

/** Install (or clear) the transport. Waiters blocked in localFetch resume. */
export function setLocalTransport(t: LocalTransport | null): void {
  transport = t;
  if (t) for (const waiter of [...transportWaiters]) {
    if (waiter.projectPath === null || waiter.projectPath === t.projectPath) waiter.ready(t);
  }
}
export function getLocalTransport(): LocalTransport | null { return transport; }

/** Callers may fire before the instance/transport is up — hold them
 *  (bounded) instead of failing the first render's fetches. Off by default. */
let waitForTransport = false;
let waitingProjectPath: string | null = null;
export function setWaitForLocalTransport(on: boolean, projectPath: string | null = null): void {
  waitForTransport = on;
  waitingProjectPath = on ? projectPath : null;
  // Retire only undispatched work. The installed old transport must remain
  // usable while the driver's save barrier drains that project's final writes.
  for (const waiter of [...transportWaiters]) {
    if (!on || projectPath !== null && waiter.projectPath !== null && waiter.projectPath !== projectPath) waiter.cancel();
  }
}

const TRANSPORT_WAIT_MS = 90_000;

/** The request already names its project. Its scope cannot depend on whether
 * the later driver effect has run: the library effect runs before it. */
function requestProjectPath(pathAndQuery: string, init?: RequestInit): string | null {
  let path: unknown = new URL(pathAndQuery, 'http://local.invalid').searchParams.get('path');
  if (typeof init?.body === 'string') {
    try {
      const body = JSON.parse(init.body) as { path?: unknown } | null;
      if (typeof body?.path === 'string') path = body.path;
    } catch { /* Non-JSON bodies carry their project path in the query. */ }
  }
  return typeof path === 'string' && path.startsWith('wc://') ? path : null;
}
const requestAborted = (): DOMException => new DOMException('Local request owner changed or request cancelled', 'AbortError');

export async function localFetch(pathAndQuery: string, init?: RequestInit): Promise<Response> {
  localUrl(pathAndQuery); // guard
  pm('lf', () => ({ r: pathAndQuery.replace('/__sq/local/', '').replace(/[?&]path=[^&]*/, '').slice(0, 120), m: init?.method ?? 'GET', st: probeStack() }));
  const signal = init?.signal;
  const projectPath = requestProjectPath(pathAndQuery, init);
  // An unscoped transport (no projectPath — a test double, or a transport
  // attached without a project) serves every request; a scoped one only its own project.
  const usable = () => transport && (projectPath === null || transport.projectPath === undefined || transport.projectPath === projectPath) ? transport : null;
  if (signal?.aborted) throw requestAborted();
  const t = usable() ?? await awaitTransport(projectPath, signal);
  return t.fetch(pathAndQuery, init);
}

/** No usable transport: wait for one (bounded). There is no host server
 *  to fall back to — the host-folder disk was removed 2026-09-10. */
async function awaitTransport(projectPath: string | null, signal: AbortSignal | null | undefined): Promise<LocalTransport> {
  let t: LocalTransport;
  try { t = await waitOnce(projectPath, signal); }
  catch (error) {
    // A stop→open pair in one tick (recovery, StrictMode) cancels waiters, then
    // re-arms the wait for the SAME project: register again, once.
    const rearmedForSameProject = !signal?.aborted && waitForTransport && (projectPath === null || waitingProjectPath === null || waitingProjectPath === projectPath);
    if (!rearmedForSameProject) throw error;
    t = await waitOnce(projectPath, signal);
  }
  // A new attach or cleanup can run between resolving the waiter and this
  // continuation. Never dispatch an old request into the replacement transport.
  if (signal?.aborted || transport !== t) throw requestAborted();
  return t;
}

function waitOnce(projectPath: string | null, signal: AbortSignal | null | undefined): Promise<LocalTransport> {
  return new Promise<LocalTransport>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transportWaiters.delete(waiter);
      signal?.removeEventListener('abort', waiter.cancel);
    };
    const waiter: TransportWaiter = {
      projectPath: projectPath ?? waitingProjectPath,
      ready: (readyTransport) => { cleanup(); resolve(readyTransport); },
      cancel: () => { cleanup(); reject(requestAborted()); },
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('files-truth instance did not come up'));
    }, TRANSPORT_WAIT_MS);
    transportWaiters.add(waiter);
    signal?.addEventListener('abort', waiter.cancel, { once: true });
  });
}

/** Test/reset hook. */
export function resetLocalTransportForTests(): void {
  for (const waiter of [...transportWaiters]) waiter.cancel();
  transport = null; waitForTransport = false; waitingProjectPath = null;
}
