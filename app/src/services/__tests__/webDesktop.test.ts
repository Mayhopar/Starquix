import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebDesktop, decode, encode, STALE_MS, TOUCH_MS, WebDemoUnavailableError } from '../webDesktop';

type Call = { name: string; args: unknown[] };
/** GET /api/session of a visitor whose session is running (and of web-host under dev-local.sh). */
const SESSION = { active: true, endsAt: null, minutes: 20, turnstileSiteKey: 'site-key' };
function host(handle: (call: Call) => unknown = () => null) {
  const calls: Call[] = []; const order: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    order.push(url);
    if (url.endsWith('/session')) return Response.json(SESSION);
    const call = decode(JSON.parse(String(init?.body))) as Call; calls.push(call);
    try { return Response.json({ ok: true, result: encode(await handle(call)) }); }
    catch (error) { return Response.json({ ok: false, error: (error as Error).message }); }
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, order };
}
class FakeSource {
  static last: FakeSource | null = null;
  onerror: (() => void) | null = null; onmessage: ((e: MessageEvent<string>) => void) | null = null; closed = false;
  constructor(public url: string) { FakeSource.last = this; }
  close() { this.closed = true; }
  push(channel: string, ...args: unknown[]) { this.onmessage?.({ data: JSON.stringify(encode({ channel, args })) } as MessageEvent<string>); }
}

describe('encode / decode', () => {
  it('round-trips bytes nested anywhere, as $b64', () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    const wire = encode({ seed: { 'a.png': bytes, 'b.txt': 'hi' }, list: [bytes.buffer] });
    expect(wire).toEqual({ seed: { 'a.png': { $b64: 'AAH+/w==' }, 'b.txt': 'hi' }, list: [{ $b64: 'AAH+/w==' }] });
    expect(decode(JSON.parse(JSON.stringify(wire)))).toEqual({ seed: { 'a.png': bytes, 'b.txt': 'hi' }, list: [bytes] });
  });
  it('encodes a view at its own offset, not its whole buffer', () => {
    expect(encode(new Uint8Array([9, 1, 2, 9]).subarray(1, 3))).toEqual({ $b64: 'AQI=' });
  });
  it('encodes bodies larger than one String.fromCharCode chunk', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(decode(encode(big))).toEqual(big);
  });
});

