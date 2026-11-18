// Loopback WebSocket server the editor tab dials. Owns ONE paired tab: token
// check on hello, request/response by id, per-call timeout, DISCONNECTED for
// in-flight calls when the tab drops. Holds no editor logic.
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { CLOSE_REPLACED, PROTOCOL_VERSION, type McpErrorCode, type RelayRequest, type TabResponse, type ToolDescriptor } from './protocol.js';

export class BridgeError extends Error {
  constructor(public code: McpErrorCode, message: string) { super(message); this.name = 'BridgeError'; }
}

export const PAIR_INSTRUCTIONS = 'Open the Starquix app and a project in it — it pairs by itself (AI Settings → MCP shows the light). Not the desktop app? Open AI Settings → MCP and run the command it shows (`starquix-mcp pair --code …`).';

const notConnected = () => new BridgeError('NOT_CONNECTED', `No Starquix editor tab is paired. ${PAIR_INSTRUCTIONS}`);

/** Omit distributes over the RelayRequest union (a plain Omit collapses it to shared keys). */
type RelayRequestBody = RelayRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

type Pending = { resolve: (r: TabResponse) => void; reject: (e: BridgeError) => void; timer: NodeJS.Timeout };

export interface TabBridgeOptions {
  token: string;
  /** Loopback port; default 0 = ephemeral. Dev-only pin so a restart keeps the same connect code. */
  port?: number;
  /** Default per-call timeout (ms). callTool() may override per call. */
  callTimeoutMs?: number;
  onLog?: (line: string) => void;
}

export class TabBridge {
  private wss: WebSocketServer | null = null;
  private tab: WebSocket | null = null;
  private project: { projectId: string; projectName: string } | null = null;
  private pending = new Map<string, Pending>();
  private pairListeners: Array<(paired: boolean) => void> = [];

  constructor(private opts: TabBridgeOptions) {}

  /** Fires with `true` when a tab pairs and `false` when it drops. */
  onPairChange(cb: (paired: boolean) => void) { this.pairListeners.push(cb); }
  private emitPair(paired: boolean) { for (const cb of this.pairListeners) cb(paired); }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: this.opts.port ?? 0 });
      this.wss = wss;
      wss.once('error', reject);
      wss.once('listening', () => resolve(this.address().port));
      wss.on('connection', ws => this.onConnection(ws));
    });
  }

  address(): { address: string; port: number } {
    return this.wss!.address() as { address: string; port: number };
  }
  pairedProject() { return this.project; }
  isPaired() { return this.tab !== null; }

  private onConnection(ws: WebSocket) {
    const onHello = (raw: Buffer | string) => {
      let msg: { type?: string; token?: string; projectId?: unknown; projectName?: unknown };
      try { msg = JSON.parse(String(raw)); } catch { ws.close(); return; }
      if (msg?.type !== 'hello' || msg.token !== this.opts.token) { ws.close(); return; }
      // A second tab with the RIGHT token takes over (the user opened the
      // project again, or `pair` opened it with ?mcp=): the old tab is dropped
      // and its in-flight calls fail DISCONNECTED. A wrong token is still refused.
      if (this.tab) { this.opts.onLog?.('tab replaced by a new pairing'); const old = this.tab; this.onTabClosed(old); old.close(CLOSE_REPLACED, 'replaced by another tab'); }
      ws.off('message', onHello);
      this.tab = ws;
      this.project = { projectId: String(msg.projectId ?? ''), projectName: String(msg.projectName ?? '') };
      this.opts.onLog?.(`paired: ${this.project.projectName} (${this.project.projectId})`);
      ws.send(JSON.stringify({ type: 'hello-ok', v: PROTOCOL_VERSION }));
      ws.on('message', m => this.onResponse(m as Buffer | string));
      ws.once('close', () => this.onTabClosed(ws));
      this.emitPair(true);
    };
    ws.on('message', onHello);
    ws.once('close', () => { ws.off('message', onHello); });
  }

  private onResponse(raw: Buffer | string) {
    let msg: TabResponse;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const p = this.pending.get(msg.id);
    if (!p) return; // late reply after timeout: discard
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
  }

  private onTabClosed(ws: WebSocket) {
    if (this.tab !== ws) return;
    this.tab = null;
    this.project = null;
    this.opts.onLog?.('tab disconnected');
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new BridgeError('DISCONNECTED', 'The editor tab disconnected mid-call. Reconnect and retry.'));
    }
    this.emitPair(false);
  }

  private send(req: RelayRequestBody, timeoutMs: number): Promise<TabResponse> {
    if (!this.tab) return Promise.reject(notConnected());
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('TIMEOUT', `The editor tab did not answer within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.tab!.send(JSON.stringify({ id, ...req }));
    });
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const r = await this.send({ type: 'tools/list' }, this.opts.callTimeoutMs ?? 10_000);
    if ('error' in r) throw new BridgeError(r.error.code, r.error.message);
    if (!('tools' in r)) throw new BridgeError('TOOL_FAILED', 'Malformed tools/list reply');
    return r.tools;
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = this.opts.callTimeoutMs ?? 60_000): Promise<unknown> {
    this.opts.onLog?.(`call ${name} ${JSON.stringify(args)}`);
    const r = await this.send({ type: 'tools/call', name, args }, timeoutMs);
    if ('error' in r) throw new BridgeError(r.error.code, r.error.message);
    if (!('result' in r)) throw new BridgeError('TOOL_FAILED', 'Malformed tools/call reply');
    return r.result;
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      for (const c of this.wss?.clients ?? []) c.terminate();
      if (this.wss) this.wss.close(() => resolve()); else resolve();
    });
  }
}
