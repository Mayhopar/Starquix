/**
 * Paid-tier gate (Phase 6). The retired `sq:server-mode` dev toggle doubled
 * as the entitlement stand-in for the real-auth fallbacks (cloud sync, remote
 * database). Same shape, honest name: `localStorage['sq:paid:{projectId}']`
 * (dev-only until the entitlement arrives from the account).
 */
export function paidTierKey(projectId: string): string {
  return `sq:paid:${projectId}`;
}

export function isPaidTier(projectId: string): boolean {
  if (!import.meta.env.DEV) return false; // prod entitlement comes from the account later
  try { return localStorage.getItem(paidTierKey(projectId)) !== null; } catch { return false; }
}
