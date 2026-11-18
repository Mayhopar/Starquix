/**
 * capturePreviewBaseline — one capped read of what the instance serves for the
 * frame's URL (the class-write certifier uses it). The post-Push verified
 * reload these tests used to cover is retired: the seamless canvas refreshes
 * in place after every write (plan docs/plans/2026-10-04-seamless-canvas-plan.md 2.6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  capturePreviewBaseline,
  setPreviewUrlProvider,
  PREVIEW_RELOAD_EVENT,
  PREVIEW_BASELINE_TIMEOUT_MS,
} from '../reloadPreview';

const URL_ = 'http://localhost:5199/about';
const BEFORE = '<html><body><h1 class="text-xl">a</h1></body></html>';
const AFTER = '<html><body><h1 class="text-2xl">a</h1></body></html>';

let reloads = 0;
const countReload = (): void => { reloads += 1; };

/** A fetch whose body is whatever `body.value` currently holds. */
function bodyFetch(body: { value: string; ok?: boolean }) {
  return vi.fn(async () => ({
    ok: body.ok ?? true,
    text: async () => body.value,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  reloads = 0;
  window.addEventListener(PREVIEW_RELOAD_EVENT, countReload);
  setPreviewUrlProvider(() => URL_);
});

afterEach(() => {
  window.removeEventListener(PREVIEW_RELOAD_EVENT, countReload);
  setPreviewUrlProvider(null);
  vi.unstubAllGlobals();
});

describe('capturePreviewBaseline', () => {
  it('reads the page the frame is showing, with the cache bypassed', async () => {
    const fetchMock = bodyFetch({ value: BEFORE });
    vi.stubGlobal('fetch', fetchMock);

    expect(await capturePreviewBaseline()).toBe(BEFORE);
    // Cache-busting the URL is NOT an option — the iframe src is governed by
    // previewSrc.ts and a second scheme would fork it. `no-store` on OUR probe
    // is enough: it guarantees the bytes we compare came from the server.
    expect(fetchMock).toHaveBeenCalledWith(URL_, expect.objectContaining({ cache: 'no-store' }));
  });

  it('is null when there is no frame to read (about:blank, no provider)', async () => {
    vi.stubGlobal('fetch', bodyFetch({ value: BEFORE }));
    setPreviewUrlProvider(() => 'about:blank');
    expect(await capturePreviewBaseline()).toBeNull();
    setPreviewUrlProvider(null);
    expect(await capturePreviewBaseline()).toBeNull();
  });

  it('is null when the instance answers non-ok or refuses the connection', async () => {
    vi.stubGlobal('fetch', bodyFetch({ value: BEFORE, ok: false }));
    expect(await capturePreviewBaseline()).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await capturePreviewBaseline()).toBeNull();
  });
});

describe('capturePreviewBaseline — the read is capped', () => {
  /** A fetch that honours `signal`, like the real one. */
  function slowFetch(delayMs: number, body: string) {
    return vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true, text: async () => body }), delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      })) as unknown as typeof fetch;
  }

  // A slow instance must never stall the caller: the read is a snapshot, not a wait.
  it('a read that never answers is capped at PREVIEW_BASELINE_TIMEOUT_MS', async () => {
    // A baseline that never answers must not delay the push by the verify cap.
    vi.stubGlobal('fetch', slowFetch(5000, BEFORE));

    const startedAt = Date.now();
    const baseline = await capturePreviewBaseline();
    const wallClock = Date.now() - startedAt;

    // Missing it is free: a null baseline keeps every needle and the loop simply
    // waits for them — it never turns a correct verification into a wrong one.
    expect(baseline).toBeNull();
    expect(wallClock).toBeLessThan(PREVIEW_BASELINE_TIMEOUT_MS + 150);
  });

});

// The desktop app: the instance secret lives in Electron main, so the read
// rides desktopDriver.captureDocumentReader(url), never a native fetch.
describe('desktop preview reads ride the driver document reader', () => {
  const instance = 'http://127.0.0.1:4500';
  let reader: ReturnType<typeof vi.fn>;
  let capture: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden native read')));
    vi.stubGlobal('sqDesktop', {});
    const mod = await import('@/services/desktopDriver');
    reader = vi.fn(async () => new Response(AFTER));
    capture = vi.spyOn(mod.desktopDriver, 'captureDocumentReader').mockImplementation(() => reader as never);
    setPreviewUrlProvider(() => `${instance}/about?q=1#sq-ov=overlay`);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads through the driver with no-store/Accept, never a native parent request', async () => {
    await expect(capturePreviewBaseline()).resolves.toBe(AFTER);
    expect(capture).toHaveBeenCalledWith(`${instance}/about?q=1#sq-ov=overlay`);
    expect(reader).toHaveBeenCalledWith(expect.objectContaining({ cache: 'no-store', headers: { accept: 'text/html' } }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is null when the driver read rejects or answers non-ok', async () => {
    reader.mockImplementationOnce(async () => { throw new Error('lease gone'); });
    await expect(capturePreviewBaseline()).resolves.toBeNull();
    reader.mockImplementationOnce(async () => new Response('x', { status: 500 }));
    await expect(capturePreviewBaseline()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts a pending driver read at PREVIEW_BASELINE_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    try {
      reader.mockImplementation((init: RequestInit) => new Promise((_r, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const read = capturePreviewBaseline();
      await vi.advanceTimersByTimeAsync(PREVIEW_BASELINE_TIMEOUT_MS);
      await expect(read).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
