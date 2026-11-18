import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localFetch, resetLocalTransportForTests, setLocalTransport, setWaitForLocalTransport } from '../sqLocalBase';

const pathA = 'wc://browser_a';
const pathB = 'wc://browser_b';
const scanA = '/__sq/local/scan-components?path=wc%3A%2F%2Fbrowser_a';
const scanB = '/__sq/local/scan-components?path=wc%3A%2F%2Fbrowser_b';
const turn = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { resetLocalTransportForTests(); vi.useFakeTimers(); });
afterEach(() => { resetLocalTransportForTests(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('WC request readiness and ownership', () => {
  it('holds an explicit WC scan before the driver effect arms waiting instead of parsing host HTML', async () => {
    const host = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } }));
    const read = localFetch(scanA); void read.catch(() => {});
    await turn();
    expect(host).not.toHaveBeenCalled();
    setWaitForLocalTransport(true, pathA);
    setLocalTransport({ projectPath: pathA, fetch: async () => Response.json([{ name: 'Own' }]) });
    expect(await (await read).json()).toEqual([{ name: 'Own' }]);
  });
  it('recognizes the JSON body project path without dispatching a mutation to the host', async () => {
    const host = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ wrong: true }));
    const writes: string[] = [];
    const init = { method: 'POST', body: JSON.stringify({ path: pathA, file: 'x', content: 'new' }) };
    const write = localFetch('/__sq/local/write-file', init); void write.catch(() => {});
    await turn();
    expect(host).not.toHaveBeenCalled();
    setLocalTransport({ projectPath: pathA, fetch: async (_url, request) => { writes.push(String(request?.body)); return Response.json({ ok: true }); } });
    expect(await (await write).json()).toEqual({ ok: true });
    expect(writes).toEqual([init.body]);
  });
  it('aborts a pre-transport request promptly and never sends it after readiness', async () => {
    setWaitForLocalTransport(true, pathA);
    const controller = new AbortController();
    const read = localFetch(scanA, { signal: controller.signal });
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    const sent: string[] = [];
    setLocalTransport({ projectPath: pathA, fetch: async url => { sent.push(url); return Response.json([]); } });
    await rejected;
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not dispatch an already-aborted request even with a ready transport', async () => {
    const sent: string[] = [];
    setLocalTransport({ projectPath: pathA, fetch: async url => { sent.push(url); return Response.json([]); } });
    const controller = new AbortController(); controller.abort();
    await expect(localFetch(scanA, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toEqual([]);
  });
  it('waits for B while the retained A transport drains, without sending the scan to A', async () => {
    const sent: string[] = [];
    setWaitForLocalTransport(true, pathA);
    setLocalTransport({ projectPath: pathA, fetch: async url => { sent.push('A:' + url); return Response.json(['A']); } });
    const read = localFetch(scanB); void read.catch(() => {});
    setWaitForLocalTransport(true, pathB);
    await turn();
    expect(sent).toEqual([]);
    setLocalTransport({ projectPath: pathA, fetch: async () => Response.json(['wrong']) });
    setLocalTransport(null);
    setLocalTransport({ projectPath: pathB, fetch: async url => { sent.push('B:' + url); return Response.json(['B']); } });
    expect(await (await read).json()).toEqual(['B']);
    expect(sent).toEqual(['B:' + scanB]);
  });
  it('retires an undispatched old-owner write when a different project opens', async () => {
    setWaitForLocalTransport(true, pathA);
    const write = localFetch('/__sq/local/write-file', { method: 'POST', body: JSON.stringify({ path: pathA, file: 'x', content: 'old' }) });
    const rejected = expect(write).rejects.toMatchObject({ name: 'AbortError' });
    setWaitForLocalTransport(true, pathB);
    const sent: string[] = [];
    setLocalTransport({ projectPath: pathB, fetch: async url => { sent.push(url); return Response.json({ ok: true }); } });
    await rejected;
    expect(sent).toEqual([]);
  });
  it('stop retires pending requests but keeps the retained transport usable by final saves', async () => {
    setWaitForLocalTransport(true, pathA);
    const read = localFetch(scanA);
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    setWaitForLocalTransport(false);
    setLocalTransport({ projectPath: pathA, fetch: async () => Response.json({ saved: true }) });
    await rejected;
    expect(await (await localFetch('/__sq/local/changes?since=0')).json()).toEqual({ saved: true });
  });
  it('does not dispatch after a resolved transport was replaced before its continuation', async () => {
    const host = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(['host']));
    const read = localFetch(scanA); void read.catch(() => {});
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    const sent: string[] = [];
    setLocalTransport({ projectPath: pathA, fetch: async url => { sent.push(url); return Response.json([]); } });
    setLocalTransport(null);
    setLocalTransport({ projectPath: pathB, fetch: async url => { sent.push(url); return Response.json([]); } });
    await rejected;
    expect(sent).toEqual([]);
    expect(host).not.toHaveBeenCalled();
  });
  it('times out a missing WC proxy without falling back to the editor host', async () => {
    const host = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!DOCTYPE html>'));
    const read = localFetch(scanA);
    const rejected = expect(read).rejects.toThrow('files-truth instance did not come up');
    await vi.advanceTimersByTimeAsync(90_000);
    await rejected;
    expect(host).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
