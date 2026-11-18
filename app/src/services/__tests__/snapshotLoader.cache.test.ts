import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalWarn = console.warn;
const SNAPSHOT_URL = '/astro-snapshot.json';

type SnapshotFixture = {
  version: string;
  files: Record<string, string>;
};

const fixture = (version = 'fixture-v1'): SnapshotFixture => ({
  version,
  files: {
    'src/message.txt': 'aGVsbG8=',
    'public/pixel.png': 'AP+A',
  },
});

function response(body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function installCache(initial?: Response) {
  let stored = initial;
  const cache = {
    match: vi.fn(async (key: RequestInfo | URL) => key === SNAPSHOT_URL && stored ? stored.clone() : undefined),
    put: vi.fn(async (key: RequestInfo | URL, value: Response) => {
      if (key === SNAPSHOT_URL) stored = value.clone();
    }),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return { cache, getStored: () => stored };
}

function installSharedCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const open = vi.fn(async (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    return {
      match: async (key: RequestInfo | URL) => store!.get(String(key))?.clone(),
      put: async (key: RequestInfo | URL, value: Response) => { store!.set(String(key), value.clone()); },
    };
  });
  vi.stubGlobal('caches', { open });
  return stores;
}

async function freshLoader() {
  vi.resetModules();
  return import('../snapshotLoader');
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('snapshot byte cache', () => {
  it('stores the complete validated network snapshot for offline reuse', async () => {
    const fetchMock = vi.fn(async () => response(fixture()));
    vi.stubGlobal('fetch', fetchMock);
    const { getStored } = installCache();
    const { loadSnapshot } = await freshLoader();

    await loadSnapshot();

    const cachedResponse = getStored();
    expect(cachedResponse).toBeDefined();
    expect(await cachedResponse!.clone().json()).toEqual(fixture());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['absent', 'open rejected', 'put rejected'])('keeps validated network bytes when cache is %s', async failure => {
    const fetchMock = vi.fn(async () => response(fixture()));
    vi.stubGlobal('fetch', fetchMock);
    const reason = new Error(`cache ${failure}`);
    vi.mocked(console.warn).mockImplementation((...args) => {
      if (args[1] !== reason) originalWarn(...args);
    });
    if (failure === 'absent') vi.stubGlobal('caches', undefined);
    else vi.stubGlobal('caches', { open: vi.fn(async () => {
      if (failure === 'open rejected') throw reason;
      return { put: vi.fn(async () => { throw reason; }) };
    }) });
    const { loadSnapshot, getLoadedSnapshotVersion } = await freshLoader();
    const files = await loadSnapshot();
    expect(files['src/message.txt']).toBe('hello');
    expect(files['public/pixel.png']).toEqual(new Uint8Array([0, 255, 128]));
    expect(getLoadedSnapshotVersion()).toBe('fixture-v1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (failure === 'absent') expect(console.warn).not.toHaveBeenCalled();
    else expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      failure === 'open rejected' ? '[Snapshot] Cache API unavailable:' : '[Snapshot] Could not store snapshot cache:', reason,
    );
  });

  it('uses a compatible offline response and decodes text and binary bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    installCache(response(fixture()));
    const { getLoadedSnapshotVersion, loadSnapshot } = await freshLoader();

    const files = await loadSnapshot();

    expect(files['src/message.txt']).toBe('hello');
    expect(files['public/pixel.png']).toEqual(new Uint8Array([0, 255, 128]));
    expect(getLoadedSnapshotVersion()).toBe('fixture-v1');
  });

  it.each([
    ['invalid JSON', 'not-json'],
    ['missing files map', { version: 'fixture-v1' }],
    ['non-string file bytes', { version: 'fixture-v1', files: { 'src/message.txt': 42 } }],
    ['invalid base64', { version: 'fixture-v1', files: { 'src/message.txt': '***' } }],
  ])('rejects %s without recording a loaded version', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(body)));
    const { cache } = installCache();
    const { getLoadedSnapshotVersion, loadSnapshot } = await freshLoader();

    await expect(loadSnapshot()).rejects.toThrow();

    expect(getLoadedSnapshotVersion()).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('coalesces concurrent requests into one network fetch', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    installCache();
    const { loadSnapshot } = await freshLoader();

    const loads = Promise.all([loadSnapshot(), loadSnapshot()]);
    pending.resolve(response(fixture()));
    const [first, second] = await loads;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('retries after a failed load', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(fixture()));
    vi.stubGlobal('fetch', fetchMock);
    installCache();
    const { loadSnapshot } = await freshLoader();

    await expect(loadSnapshot()).rejects.toThrow();
    await expect(loadSnapshot()).resolves.toMatchObject({ 'src/message.txt': 'hello' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a cleared in-flight generation replace a newer snapshot', async () => {
    const firstFetch = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockResolvedValueOnce(response(fixture('fixture-v2')));
    vi.stubGlobal('fetch', fetchMock);
    installCache();
    const { clearSnapshotCache, getLoadedSnapshotVersion, loadSnapshot } = await freshLoader();

    const staleLoad = loadSnapshot();
    clearSnapshotCache();
    const current = await loadSnapshot();
    firstFetch.resolve(response(fixture('fixture-v1')));
    await expect(staleLoad).rejects.toThrow(/cleared/i);

    expect(current['src/message.txt']).toBe('hello');
    expect(await loadSnapshot()).toBe(current);
    expect(getLoadedSnapshotVersion()).toBe('fixture-v2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale production cache instead of booting incompatible plugin code', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SNAPSHOT_VERSION', 'build-v2');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    installCache(response(fixture('build-v1')));
    const { getLoadedSnapshotVersion, loadSnapshot } = await freshLoader();

    await expect(loadSnapshot()).rejects.toThrow(/expected build-v2/i);

    expect(getLoadedSnapshotVersion()).toBeNull();
  });

  it('accepts the matching production cache for offline startup', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SNAPSHOT_VERSION', 'build-v2');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    installCache(response(fixture('build-v2')));
    const { getLoadedSnapshotVersion, loadSnapshot } = await freshLoader();

    await expect(loadSnapshot()).resolves.toMatchObject({ 'src/message.txt': 'hello' });
    expect(getLoadedSnapshotVersion()).toBe('build-v2');
  });

  it('retains a separate offline fallback for each production build', async () => {
    installSharedCacheStorage();

    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SNAPSHOT_VERSION', 'build-v1');
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture('build-v1'))));
    await (await freshLoader()).loadSnapshot();

    vi.stubEnv('VITE_SNAPSHOT_VERSION', 'build-v2');
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture('build-v2'))));
    await (await freshLoader()).loadSnapshot();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const secondBuild = await freshLoader();
    await expect(secondBuild.loadSnapshot()).resolves.toMatchObject({ 'src/message.txt': 'hello' });
    expect(secondBuild.getLoadedSnapshotVersion()).toBe('build-v2');

    vi.stubEnv('VITE_SNAPSHOT_VERSION', 'build-v1');
    const firstBuild = await freshLoader();

    await expect(firstBuild.loadSnapshot()).resolves.toMatchObject({ 'src/message.txt': 'hello' });
    expect(firstBuild.getLoadedSnapshotVersion()).toBe('build-v1');
  });
});
