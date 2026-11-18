// Persistent relay identity: ONE token + fixed ports per machine, so the
// connect code never changes across restarts and a paired tab reconnects on
// its own. Lives in ~/.starquix-mcp/daemon.json (0600), next to the catalogue
// cache. STARQUIX_MCP_HOME overrides the directory (tests).
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateToken } from './token.js';

export interface DaemonIdentity {
  token: string;
  /** Loopback WS port the editor tab dials (0 until first start). */
  wsPort: number;
  /** Loopback HTTP control port the CLI / stdio server talk to (0 until first start). */
  controlPort: number;
  /** pid of the running daemon, if any. */
  pid?: number;
  /** Last project a tab paired with — `pair` opens it directly. */
  lastProject?: { projectId: string; projectName: string };
  /** Where the Starquix app runs (the editor URL base). */
  editorUrl: string;
  /** App name `pair` opens the URL with (`open -a`); unset = system default browser. */
  browser?: string;
}

export function homeDir(): string {
  return process.env.STARQUIX_MCP_HOME || join(homedir(), '.starquix-mcp');
}

export function identityPath(): string { return join(homeDir(), 'daemon.json'); }

export const DEFAULT_EDITOR_URL = 'http://localhost:3000';

export function loadIdentity(): DaemonIdentity {
  try {
    const parsed = JSON.parse(readFileSync(identityPath(), 'utf8')) as Partial<DaemonIdentity>;
    if (typeof parsed.token === 'string' && /^[a-f0-9]{24}$/.test(parsed.token)) {
      return { token: parsed.token, wsPort: parsed.wsPort ?? 0, controlPort: parsed.controlPort ?? 0, pid: parsed.pid, lastProject: parsed.lastProject, editorUrl: parsed.editorUrl || DEFAULT_EDITOR_URL, browser: parsed.browser || undefined };
    }
  } catch { /* first run */ }
  const fresh: DaemonIdentity = { token: generateToken(), wsPort: 0, controlPort: 0, editorUrl: DEFAULT_EDITOR_URL };
  saveIdentity(fresh);
  return fresh;
}

export function saveIdentity(id: DaemonIdentity): void {
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(identityPath(), JSON.stringify(id, null, 2));
  try { chmodSync(identityPath(), 0o600); } catch { /* windows */ }
}

export function updateIdentity(patch: Partial<DaemonIdentity>): DaemonIdentity {
  const next = { ...loadIdentity(), ...patch };
  saveIdentity(next);
  return next;
}
