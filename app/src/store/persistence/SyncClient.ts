// Sync config (cloud-tier task-087a). 2026-08-28: the Y.Doc sync client is
// gone with the disposable doc — files sync via store/persistence/projectFilesSync.ts
// and assets via assetSync.ts; this module only resolves the config.
import { parseUrlTokenConfig } from '@/utils/urlTokenConfig';
import { getAccessToken } from '@/auth/tokenStore';
import { PUBLIC_API_URL } from '@/api/client';
import { isPaidTier } from '@/utils/entitlement';

export interface SyncConfig {
  url: string;
  token: string;
}

// Dev opt-in until real auth exists (external dev's stack):
// localStorage['sq:sync'] = '{"url":"http://127.0.0.1:8787","token":"<me>"}'
export const SYNC_CONFIG_KEY = 'sq:sync';

// Design (docs/superpowers/specs/2026-07-18-oauth-auth-design.md): the real-
// access-token fallback only fires when this project is talking to the paid
// api/ backend — same trigger as the sq:server-mode toggle. The manual
// sq:sync override is a dev escape hatch and stays ungated.
export function getSyncConfig(projectId: string): SyncConfig | null {
  try {
    const override = parseUrlTokenConfig(localStorage.getItem(SYNC_CONFIG_KEY));
    if (override) return override;
  } catch {
    // storage unavailable
  }
  if (!isPaidTier(projectId)) return null;
  const accessToken = getAccessToken();
  return accessToken ? { url: PUBLIC_API_URL, token: accessToken } : null;
}
