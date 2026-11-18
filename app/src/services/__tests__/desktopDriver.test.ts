// The on-open Stack/Media upgrade reads through the transport in the background — covered in sqComponentUpgrade.test.
vi.mock('../sqComponentUpgrade', () => ({ upgradeSqComponentsOnOpen: vi.fn(async () => []) }));
import { afterEach, expect, it, vi } from 'vitest';
import { getLocalTransport, localFetch, resetLocalTransportForTests } from '@/utils/sqLocalBase';
const h = vi.hoisted(() => ({ read: vi.fn(async () => ({ 'src/pages/index.astro': '<h1>x</h1>' })),
  put: vi.fn(async () => {}), clear: vi.fn(async () => {}), sync: vi.fn(async () => {}),
  del: vi.fn(async () => {}), list: vi.fn(async () => [] as string[]),
  startSync: vi.fn(), stopSync: vi.fn(), active: vi.fn() }));
vi.mock('@/db', () => ({ db: { projectFiles: {}, transaction: async (_mode: string, _table: unknown, fn: () => Promise<void>) => fn() } }));
vi.mock('@/db/projectFiles', () => ({ readProjectFiles: h.read, putProjectFiles: h.put, deleteAllProjectFiles: h.clear, deleteProjectFile: h.del, listProjectFilePaths: h.list }));
vi.mock('../filesTruthSync', () => ({ syncChangedFiles: h.sync, startFilesTruthSync: h.startSync, stopFilesTruthSync: h.stopSync }));
vi.mock('../pendingProjectMutations', () => ({ setActiveProjectForSave: h.active }));
vi.mock('../durableEdits/acceptance', () => ({ awaitUserAccepted: vi.fn(async () => {}) }));
import { createDesktopDriver, type SqDesktop } from '../desktopDriver';
import { LocalMutationNoWriteError } from '../localTransport';
const drivers: ReturnType<typeof createDesktopDriver>[] = [];
function setup() {
  const pending = new Map<string, { resolve: (v: {url: string; generation: number}) => void; reject: (e: Error) => void }>();
  const api = {
    exists: vi.fn(async () => false),
    start: vi.fn((id: string) => new Promise<{url: string; generation: number}>((resolve, reject) => pending.set(id, { resolve, reject }))),
    stop: vi.fn(async (id: string) => { pending.get(id)?.reject(new Error('cancelled')); }),
    snapshot: vi.fn(async () => ({ 'public/a.bin': new Uint8Array([0, 255]) })),
    status: vi.fn(async () => ({ phase: 'running' })),
    fetch: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: [['content-type', 'application/json']] as [string,string][], body: new TextEncoder().encode('{"ok":true}').buffer })),
    abort: vi.fn(async () => {}), onState: vi.fn(() => () => {}),
    git: vi.fn(async () => ({ ok: true })),
    terminal: { attach: vi.fn(async () => 'replay'), input: vi.fn(async () => {}), resize: vi.fn(async () => {}), onOutput: vi.fn(() => () => {}) },
    onDiskChanged: vi.fn((_cb: (id: string, change: { files: Record<string, Uint8Array>; gone: string[] }) => void) => () => {}),
  } satisfies SqDesktop;
  const driver = createDesktopDriver(() => api); drivers.push(driver); return { api, driver, pending };
}
afterEach(async () => { await Promise.all(drivers.splice(0).map(d => d.close())); resetLocalTransportForTests(); vi.clearAllMocks(); });
it('joins StrictMode boot and mirrors disk before installing its transport', async () => {
  const { api, driver, pending } = setup();
  const a = driver.open('wc://p', 'p'); driver.stop('wc://p'); const b = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
  expect(api.start).toHaveBeenCalledWith('p', expect.any(String), { 'src/pages/index.astro': '<h1>x</h1>' });
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 });
  await Promise.all([a, b]); expect(api.stop).not.toHaveBeenCalled();
  expect(h.put).toHaveBeenCalledWith('p', [{ path: 'public/a.bin', content: new Uint8Array([0,255]) }]);
  expect(h.startSync).toHaveBeenCalledWith('p');
  await localFetch('/__sq/local/asset?path=wc%3A%2F%2Fp', { method: 'POST', body: new Uint8Array([0,255]) });
  expect(api.fetch).toHaveBeenLastCalledWith('p', expect.any(String), expect.any(String), 'local', '/__sq/local/asset?path=wc%3A%2F%2Fp', expect.objectContaining({ method: 'POST' }));
  expect(h.sync).toHaveBeenCalled();
});
it('keeps the transport write contract: a proven no-write throws typed, a refused write throws', async () => {
  const { api, driver, pending } = setup();
  const opening = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await opening;
  api.fetch.mockResolvedValueOnce({ status: 409, statusText: 'Conflict', headers: [['x-sq-mutation-outcome', 'no-write']], body: new ArrayBuffer(0) });
  await expect(localFetch('/__sq/local/asset?path=wc%3A%2F%2Fp', { method: 'POST', body: 'x' })).rejects.toBeInstanceOf(LocalMutationNoWriteError);
  api.fetch.mockResolvedValueOnce({ status: 500, statusText: 'Err', headers: [], body: new ArrayBuffer(0) });
  await expect(localFetch('/__sq/local/asset?path=wc%3A%2F%2Fp', { method: 'POST', body: 'x' })).rejects.toThrow('HTTP 500');
});
it('does not reseed a project that already exists on disk', async () => {
  const { api, driver, pending } = setup();
  api.exists.mockResolvedValueOnce(true);
  const opening = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledWith('p', expect.any(String), undefined));
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await opening;
  expect(h.read).not.toHaveBeenCalled();
});
it('cancels A while starting and never lets its result own B', async () => {
  const { api, driver, pending } = setup();
  const a = driver.open('wc://a', 'a'); const cancelled = expect(a).rejects.toThrow();
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
  const b = driver.open('wc://b', 'b');
  await vi.waitFor(() => expect(api.stop).toHaveBeenCalledWith('a', expect.any(String)));
  await cancelled;
  await vi.waitFor(() => expect(pending.has('b')).toBe(true));
  pending.get('b')?.resolve({ url: 'http://127.0.0.1:5002', generation: 1 }); await b;
  expect(getLocalTransport()?.projectPath).toBe('wc://b');
  driver.stop('wc://a'); expect(getLocalTransport()?.projectPath).toBe('wc://b');
});
it('stops a pending open when the editor disappears', async () => {
  const { api, driver } = setup();
  const opening = driver.open('wc://p', 'p'); const failed = expect(opening).rejects.toThrow();
  await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  driver.stop('wc://p'); await driver.close(); await failed;
  // test/setup.ts installs an unscoped default transport; no desktop one was installed.
  expect(getLocalTransport()?.projectPath).toBeUndefined();
  expect(api.stop).toHaveBeenCalledWith('p', expect.any(String));
});
it('routes preview discovery through IPC and forwards abort', async () => {
  const { api, driver, pending } = setup();
  const opening = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await opening;
  let finish!: (value: Awaited<ReturnType<SqDesktop['fetch']>>) => void;
  api.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const c = new AbortController();
  const read = driver.captureDocumentReader('http://127.0.0.1:5001/products/widget')({signal: c.signal});
  const rejected = expect(read).rejects.toThrow();
  await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledWith('p', expect.any(String), expect.any(String), 'document', '/products/widget', expect.anything()));
  c.abort();
  expect(api.abort).toHaveBeenCalledWith('p', expect.any(String), expect.any(String));
  finish({ status: 200, statusText: 'OK', headers: [], body: new ArrayBuffer(0) }); await rejected;
});
it('a recovering child reopens on a fresh lease', async () => {
  const { api, driver, pending } = setup();
  let emit!: (s: { id: string; lease: string; phase: string }) => void;
  api.onState.mockImplementation(cb => { emit = cb; return () => {}; });
  const lost = vi.fn(); window.addEventListener('sq:instance-lost', lost);
  const opening = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await opening;
  const lease = api.start.mock.calls[0][1] as string;
  emit({ id: 'p', lease: 'someone-else', phase: 'starting' }); expect(lost).not.toHaveBeenCalled();
  emit({ id: 'p', lease, phase: 'starting' }); expect(lost).toHaveBeenCalledTimes(1);
  driver.stop('wc://p'); const reopened = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
  expect(api.start.mock.calls[1][1]).not.toBe(lease);
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5003', generation: 1 }); await reopened;
  window.removeEventListener('sq:instance-lost', lost);
});

