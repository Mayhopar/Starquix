// Shared fake for the session's SocketLike — ONE socket contract for every
// MCP test (session.test, useMcpSession.test). Opens on the next tick.
import type { SocketLike } from '../session';

export class FakeWS implements SocketLike {
  static instances: FakeWS[] = [];
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  /** true = nothing listens on the port: the socket closes without ever opening. */
  static refuse = false;
  readyState = 0;
  constructor(public url: string) {
    FakeWS.instances.push(this);
    if (FakeWS.refuse) { setTimeout(() => { this.readyState = 3; this.onclose?.(undefined); }, 0); return; }
    setTimeout(() => { this.readyState = 1; this.onopen?.(undefined); }, 0);
  }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code?: number) { this.readyState = 3; this.onclose?.(code === undefined ? undefined : { code }); }
  receive(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
