import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  localUrl, localFetch, setLocalTransport, setWaitForLocalTransport,
  resetLocalTransportForTests, getLocalTransport,
} from '../sqLocalBase';

describe('localUrl (the /__sq/local guard)', () => {
  it('returns the path as-is — the proxy takes a path, never a full URL', () => {
    expect(localUrl('/__sq/local/pages?path=x')).toBe('/__sq/local/pages?path=x');
  });
  it('rejects non-/__sq/local paths (keeps the seam honest)', () => {
    expect(() => localUrl('/__sq/scan-components')).toThrow(/__sq\/local/);
  });
});

describe('localFetch transport seam (files-truth Phase 2)', () => {
  beforeEach(() => resetLocalTransportForTests());

  // The host transport (the app's own Vite server answering for a local_
  // folder) is gone: with no transport a call WAITS for the proxy — it never
  // hits the app host, there is nothing there to answer.
  it('no transport: waits for the proxy instead of fetching the app host', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(getLocalTransport()).toBeNull();
    let resolved = false;
    const p = localFetch('/__sq/local/pages?path=x', { method: 'GET' }).then(async (r) => { resolved = true; return r.text(); });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    setLocalTransport({ fetch: async () => new Response('late') });
    expect(await p).toBe('late');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('proxy mode: the installed transport answers; fetch is never called', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const calls: string[] = [];
    setLocalTransport({ fetch: async (p) => { calls.push(p); return new Response('proxied', { status: 201 }); } });
    const r = await localFetch('/__sq/local/content');
    expect(r.status).toBe(201);
    expect(await r.text()).toBe('proxied');
    expect(calls).toEqual(['/__sq/local/content']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('waits for a transport when told to (files-truth boot), releases on install', async () => {
    setWaitForLocalTransport(true);
    let resolved = false;
    const p = localFetch('/__sq/local/pages').then(async (r) => { resolved = true; return r.text(); });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    setLocalTransport({ fetch: async () => new Response('late') });
    expect(await p).toBe('late');
  });

  it('an unscoped transport serves a wc:// request; a scoped one only its own project', async () => {
    const calls: string[] = [];
    setLocalTransport({ fetch: async (p) => { calls.push(p); return new Response('any'); } });
    const body = JSON.stringify({ path: 'wc://browser_a' });
    expect(await (await localFetch('/__sq/local/write-file', { method: 'POST', body })).text()).toBe('any');
    setLocalTransport({ projectPath: 'wc://browser_b', fetch: async () => new Response('b-only') });
    let resolved = false;
    const p = localFetch('/__sq/local/write-file', { method: 'POST', body }).then(async (r) => { resolved = true; return r.text(); });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false); // waits for wc://browser_a's transport
    setLocalTransport({ projectPath: 'wc://browser_a', fetch: async () => new Response('a') });
    expect(await p).toBe('a');
  });

  it('still refuses non-/__sq/local paths', async () => {
    await expect(localFetch('/__sq/scan-components')).rejects.toThrow(/__sq\/local/);
  });
});
