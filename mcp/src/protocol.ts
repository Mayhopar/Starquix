// Wire protocol between the starquix-mcp relay and the editor tab.
// MIRRORED at app/src/mcp/protocol.ts — keep byte-identical (parity test in
// app/src/mcp/__tests__/protocolParity.test.ts). No imports: this file runs
// in Node (relay) and in the browser (editor) unchanged.

export const PROTOCOL_VERSION = 1;
/** WebSocket close code the relay sends to a tab another tab just replaced.
 *  The replaced tab must NOT auto-reconnect (two tabs holding the same code
 *  otherwise take the pairing from each other every backoff tick — live-proven
 *  2026-09-21: the daemon flipped projects every 1.5 s and every long call
 *  died DISCONNECTED). A reload of that tab re-dials on purpose and takes over. */
export const CLOSE_REPLACED = 4001;

export type TabHello = { type: 'hello'; v: number; token: string; projectId: string; projectName: string };
export type RelayHelloOk = { type: 'hello-ok'; v: number };
export type RelayRequest =
  | { id: string; type: 'tools/list' }
  | { id: string; type: 'tools/call'; name: string; args: Record<string, unknown> };
export type ToolDescriptor = { name: string; description: string; inputSchema: Record<string, unknown> };
export type McpErrorCode = 'NOT_CONNECTED' | 'INVALID_ARGS' | 'TOOL_FAILED' | 'NEEDS_CONFIRMATION' | 'TIMEOUT' | 'DISCONNECTED';
export type TabResponse =
  | { id: string; tools: ToolDescriptor[] }
  | { id: string; result: unknown }
  | { id: string; error: { code: McpErrorCode; message: string } };

/** Loopback port a tab-issued code points at. The editor mints the code (the
 *  tab has no server to ask), the relay adopts it (`pair --code`) and listens
 *  here, and the tab keeps dialing until it answers. */
export const DEFAULT_RELAY_PORT = 47821;

/** A fresh tab-issued code: DEFAULT_RELAY_PORT + a 96-bit random token (hex).
 *  globalThis.crypto exists in browsers and Node >= 19 — no imports. */
export function mintPairingCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return encodePairingCode(DEFAULT_RELAY_PORT, token);
}

/** Code = base36(port) + '.' + token, upper-cased, dashed every 6 chars for reading. */
export function encodePairingCode(port: number, token: string): string {
  const raw = `${port.toString(36)}.${token}`.toUpperCase();
  return raw.replace(/(.{6})(?=.)/g, '$1-');
}

export function decodePairingCode(code: string): { port: number; token: string } | null {
  const raw = code.replace(/[-\s]/g, '').toLowerCase();
  const m = /^([0-9a-z]{1,4})\.([0-9a-f]{24})$/.exec(raw);
  if (!m) return null;
  const port = parseInt(m[1], 36);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, token: m[2] };
}
