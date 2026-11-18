import { PUBLIC_API_URL } from '@/api/client';
import { getAccessToken, setAccessToken } from './tokenStore';

export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Silent refresh: exchanges the httpOnly refresh cookie for a fresh access
 *  token. Never throws — a logged-out visitor is a normal state, not an
 *  error. On a network failure, keeps whatever token we already had rather
 *  than treating "offline" as "logged out". */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${PUBLIC_API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      setAccessToken(null);
      return null;
    }
    const body = (await res.json()) as { accessToken: string };
    setAccessToken(body.accessToken);
    return body.accessToken;
  } catch {
    return getAccessToken();
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${PUBLIC_API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // best-effort — clear local state regardless
  }
  setAccessToken(null);
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${PUBLIC_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}
