import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startDaemon, pairUrlFor, type DaemonHandle } from './daemon';
import { DaemonClient } from './daemonClient';
import { loadIdentity, identityPath } from './identity';
import { decodePairingCode } from './protocol';

let handle: DaemonHandle; let client: DaemonClient;
beforeAll(async () => {
  process.env.STARQUIX_MCP_HOME = mkdtempSync(join(tmpdir(), 'sq-mcp-'));
  handle = await startDaemon({ onLog: () => {} });
  client = DaemonClient.fromDisk();
});
afterAll(async () => { client.stop(); await handle.close(); });

function pairTab(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise<WebSocket>((resolve, reject) => {
    ws.once('open', () => ws.send(JSON.stringify({ type: 'hello', v: 1, token, projectId: 'browser_p1', projectName: 'Site' })));
    ws.once('message', m => (JSON.parse(String(m)).type === 'hello-ok' ? resolve(ws) : reject(new Error('no hello-ok'))));
    ws.once('close', () => reject(new Error('closed')));
  });
}

describe('daemon + control API', () => {
  it('persists identity (token, ports, pid) so the connect code is stable', async () => {
    const id = loadIdentity();
    expect(id.controlPort).toBe(handle.controlPort);
    expect(id.wsPort).toBe(handle.wsPort);
    expect(id.pid).toBe(process.pid);
    const s = await client.status();
    expect(decodePairingCode(s.code)).toEqual({ port: handle.wsPort, token: id.token });
    expect(s.paired).toBe(false);
    expect(s.pairUrl).toBe(`http://localhost:3000/?mcp=${encodeURIComponent(s.code)}`);
  });

  it('rejects a bad bearer token', async () => {
    const bad = new DaemonClient({ token: 'b'.repeat(24), controlPort: handle.controlPort });
    await expect(bad.status()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('call before pairing → NOT_CONNECTED; after a tab pairs → forwarded, lastProject remembered, pairUrl targets it', async () => {
    await expect(client.callTool('add_page', {})).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    const id = loadIdentity();
    const tab = await pairTab(handle.wsPort, id.token);
    tab.on('message', m => {
      const req = JSON.parse(String(m));
      if (req.type === 'tools/list') tab.send(JSON.stringify({ id: req.id, tools: [{ name: 'add_page', description: 'd', inputSchema: { type: 'object' } }] }));
      if (req.type === 'tools/call') tab.send(JSON.stringify({ id: req.id, result: { success: true, got: req.args } }));
    });
    await new Promise(r => setTimeout(r, 50));
    const s = await client.status();
    expect(s.paired).toBe(true);
    expect(s.project).toEqual({ projectId: 'browser_p1', projectName: 'Site' });
    expect(s.pairUrl).toBe(`http://localhost:3000/editor/browser_p1?mcp=${encodeURIComponent(s.code)}`);
    expect(JSON.parse(readFileSync(identityPath(), 'utf8')).lastProject).toEqual({ projectId: 'browser_p1', projectName: 'Site' });
    expect((await client.listTools()).map(t => t.name)).toEqual(['add_page']);
    expect(await client.callTool('add_page', { name: 'A' })).toEqual({ success: true, got: { name: 'A' } });
    tab.close();
    await new Promise(r => setTimeout(r, 50));
    expect((await client.status()).paired).toBe(false);
    // unpaired again: the catalogue comes from the cache the pairing filled
    expect((await client.listTools()).map(t => t.name)).toEqual(['add_page']);
  });

  it('config --url changes where pair sends the browser', async () => {
    const s = await client.setEditorUrl('http://localhost:3021/');
    expect(s.pairUrl.startsWith('http://localhost:3021/editor/browser_p1?mcp=')).toBe(true);
    expect(pairUrlFor({ editorUrl: 'http://x', lastProject: undefined }, 'C')).toBe('http://x/?mcp=C');
  });

  it('config --browser is persisted and reported, empty clears it', async () => {
    const s = await client.configure({ browser: 'Google Chrome' });
    expect(s.browser).toBe('Google Chrome');
    expect(JSON.parse(readFileSync(identityPath(), 'utf8')).browser).toBe('Google Chrome');
    expect((await client.status()).browser).toBe('Google Chrome');
    const cleared = await client.configure({ browser: '' });
    expect(cleared.browser).toBeUndefined();
    expect(JSON.parse(readFileSync(identityPath(), 'utf8')).browser).toBeUndefined();
  });
});