it('relays boot progress (installing packages) for its own boot only, before the instance runs', async () => {
  const { api, driver, pending } = setup();
  let emit!: (s: { id: string; lease: string; phase: string; detail?: string | null }) => void;
  api.onState.mockImplementation(cb => { emit = cb; return () => {}; });
  const seen: (string | null)[] = []; const onProgress = (e: Event) => seen.push((e as CustomEvent).detail);
  window.addEventListener('sq:preview-progress', onProgress);
  const opening = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  const lease = api.start.mock.calls[0][1] as string;
  emit({ id: 'p', lease: 'someone-else', phase: 'starting', detail: 'Installing x' });
  emit({ id: 'p', lease, phase: 'starting', detail: 'Installing astro-seo' });
  emit({ id: 'p', lease, phase: 'starting', detail: null });
  expect(seen).toEqual(['Installing astro-seo', null]);
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await opening;
  window.removeEventListener('sq:preview-progress', onProgress);
});
it('git ops ride the OWNER lease; remirror re-runs disk → Dexie; neither works for another project', async () => {
  const { api, driver, pending } = setup();
  const opening = driver.open('wc://p', 'p');
  await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await opening;
  const lease = (api.start.mock.calls[0] as unknown[])[1];
  expect(await driver.git('p', 'status')).toEqual({ ok: true });
  expect(api.git).toHaveBeenCalledWith('p', lease, 'status', undefined);
  h.put.mockClear();
  await driver.remirror('p');
  expect(api.snapshot).toHaveBeenCalledTimes(2);
  expect(h.put).toHaveBeenCalledTimes(1);
  await expect(driver.git('other', 'status')).rejects.toThrow();
  await expect(driver.remirror('other')).rejects.toThrow();
});
it('terminal calls ride the CURRENT owner\'s lease and refuse without one', async () => {
  const { api, driver, pending } = setup();
  await expect(driver.terminal.attach('p')).rejects.toThrow('Desktop owner changed');
  const open = driver.open('wc://p', 'p'); await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await open;
  const lease = (api.start.mock.calls[0] as unknown as [string, string])[1];
  await expect(driver.terminal.attach('p')).resolves.toBe('replay');
  await driver.terminal.input('p', 'ls\r'); await driver.terminal.resize('p', 100, 30);
  expect(api.terminal.attach).toHaveBeenCalledWith('p', lease);
  expect(api.terminal.input).toHaveBeenCalledWith('p', lease, 'ls\r');
  expect(api.terminal.resize).toHaveBeenCalledWith('p', lease, 100, 30);
  await expect(driver.terminal.attach('other')).rejects.toThrow();
});
it('an outside edit of the open project lands in Dexie: bytes put, gone paths deleted with everything under them', async () => {
  const { api, driver, pending } = setup();
  const open = driver.open('wc://p', 'p'); await vi.waitFor(() => expect(api.start).toHaveBeenCalled());
  pending.get('p')?.resolve({ url: 'http://127.0.0.1:5001', generation: 1 }); await open;
  h.put.mockClear(); h.list.mockResolvedValueOnce(['src/old/a.md', 'src/old/b/c.md', 'src/older.md', 'src/keep.md']);
  const push = api.onDiskChanged.mock.calls[0][0];
  push('other', { files: { 'x.md': new Uint8Array([9]) }, gone: [] }); // another project: ignored
  push('p', { files: { 'src/pages/t.md': new Uint8Array([1]) }, gone: ['src/old', 'src/older.md'] });
  await vi.waitFor(() => expect(h.put).toHaveBeenCalledWith('p', [{ path: 'src/pages/t.md', content: new Uint8Array([1]) }]));
  expect((h.del.mock.calls as unknown as [string, string][]).map(c => c[1]).sort()).toEqual(['src/old/a.md', 'src/old/b/c.md', 'src/older.md']);
  expect(h.put).toHaveBeenCalledTimes(1);
});
