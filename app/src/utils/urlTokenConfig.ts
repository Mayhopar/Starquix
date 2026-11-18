/** Parse a `{"url":"…","token":"…"}` localStorage config value.
 *  Used by the sync (sq:sync) config:
 *  require non-empty strings, strip trailing slashes, null on malformed. */
export function parseUrlTokenConfig(raw: string | null): { url: string; token: string } | null {
  try {
    if (!raw) return null;
    const cfg = JSON.parse(raw) as { url?: unknown; token?: unknown };
    if (typeof cfg?.url !== 'string' || typeof cfg?.token !== 'string' || !cfg.url || !cfg.token) {
      return null;
    }
    return { url: cfg.url.replace(/\/+$/, ''), token: cfg.token };
  } catch {
    return null;
  }
}
