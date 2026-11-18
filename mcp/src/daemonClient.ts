// Talks to a running daemon over its loopback control API. Implements the
// BridgeLike surface so the stdio MCP server can forward to the SAME pairing
// the CLI uses. onPairChange is a 2 s status poll (the daemon has no push).
import type { DaemonStatus } from './daemon.js';
import { BridgeError } from './tabBridge.js';
import type { ToolDescriptor, McpErrorCode } from './protocol.js';
import { loadIdentity, type DaemonIdentity } from './identity.js';

export class DaemonClient {
  private lastPaired: boolean | null = null;
  private listeners: Array<(paired: boolean) => void> = [];
  private poll: ReturnType<typeof setInterval> | null = null;
  private snapshot: DaemonStatus | null = null;

  constructor(private id: Pick<DaemonIdentity, 'token' | 'controlPort'>) {}

  static fromDisk(): DaemonClient { return new DaemonClient(loadIdentity()); }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.id.controlPort}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${this.id.token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const body = (await res.json()) as T & { error?: { code: McpErrorCode; message: string } };
    if (body.error) throw new BridgeError(body.error.code, body.error.message);
    return body;
  }

  /** Resolves false when no daemon answers on the recorded port. */
  async alive(): Promise<boolean> {
    try { this.snapshot = await this.request<DaemonStatus>('/status'); return true; } catch { return false; }
  }
  async status(): Promise<DaemonStatus> { this.snapshot = await this.request<DaemonStatus>('/status'); return this.snapshot; }
  /** `browser: ''` clears the configured browser. */
  async configure(patch: { editorUrl?: string; browser?: string }): Promise<DaemonStatus> { return this.request<DaemonStatus>('/config', { method: 'POST', body: patch }); }
  async setEditorUrl(editorUrl: string): Promise<DaemonStatus> { return this.configure({ editorUrl }); }
  async shutdown(): Promise<void> { await this.request('/shutdown', { method: 'POST', body: {} }).catch(() => {}); }

  // BridgeLike — the stdio MCP server reads these.
  isPaired(): boolean { return this.snapshot?.paired ?? false; }
  pairedProject() { return this.snapshot?.project ?? null; }
  async listTools(): Promise<ToolDescriptor[]> { return (await this.request<{ tools: ToolDescriptor[] }>('/tools')).tools; }
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> { return (await this.request<{ result: unknown }>('/call', { method: 'POST', body: { name, args } })).result; }
  onPairChange(cb: (paired: boolean) => void): void {
    this.listeners.push(cb);
    if (this.poll) return;
    this.poll = setInterval(() => {
      void this.status().then(s => {
        if (this.lastPaired !== null && s.paired !== this.lastPaired) for (const l of this.listeners) l(s.paired);
        this.lastPaired = s.paired;
      }).catch(() => {});
    }, 2000);
    this.poll.unref?.();
  }
  stop(): void { if (this.poll) clearInterval(this.poll); this.poll = null; }
}
