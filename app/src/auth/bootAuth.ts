import { refreshAccessToken } from './authClient';

// Well under the 15-minute access-token TTL, so a session that outlives one
// refresh cycle never has more than a few minutes of staleness.
const BACKGROUND_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Call once when the app mounts. Immediately attempts a silent refresh
 *  (reauthenticates from the httpOnly cookie with no visible login flash
 *  when the cookie is still valid), then keeps the access token fresh in
 *  the background for as long as the tab stays open. Returns a cleanup
 *  function that stops the background refresh. */
export function startAuthBoot(): () => void {
  void refreshAccessToken();
  const interval = setInterval(() => {
    void refreshAccessToken();
  }, BACKGROUND_REFRESH_INTERVAL_MS);
  return () => clearInterval(interval);
}
