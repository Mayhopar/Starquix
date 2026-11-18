// The long-lived relay: ONE TabBridge (the editor tab dials it) + a loopback
// HTTP control API for the CLI (`starquix-mcp status|tools|call`) and for the
// stdio MCP server (DaemonClient). Everything the tab can do is reachable
// from a shell, so a skill can drive Starquix without any MCP host config.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { TabBridge, BridgeError } from './tabBridge.js';
import { encodePairingCode } from './protocol.js';
import { fileCatalogueCache, type CatalogueCache } from './catalogueCache.js';
import { callTimeoutFor } from './server.js';
import { loadIdentity, updateIdentity, type DaemonIdentity } from './identity.js';

export interface DaemonStatus {
  paired: boolean;
  project: { projectId: string; projectName: string } | null;
  code: string;
  wsPort: number;
  controlPort: number;
  editorUrl: string;
  /** App name `pair` opens with; unset = system default browser. */
  browser?: string;
  /** Where `pair` sends the browser: the last project, or the projects page. */
  pairUrl: string;
  lastProject?: { projectId: string; projectName: string };
  pid: number;
}

export function pairUrlFor(id: Pick<DaemonIdentity, 'editorUrl' | 'lastProject'>, code: string): string {
  const base = id.editorUrl.replace(/\/$/, '');
  const path = id.lastProject ? `/editor/${encodeURIComponent(id.lastProject.projectId)}` : '/';
  return `${base}${path}?mcp=${encodeURIComponent(code)}`;
}

async function listenBridge(id: DaemonIdentity, log: (l: string) => void): Promise<{ bridge: TabBridge; wsPort: number }> {
  const pinned = new TabBridge({ token: id.token, port: id.wsPort, onLog: log });
  try { return { bridge: pinned, wsPort: await pinned.listen() }; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    log(`ws port ${id.wsPort} busy — taking a new one (the tab's stored code will change)`);
    const fresh = new TabBridge({ token: id.token, port: 0, onLog: log });
    return { bridge: fresh, wsPort: await fresh.listen() };
  }
}

export interface DaemonHandle { status(): DaemonStatus; close(): Promise<void>; controlPort: number; wsPort: number }

export async function startDaemon(opts: { identity?: DaemonIdentity; cache?: CatalogueCache; onLog?: (l: string) => void; persist?: boolean } = {}): Promise<DaemonHandle> {
  const log = opts.onLog ?? (() => {});
  const persist = opts.persist ?? true;
  let id = opts.identity ?? loadIdentity();
  const cache = opts.cache ?? fileCatalogueCache();

  // Keep the recorded port when free (stable connect code); fall back to an
  // ephemeral one when something else holds it.
  const { bridge, wsPort } = await listenBridge(id, log);
  bridge.onPairChange(paired => {
    if (paired) {
      const project = bridge.pairedProject();
      if (project && persist) id = updateIdentity({ lastProject: project });
      void bridge.listTools().then(t => cache.save(t)).catch(() => {});
    }
  });

  const code = () => encodePairingCode(wsPort, id.token);
  const status = (): DaemonStatus => ({
    paired: bridge.isPaired(), project: bridge.pairedProject(), code: code(), wsPort, controlPort,
    editorUrl: id.editorUrl, browser: id.browser, pairUrl: pairUrlFor(id, code()), lastProject: id.lastProject, pid: process.pid,
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 5_000_000) req.destroy(); }); req.on('end', () => resolve(s)); req.on('error', reject);
  });

  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${id.token}`) return json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'bad token' } });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, status());
      if (req.method === 'GET' && url.pathname === '/tools') {
        if (!bridge.isPaired()) return json(res, 200, { tools: cache.load(), fromCache: true });
        const tools = await bridge.listTools(); cache.save(tools);
        return json(res, 200, { tools, fromCache: false });
      }
      if (req.method === 'POST' && url.pathname === '/call') {
        const { name, args } = JSON.parse((await readBody(req)) || '{}') as { name?: string; args?: Record<string, unknown> };
        if (!name) return json(res, 400, { error: { code: 'INVALID_ARGS', message: 'name required' } });
        log(`call ${name} ${JSON.stringify(args ?? {})}`);
        const result = await bridge.callTool(name, args ?? {}, callTimeoutFor(name));
        return json(res, 200, { result });
      }
      if (req.method === 'POST' && url.pathname === '/config') {
        const patch = JSON.parse((await readBody(req)) || '{}') as { editorUrl?: string; browser?: string };
        const next: Partial<DaemonIdentity> = {};
        if (typeof patch.editorUrl === 'string' && /^https?:\/\//.test(patch.editorUrl)) next.editorUrl = patch.editorUrl;
        if (typeof patch.browser === 'string') next.browser = patch.browser.trim() || undefined; // '' clears
        if (Object.keys(next).length) { id = { ...id, ...next }; if (persist) updateIdentity(next); }
        return json(res, 200, status());
      }
      if (req.method === 'POST' && url.pathname === '/shutdown') { json(res, 200, { ok: true }); setTimeout(() => void handle.close().then(() => process.exit(0)), 50); return; }
      return json(res, 404, { error: { code: 'TOOL_FAILED', message: 'no such route' } });
    } catch (e) {
      const code = e instanceof BridgeError ? e.code : 'TOOL_FAILED';
      return json(res, 200, { error: { code, message: e instanceof Error ? e.message : String(e) } });
    }
  });
  const controlPort = await new Promise<number>((resolve, reject) => {
    http.once('error', reject);
    http.listen(id.controlPort, '127.0.0.1', () => resolve((http.address() as { port: number }).port));
  }).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    return new Promise<number>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', () => resolve((http.address() as { port: number }).port)); });
  });

  if (persist) id = updateIdentity({ wsPort, controlPort, pid: process.pid });
  log(`daemon up — ws 127.0.0.1:${wsPort}, control 127.0.0.1:${controlPort}, code ${code()}`);

  const handle: DaemonHandle = {
    status, controlPort, wsPort,
    close: () => new Promise(resolve => { http.close(() => { void bridge.close().then(() => { if (persist) updateIdentity({ pid: undefined }); resolve(); }); }); }),
  };
  return handle;
}
