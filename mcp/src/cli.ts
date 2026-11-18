#!/usr/bin/env node
// starquix-mcp — one binary, two faces over ONE pairing:
//   starquix-mcp                 stdio MCP server for agent hosts (Claude Code .mcp.json)
//   starquix-mcp up|down|status  the relay daemon (auto-started by every command)
//   starquix-mcp pair            open the editor with the connect code in the URL
//   starquix-mcp pair --code X   adopt the code the editor tab shows (AI Settings → MCP) and wait for it
//   starquix-mcp tools|call      drive the paired tab from any shell (skills)
//   starquix-mcp config --url    where the Starquix app runs (default http://localhost:3000)
//   starquix-mcp config --browser  which browser `pair` opens (the one holding the project); "" = system default
// stdout is the MCP channel in stdio mode; every human line goes to stderr there.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { startDaemon } from './daemon.js';
import { DaemonClient } from './daemonClient.js';
import { fileCatalogueCache } from './catalogueCache.js';
import { loadIdentity, updateIdentity } from './identity.js';
import { decodePairingCode, encodePairingCode } from './protocol.js';
import { openCommand } from './openBrowser.js';
import { PAIR_INSTRUCTIONS } from './tabBridge.js';

const argv = process.argv.slice(2);
// `starquix-mcp --code X` (an MCP host config) is the stdio server with a code.
const [cmd = 'stdio', ...rest] = argv[0]?.startsWith('--') ? ['stdio', ...argv] : argv;
const log = (line: string) => console.error(`[starquix-mcp] ${line}`);
const out = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

async function ensureDaemon(): Promise<DaemonClient> {
  const client = DaemonClient.fromDisk();
  if (await client.alive()) return client;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'daemon'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    const c = DaemonClient.fromDisk(); // the daemon rewrites daemon.json with its ports
    if (await c.alive()) return c;
  }
  throw new Error('daemon did not start (see ~/.starquix-mcp)');
}

/** Tab-issued code (`--code`): the editor minted it and is already dialing its
 *  port, so the relay takes the code's token + port as its identity. A daemon
 *  holding another identity is stopped first; a busy port is an error, never a
 *  silent fallback (the tab only ever dials the port in its code). */
async function adoptCode(code: string): Promise<void> {
  const target = decodePairingCode(code);
  if (!target) { log(`invalid connect code "${code}" — copy it again from AI Settings → MCP`); process.exit(2); }
  const id = loadIdentity();
  if (id.token === target.token && id.wsPort === target.port) return;
  const running = DaemonClient.fromDisk();
  if (await running.alive()) {
    await running.shutdown();
    for (let i = 0; i < 30 && (await running.alive()); i++) await new Promise(r => setTimeout(r, 100));
  }
  updateIdentity({ token: target.token, wsPort: target.port });
}

async function ensureDaemonFor(code: string | undefined): Promise<DaemonClient> {
  if (!code) return ensureDaemon();
  await adoptCode(code);
  const c = await ensureDaemon();
  const want = decodePairingCode(code)!;
  if ((await c.status()).code !== encodePairingCode(want.port, want.token)) {
    log(`port ${want.port} is busy (another process holds it) — free it and retry`);
    process.exit(1);
  }
  return c;
}

function openBrowser(url: string, browser: string | undefined) {
  const [bin, args] = openCommand(url, browser);
  spawn(bin, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); // Windows: no cmd window flash
}

switch (cmd) {
  case 'daemon': {
    const cache = fileCatalogueCache();
    const handle = await startDaemon({ cache, onLog: log });
    const stop = () => void handle.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    break;
  }
  case 'up': {
    const c = await ensureDaemonFor(flag('--code'));
    const s = await c.status();
    out({ daemon: 'running', paired: s.paired, project: s.project, code: s.code, pairUrl: s.pairUrl });
    break;
  }
  case 'down': {
    const c = DaemonClient.fromDisk();
    if (await c.alive()) { await c.shutdown(); out('daemon stopped'); } else out('daemon not running');
    break;
  }
  case 'status': {
    const c = DaemonClient.fromDisk();
    if (!(await c.alive())) { out({ daemon: 'stopped', paired: false, code: null }); break; }
    out(await c.status());
    break;
  }
  case 'code': { const c = await ensureDaemon(); out((await c.status()).code); break; }
  case 'pair': {
    const tabCode = flag('--code');
    const c = await ensureDaemonFor(tabCode);
    const s = await c.status();
    if (s.paired && !rest.includes('--force')) { out({ paired: true, project: s.project }); break; }
    // A tab-issued code means the tab is already open and dialing: nothing to open.
    if (!tabCode) openBrowser(s.pairUrl, s.browser);
    const waitMs = Number(flag('--wait') ?? 60) * 1000;
    const until = Date.now() + waitMs;
    let last = s;
    while (Date.now() < until && !last.paired) { await new Promise(r => setTimeout(r, 1000)); last = await c.status(); }
    if (!last.paired && tabCode) { out({ paired: false, code: s.code, hint: 'The relay is up with your code but no tab dialed in. Keep the project open in Starquix with AI Settings → MCP showing this code, then run pair again.' }); break; }
    out(last.paired ? { paired: true, project: last.project } : { paired: false, opened: s.pairUrl, browser: s.browser ?? 'system default', code: s.code, hint: 'Open a project in the tab that just opened; it pairs by itself. If it opened in the wrong browser (the project lives in another one): `starquix-mcp config --browser "Google Chrome"`, then pair again. Or open AI Settings → MCP in the project and run the command it shows.' });
    break;
  }
  case 'config': {
    const c = await ensureDaemon();
    const patch: { editorUrl?: string; browser?: string } = {};
    const url = flag('--url'); if (url) patch.editorUrl = url;
    if (rest.includes('--browser')) patch.browser = flag('--browser') ?? '';
    out(Object.keys(patch).length ? await c.configure(patch) : await c.status());
    break;
  }
  case 'tools': { const c = await ensureDaemon(); out((await c.listTools()).map(t => t.name)); break; }
  case 'call': {
    const [name, json] = rest;
    if (!name) { log('usage: starquix-mcp call <tool> [json-args]'); process.exit(2); }
    const c = await ensureDaemon();
    await c.status();
    try { out(await c.callTool(name, json ? JSON.parse(json) : {})); }
    catch (e) { out({ error: (e as { code?: string }).code ?? 'TOOL_FAILED', message: (e as Error).message }); process.exit(1); }
    break;
  }
  case 'stdio': {
    const c = await ensureDaemonFor(flag('--code'));
    const s = await c.status();
    log(`Connect code: ${s.code}`);
    log(s.paired ? `paired with ${s.project?.projectName}` : `not paired — ${PAIR_INSTRUCTIONS}`);
    const server = createMcpServer(c, fileCatalogueCache());
    const shutdown = () => { c.stop(); process.exit(0); };
    server.onclose = shutdown;
    process.stdin.once('end', shutdown);
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
    await server.connect(new StdioServerTransport());
    break;
  }
  default:
    log(`unknown command "${cmd}" — use: up | down | status | code | pair | config --url <url> --browser <app> | tools | call <tool> [json] | (none = stdio MCP server)`);
    process.exit(2);
}
