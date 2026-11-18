import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './server';
import { BridgeError } from './tabBridge';

type Fake = { paired: boolean; tools: unknown[]; call: (n: string, a: unknown, t?: number) => Promise<unknown> };

function fakeBridge(over: Partial<Fake> = {}) {
  const paired = over.paired ?? true;
  return {
    onPairChange: (_cb: (paired: boolean) => void) => {},
    isPaired: () => paired,
    pairedProject: () => (paired ? { projectId: 'browser_p1', projectName: 'Site' } : null),
    listTools: async () => { if (!paired) throw new BridgeError('NOT_CONNECTED', 'no tab'); return over.tools ?? []; },
    callTool: async (n: string, a: unknown, t?: number) => { if (!paired) throw new BridgeError('NOT_CONNECTED', 'no tab'); return (over.call ?? (async () => ({ ok: true })))(n, a, t); },
  } as never;
}

async function connect(bridge: never, cache?: { load: () => never; save: (t: unknown[]) => void }) {
  const server = createMcpServer(bridge, cache as never);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(c);
  return client;
}

describe('createMcpServer', () => {
  it('notifies tools/list_changed when the tab pairs or unpairs (the client listed before the tab connected)', async () => {
    // Regression 2026-09-20: Claude Code lists tools at startup, BEFORE the tab
    // re-pairs; without this notification the catalogue stays at starquix_status only.
    let fire: ((paired: boolean) => void) | null = null;
    const bridge = fakeBridge();
    (bridge as { onPairChange: (cb: (p: boolean) => void) => void }).onPairChange = cb => { fire = cb; };
    const server = createMcpServer(bridge);
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: 't', version: '0' }, { capabilities: {} });
    const seen: string[] = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { seen.push('changed'); });
    await client.connect(c);
    expect(server.getCapabilities()?.tools?.listChanged).toBe(true);
    expect(fire).not.toBeNull();
    fire!(true);
    fire!(false);
    await new Promise(r => setTimeout(r, 20));
    expect(seen).toEqual(['changed', 'changed']);
  });
  it('lists the tab catalogue plus the always-present starquix_status tool', async () => {
    const client = await connect(fakeBridge({ tools: [{ name: 'add_page', description: 'd', inputSchema: { type: 'object', properties: {} } }] }));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['starquix_status', 'add_page']);
  });
  it('lists only starquix_status when no tab is paired, and status explains it', async () => {
    const client = await connect(fakeBridge({ paired: false }));
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(['starquix_status']);
    const r = await client.callTool({ name: 'starquix_status', arguments: {} });
    expect(JSON.stringify(r.content)).toContain('NOT_CONNECTED');
  });
  it('unpaired: lists the cached catalogue so a one-shot client still sees every tool; paired: refreshes the cache', async () => {
    const live = [{ name: 'add_page', description: 'd', inputSchema: { type: 'object', properties: {} } }];
    let stored: unknown[] = [{ name: 'stale_tool', description: 'd', inputSchema: { type: 'object', properties: {} } }];
    const cache = { load: () => stored as never, save: (t: unknown[]) => { stored = t; } };
    const unpaired = await connect(fakeBridge({ paired: false }), cache);
    expect((await unpaired.listTools()).tools.map(t => t.name)).toEqual(['starquix_status', 'stale_tool']);
    const r = await unpaired.callTool({ name: 'stale_tool', arguments: {} });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('NOT_CONNECTED');
    const paired = await connect(fakeBridge({ tools: live }), cache);
    expect((await paired.listTools()).tools.map(t => t.name)).toEqual(['starquix_status', 'add_page']);
    expect(stored).toEqual(live);
  });
  it('status reports the paired project', async () => {
    const client = await connect(fakeBridge());
    const r = await client.callTool({ name: 'starquix_status', arguments: {} });
    expect(JSON.stringify(r.content)).toContain('browser_p1');
  });
  it('forwards a call and returns the JSON result as text', async () => {
    const client = await connect(fakeBridge({ call: async (n, a) => ({ success: true, n, a }) }));
    const r = await client.callTool({ name: 'add_page', arguments: { name: 'About' } });
    expect((r.content as { text: string }[])[0].text).toContain('"n":"add_page"');
    expect(r.isError).toBeFalsy();
  });
  it('uses the long timeout for generate_image only', async () => {
    const seen: Array<number | undefined> = [];
    const client = await connect(fakeBridge({ call: async (_n, _a, t) => { seen.push(t); return {}; } }));
    await client.callTool({ name: 'generate_image', arguments: {} });
    await client.callTool({ name: 'add_page', arguments: {} });
    expect(seen).toEqual([180_000, 60_000]);
  });
  it('marks success:false results as isError', async () => {
    const client = await connect(fakeBridge({ call: async () => ({ success: false, message: 'nope' }) }));
    const r = await client.callTool({ name: 'add_page', arguments: {} });
    expect(r.isError).toBe(true);
  });
  it('maps bridge errors to isError results with the code', async () => {
    const client = await connect(fakeBridge({ call: async () => { throw new BridgeError('TIMEOUT', 'slow'); } }));
    const r = await client.callTool({ name: 'x', arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toContain('TIMEOUT');
  });
});
