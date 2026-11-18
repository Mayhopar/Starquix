import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { TabBridge } from './tabBridge';

const bridges: TabBridge[] = [];
afterEach(async () => { for (const b of bridges.splice(0)) await b.close(); });

async function start(opts: Partial<ConstructorParameters<typeof TabBridge>[0]> = {}) {
  const bridge = new TabBridge({ token: 'a'.repeat(24), callTimeoutMs: 200, ...opts });
  bridges.push(bridge);
  const port = await bridge.listen();
  return { bridge, port };
}

function connectTab(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise<WebSocket>((resolve, reject) => {
    ws.once('open', () => { ws.send(JSON.stringify({ type: 'hello', v: 1, token, projectId: 'p1', projectName: 'P' })); });
    ws.once('message', m => { const msg = JSON.parse(String(m)); msg.type === 'hello-ok' ? resolve(ws) : reject(new Error('no hello-ok')); });
    ws.once('close', () => reject(new Error('closed')));
  });
}

describe('TabBridge', () => {
  it('listens on loopback only and reports NOT_CONNECTED before a tab pairs', async () => {
    const { bridge, port } = await start();
    expect(port).toBeGreaterThan(0);
    expect(bridge.address().address).toBe('127.0.0.1');
    await expect(bridge.listTools()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('listens on a pinned port when one is given', async () => {
    const probe = new TabBridge({ token: 'a'.repeat(24) }); bridges.push(probe);
    const free = await probe.listen(); await probe.close(); bridges.pop();
    const { bridge, port } = await start({ port: free });
    expect(port).toBe(free);
    expect(bridge.address().port).toBe(free);
  });

  it('rejects a wrong token by closing the socket without hello-ok', async () => {
    const { port } = await start();
    await expect(connectTab(port, 'b'.repeat(24))).rejects.toThrow();
  });

  it('forwards tools/list and tools/call and resolves by id', async () => {
    const { bridge, port } = await start();
    const tab = await connectTab(port, 'a'.repeat(24));
    tab.on('message', m => {
      const req = JSON.parse(String(m));
      if (req.type === 'tools/list') tab.send(JSON.stringify({ id: req.id, tools: [{ name: 'add_page', description: 'd', inputSchema: { type: 'object' } }] }));
      if (req.type === 'tools/call') tab.send(JSON.stringify({ id: req.id, result: { success: true, echoed: req.args } }));
    });
    expect(await bridge.listTools()).toEqual([{ name: 'add_page', description: 'd', inputSchema: { type: 'object' } }]);
    expect(await bridge.callTool('add_page', { name: 'About' })).toEqual({ success: true, echoed: { name: 'About' } });
    expect(bridge.pairedProject()).toEqual({ projectId: 'p1', projectName: 'P' });
  });

  it('surfaces a tab-side error reply as a BridgeError with its code', async () => {
    const { bridge, port } = await start();
    const tab = await connectTab(port, 'a'.repeat(24));
    tab.on('message', m => {
      const req = JSON.parse(String(m));
      tab.send(JSON.stringify({ id: req.id, error: { code: 'NEEDS_CONFIRMATION', message: 'confirm it' } }));
    });
    await expect(bridge.callTool('remove_page', {})).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', message: 'confirm it' });
  });

  it('times out a call the tab never answers', async () => {
    const { bridge, port } = await start({ callTimeoutMs: 50 });
    await connectTab(port, 'a'.repeat(24));
    await expect(bridge.callTool('x', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fails in-flight calls with DISCONNECTED when the tab drops', async () => {
    const { bridge, port } = await start({ callTimeoutMs: 5000 });
    const tab = await connectTab(port, 'a'.repeat(24));
    const pending = bridge.callTool('x', {});
    tab.close();
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    await expect(bridge.listTools()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('a second tab with the right token takes over; the first one is dropped', async () => {
    const { bridge, port } = await start({ callTimeoutMs: 5000 });
    const first = await connectTab(port, 'a'.repeat(24));
    const pending = expect(bridge.callTool('x', {})).rejects.toMatchObject({ code: 'DISCONNECTED' });
    const closed = new Promise<number>(r => first.once('close', code => r(code)));
    const second = await connectTab(port, 'a'.repeat(24));
    expect(await closed).toBe(4001); // CLOSE_REPLACED: the loser must not redial
    await pending;
    second.on('message', m => { const req = JSON.parse(String(m)); second.send(JSON.stringify({ id: req.id, result: 'from-second' })); });
    expect(await bridge.callTool('x', {})).toBe('from-second');
    expect(bridge.isPaired()).toBe(true);
  });

  it('accepts a new tab after the first one disconnects', async () => {
    const { bridge, port } = await start();
    const first = await connectTab(port, 'a'.repeat(24));
    first.close();
    await new Promise(r => setTimeout(r, 20));
    await connectTab(port, 'a'.repeat(24));
    expect(bridge.isPaired()).toBe(true);
  });
});