describe('createWebDesktop', () => {
  beforeEach(() => { FakeSource.last = null; });
  it('sends the cookie handshake alone, before any parallel call', async () => {
    const h = host(({ name }) => name === 'exists' ? false : { url: 'https://4321-x.preview.test', generation: 1 });
    const api = createWebDesktop('/api', { fetch: h.fetch, EventSource: FakeSource as unknown as typeof EventSource });
    await Promise.all([api.exists('p'), api.exists('q'), api.start('p', 'L1', { 'a.txt': 'x' })]);
    expect(h.order[0]).toBe('/api/session');
    expect(h.order.filter(u => u.endsWith('/session'))).toHaveLength(1);
    expect(h.calls.find(c => c.name === 'start')?.args).toEqual(['p', 'L1', { 'a.txt': 'x' }]);
  });

  it('retries the handshake after a failed one', async () => {
    let first = true;
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/session')) { if (first) { first = false; return new Response('full', { status: 503 }); } return Response.json(SESSION); }
      return Response.json({ ok: true, result: true });
    }) as unknown as typeof globalThis.fetch;
    const api = createWebDesktop('/api', { fetch });
    await expect(api.exists('p')).rejects.toThrow('full'); // the server's own message
    await expect(api.exists('p')).resolves.toBe(true);
  });

  it('rejects with the host error, and with the Worker body on a non-200', async () => {
    const api = createWebDesktop('/api', { fetch: host(() => { throw new Error('Stale instance lease'); }).fetch });
    await expect(api.status('p', 'L')).rejects.toThrow('Stale instance lease');
    const full = vi.fn(async (url: string) => url.endsWith('/session') ? Response.json(SESSION)
      : new Response('Demo is full, try again in a minute.', { status: 503 })) as unknown as typeof globalThis.fetch;
    await expect(createWebDesktop('/api', { fetch: full }).exists('p')).rejects.toThrow('Demo is full');
  });

  it('returns fetch bodies as an ArrayBuffer holding exactly the response bytes', async () => {
    const api = createWebDesktop('/api', { fetch: host(() => ({ status: 200, statusText: 'OK', headers: [['content-type', 'text/html']],
      body: new Uint8Array([60, 104, 49, 62]) })).fetch });
    const r = await api.fetch('p', 'L', 'r1', 'document', '/', { method: 'GET', headers: [] });
    expect(r.body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(r.body)).toBe('<h1>');
  });

  it('pushes state and disk changes from the event stream', async () => {
    const api = createWebDesktop('/api', { fetch: host().fetch, EventSource: FakeSource as unknown as typeof EventSource });
    const states = vi.fn(); const disks = vi.fn();
    api.onState(states); api.onDiskChanged(disks);
    await vi.waitFor(() => expect(FakeSource.last?.url).toBe('/api/events'));
    const source = FakeSource.last!;
    source.push('state', { id: 'p', lease: 'L', phase: 'running' });
    source.push('disk-changed', 'p', { files: { 'a.bin': new Uint8Array([7]) }, gone: [] });
    expect(states).toHaveBeenCalledWith({ id: 'p', lease: 'L', phase: 'running' });
    expect(disks).toHaveBeenCalledWith('p', { files: { 'a.bin': new Uint8Array([7]) }, gone: [] });
  });

  it('reports every open lease lost once per stream drop, and not stopped ones', async () => {
    const api = createWebDesktop('/api', { fetch: host(() => ({ url: 'u', generation: 1 })).fetch,
      EventSource: FakeSource as unknown as typeof EventSource });
    const states = vi.fn(); api.onState(states);
    await vi.waitFor(() => expect(FakeSource.last).not.toBeNull());
    await api.start('p', 'L1'); await api.start('q', 'L2'); await api.stop('q', 'L2');
    const source = FakeSource.last!;
    source.onerror?.(); source.onerror?.(); // the browser retries: one report per drop
    expect(states).toHaveBeenCalledTimes(1);
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', lease: 'L1', phase: 'error' }));
    source.push('hello', 'B1'); source.onerror?.(); // live again (same container), then the next drop reports
    expect(states).toHaveBeenCalledTimes(2);
  });

  it('reports the leases lost when a reconnect lands on a fresh container (a new boot id)', async () => {
    const api = createWebDesktop('/api', { fetch: host(() => ({ url: 'u', generation: 1 })).fetch,
      EventSource: FakeSource as unknown as typeof EventSource });
    const states = vi.fn(); api.onState(states);
    await vi.waitFor(() => expect(FakeSource.last).not.toBeNull());
    const source = FakeSource.last!; source.push('hello', 'B1');
    await api.start('p', 'L1');
    source.push('hello', 'B1'); // the same container: nothing lost
    expect(states).not.toHaveBeenCalled();
    source.push('hello', 'B2'); // slept, time cap or OOM: a new container without the lease
    expect(states).toHaveBeenCalledTimes(1);
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', lease: 'L1', phase: 'error' }));
  });

  it('drops a stream that goes silent (held open with no container behind it) and opens a new one', async () => {
    vi.useFakeTimers();
    try {
      const api = createWebDesktop('/api', { fetch: host(() => ({ url: 'u', generation: 1 })).fetch,
        EventSource: FakeSource as unknown as typeof EventSource });
      const states = vi.fn(); api.onState(states);
      await vi.advanceTimersByTimeAsync(0);
      const first = FakeSource.last!; first.push('hello', 'B1');
      await api.start('p', 'L1');
      for (let i = 0; i < 8; i++) { await vi.advanceTimersByTimeAsync(5_000); first.push('ping'); } // pings keep it alive
      expect(states).not.toHaveBeenCalled(); expect(first.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(STALE_MS + 15_000); // the pings stop
      expect(first.closed).toBe(true);
      expect(states).toHaveBeenCalledTimes(1);
      expect(states).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', lease: 'L1', phase: 'error' }));
      expect(FakeSource.last).not.toBe(first);
      first.push('state', { id: 'p', lease: 'L1', phase: 'running' }); // a late message on the dropped stream is ignored
      expect(states).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('reports the lease lost at once when the host refuses it as stale, but not for a lease it no longer holds', async () => {
    let stale = false;
    const api = createWebDesktop('/api', { fetch: host(({ name }) => {
      if (name === 'start') return { url: 'u', generation: 1 };
      if (stale) throw new Error('Stale instance lease');
      return { phase: 'running' };
    }).fetch, EventSource: FakeSource as unknown as typeof EventSource });
    const states = vi.fn(); api.onState(states);
    await vi.waitFor(() => expect(FakeSource.last).not.toBeNull());
    FakeSource.last!.push('hello', 'B1');
    await api.start('p', 'OLD'); await api.stop('p', 'OLD'); await api.start('p', 'L1');
    stale = true;
    await expect(api.status('p', 'OLD')).rejects.toThrow('Stale instance lease'); // a lease the editor already left
    expect(states).not.toHaveBeenCalled();
    await expect(api.fetch('p', 'L1', 'r1', 'local', '/__sq/local/pages', { method: 'GET', headers: [] })).rejects.toThrow('Stale');
    expect(states).toHaveBeenCalledTimes(1);
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', lease: 'L1', phase: 'error' }));
  });

  it('never drops the stream of a host that does not ping (no hello: an older web-host image)', async () => {
    vi.useFakeTimers();
    try {
      const api = createWebDesktop('/api', { fetch: host(() => ({ url: 'u', generation: 1 })).fetch,
        EventSource: FakeSource as unknown as typeof EventSource });
      const states = vi.fn(); api.onState(states);
      await vi.advanceTimersByTimeAsync(0);
      const first = FakeSource.last!; await api.start('p', 'L1');
      await vi.advanceTimersByTimeAsync(STALE_MS * 4);
      expect(first.closed).toBe(false); expect(states).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('touches the open leases every TOUCH_MS, and stops once none are open', async () => {
    vi.useFakeTimers();
    try {
      const h = host(({ name }) => name === 'start' ? { url: 'u', generation: 1 } : null);
      const api = createWebDesktop('/api', { fetch: h.fetch, page: new EventTarget() });
      await api.start('p', 'L1');
      await vi.advanceTimersByTimeAsync(TOUCH_MS * 2);
      expect(h.calls.filter(c => c.name === 'touch').map(c => c.args)).toEqual([[[['p', 'L1']]], [[['p', 'L1']]]]);
      await api.stop('p', 'L1');
      await vi.advanceTimersByTimeAsync(TOUCH_MS * 2);
      expect(h.calls.filter(c => c.name === 'touch')).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('gives the open leases back on pagehide, by beacon', async () => {
    const page = new EventTarget(); const sendBeacon = vi.fn((_url: string, _data: Blob) => true);
    const api = createWebDesktop('/api', { fetch: host(() => ({ url: 'u', generation: 1 })).fetch, page, sendBeacon });
    page.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).not.toHaveBeenCalled(); // nothing open, nothing to say
    await api.start('p', 'L1');
    page.dispatchEvent(new Event('pagehide'));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe('/api/call');
    const text = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob); });
    expect(blob.type).toBe('text/plain');
    expect(JSON.parse(text)).toEqual({ name: 'release', args: [[['p', 'L1']]] });
  });

  it('forgets a lease whose start failed', async () => {
    const api = createWebDesktop('/api', { fetch: host(({ name }) => { if (name === 'start') throw new Error('Project still owned'); }).fetch,
      EventSource: FakeSource as unknown as typeof EventSource });
    const states = vi.fn(); api.onState(states);
    await vi.waitFor(() => expect(FakeSource.last).not.toBeNull());
    await expect(api.start('p', 'L1')).rejects.toThrow('Project still owned');
    FakeSource.last!.onerror?.();
    expect(states).not.toHaveBeenCalled();
  });

  it('refuses git and the terminal without calling the host', async () => {
    const h = host(); const api = createWebDesktop('/api', { fetch: h.fetch });
    await expect(api.git('p', 'L', 'status')).rejects.toBeInstanceOf(WebDemoUnavailableError);
    await expect(api.terminal.attach('p', 'L')).rejects.toBeInstanceOf(WebDemoUnavailableError);
    expect(h.calls).toHaveLength(0);
  });
});

/** The demo Worker with sessions (web-demo/src/worker.ts): /session answers itself; /call needs a live session. */
function worker(opts: { refuse?: { status: number; error: string; message: string }[] } = {}) {
  const state = { active: false, ended: false, begins: [] as unknown[] };
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/session') && init?.method === 'POST') {
      state.begins.push(JSON.parse(String(init.body)));
      const refusal = opts.refuse?.shift();
      if (refusal) return Response.json({ error: refusal.error, message: refusal.message }, { status: refusal.status });
      state.active = true; state.ended = false; return Response.json({ active: true, endsAt: 1 });
    }
    if (url.endsWith('/session')) return Response.json({ ...SESSION, active: state.active });
    if (!state.active) return Response.json({ error: state.ended ? 'session-ended' : 'session-required', message: 'no session' }, { status: 401 });
    const call = decode(JSON.parse(String(init?.body))) as Call; calls.push(call);
    return Response.json({ ok: true, result: call.name === 'start' ? { url: 'u', generation: 1 } : true });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, state, calls,
    endSession() { state.active = false; state.ended = true; } };
}
function fakeGate() {
  const prompts: { reason: string; message?: string; minutes: number; siteKey: string }[] = [];
  let n = 0;
  return { prompts, closed: 0,
    gate: { prompt: vi.fn(async (p: { reason: string; message?: string; minutes: number; siteKey: string }) => { prompts.push(p); return `token-${++n}`; }),
      close: vi.fn() } };
}

describe('sessions (DESIGN.md security #9)', () => {
  beforeEach(() => { FakeSource.last = null; });

  it('asks once for a session before the first call, begins it with the Turnstile token, then goes on', async () => {
    const w = worker(); const g = fakeGate();
    const api = createWebDesktop('/api', { fetch: w.fetch, gate: g.gate, page: new EventTarget() });
    await expect(Promise.all([api.exists('p'), api.exists('q')])).resolves.toEqual([true, true]);
    expect(g.prompts).toEqual([{ reason: 'required', minutes: 20, siteKey: 'site-key', message: undefined }]);
    expect(w.state.begins).toEqual([{ token: 'token-1' }]);
    expect(g.gate.close).toHaveBeenCalledTimes(1);
    expect(w.calls.map(c => c.name)).toEqual(['exists', 'exists']);
  });

  it('never asks when the visitor already has a session (a reload inside one)', async () => {
    const w = worker(); w.state.active = true; const g = fakeGate();
    const api = createWebDesktop('/api', { fetch: w.fetch, gate: g.gate, page: new EventTarget() });
    await api.exists('p');
    expect(g.gate.prompt).not.toHaveBeenCalled();
  });

  it('shows why a session could not begin (full, budget, ...) and lets the visitor try again', async () => {
    const w = worker({ refuse: [{ status: 503, error: 'full', message: 'The demo is full. Try again in a minute.' }] }); const g = fakeGate();
    const api = createWebDesktop('/api', { fetch: w.fetch, gate: g.gate, page: new EventTarget() });
    await api.exists('p');
    expect(g.prompts.map(p => p.message)).toEqual([undefined, 'The demo is full. Try again in a minute.']);
    expect(w.state.begins).toHaveLength(2);
  });

  it('at the time cap: asks for a new session, reports the open leases lost (the container went too), and retries the call', async () => {
    const w = worker(); w.state.active = true; const g = fakeGate();
    const api = createWebDesktop('/api', { fetch: w.fetch, gate: g.gate, EventSource: FakeSource as unknown as typeof EventSource, page: new EventTarget() });
    const states = vi.fn(); api.onState(states);
    await vi.waitFor(() => expect(FakeSource.last).not.toBeNull());
    const first = FakeSource.last!; first.push('hello', 'B1');
    await api.start('p', 'L1');
    w.endSession();
    await expect(api.status('p', 'L1')).resolves.toBe(true); // retried once the new session began
    expect(g.prompts.map(p => p.reason)).toEqual(['ended']);
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', lease: 'L1', phase: 'error' }));
    expect(first.closed).toBe(true); // the stream refused without a session is replaced
    await vi.waitFor(() => expect(FakeSource.last).not.toBe(first));
  });

  it('surfaces the Worker\'s message when a call is refused outside the session flow (max_instances: full)', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/session') ? Response.json(SESSION)
      : Response.json({ error: 'full', message: 'The demo is full. Try again in a minute.' }, { status: 503 })) as unknown as typeof globalThis.fetch;
    await expect(createWebDesktop('/api', { fetch, page: new EventTarget() }).exists('p')).rejects.toThrow('The demo is full. Try again in a minute.');
  });
});
