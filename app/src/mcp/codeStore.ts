// The pairing code is remembered per project so a tab reload reconnects on
// its own. A code can also arrive in the URL (`?mcp=<code>`, put
// there by `starquix-mcp pair`): it is parked as PENDING at app boot and
// adopted by the next editor that mounts without a code of its own, so the
// projects page → open project → paired flow needs no typing.
// localStorage may throw (private mode) — never let it.
export function mcpCodeKey(projectId: string): string {
  return `sq:mcp:${projectId}`;
}
export const PENDING_CODE_KEY = 'sq:mcp:pending';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const remove = (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } };

export function getStoredCode(projectId: string): string | null { return read(mcpCodeKey(projectId)); }
export function setStoredCode(projectId: string, code: string): void { write(mcpCodeKey(projectId), code); }

/** Call once at app boot: parks `?mcp=<code>` and strips it from the URL. */
export function adoptCodeFromUrl(loc: { search: string; pathname: string; hash: string } = window.location): string | null {
  const params = new URLSearchParams(loc.search);
  const code = params.get('mcp')?.trim();
  if (!code) return null;
  write(PENDING_CODE_KEY, code);
  params.delete('mcp');
  const rest = params.toString();
  try { window.history.replaceState(window.history.state, '', `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`); } catch { /* not a browser */ }
  return code;
}

/** The pending code, consumed: a project that adopts it stores it as its own. */
export function takePendingCode(projectId: string): string | null {
  const code = read(PENDING_CODE_KEY);
  if (!code) return null;
  remove(PENDING_CODE_KEY);
  setStoredCode(projectId, code);
  return code;
}


