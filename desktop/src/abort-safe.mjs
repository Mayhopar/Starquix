/** `fetch` with the same contract, except that `init.signal` reaches undici only once fetch() has returned. undici's fetch
 *  arms its abort listener before its controller exists, so an abort landing inside fetch()'s synchronous setup (dispatch
 *  included), or any abort after that setup threw, was an uncaught `assert(controller != null)` — Electron's modal
 *  main-process dialog (2026-11-09). Every undici fetch in main (Node's global fetch) that carries a signal goes through
 *  this; Electron's Session#fetch / net.fetch run on Chromium's network stack, not undici (update-check.mjs). */
export const abortSafe = fetch => (url, init = {}) => {
  const stop = init.signal; if (!stop) return fetch(url, init);
  const own = new AbortController(); const forward = () => own.abort(stop.reason);
  if (stop.aborted) forward();
  const response = fetch(url, { ...init, signal: own.signal }); // a throw here: never wired
  if (stop.aborted) forward(); else stop.addEventListener('abort', forward, { once: true });
  return response;
};
