import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAccessToken, getAccessToken } from './tokenStore';
import { refreshAccessToken, logout, fetchMe } from './authClient';

describe('authClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setAccessToken(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('refreshAccessToken', () => {
    it('stores and returns the access token on success', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'fresh-token' }),
      });
      const token = await refreshAccessToken();
      expect(token).toBe('fresh-token');
      expect(getAccessToken()).toBe('fresh-token');
      const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(String(url)).toContain('/auth/refresh');
      expect(init.credentials).toBe('include');
      expect(init.method).toBe('POST');
    });

    it('clears the token and returns null on a 401', async () => {
      setAccessToken('stale-token');
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401 });
      const token = await refreshAccessToken();
      expect(token).toBeNull();
      expect(getAccessToken()).toBeNull();
    });

    it('keeps the existing token on a network error (offline tolerance)', async () => {
      setAccessToken('kept-token');
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
      const token = await refreshAccessToken();
      expect(token).toBe('kept-token');
      expect(getAccessToken()).toBe('kept-token');
    });
  });

  describe('logout', () => {
    it('calls /auth/logout with credentials and clears the local token', async () => {
      setAccessToken('tok');
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      await logout();
      const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(String(url)).toContain('/auth/logout');
      expect(init.credentials).toBe('include');
      expect(getAccessToken()).toBeNull();
    });

    it('clears the local token even if the network call fails', async () => {
      setAccessToken('tok');
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
      await logout();
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('fetchMe', () => {
    it('returns null with no access token (no request made)', async () => {
      const me = await fetchMe();
      expect(me).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches /me with a Bearer header when a token is set', async () => {
      setAccessToken('tok-abc');
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ userId: 'u1', email: 'a@b.com', name: 'A', avatarUrl: null }),
      });
      const me = await fetchMe();
      expect(me).toEqual({ userId: 'u1', email: 'a@b.com', name: 'A', avatarUrl: null });
      const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(String(url)).toContain('/me');
      expect(init.headers.Authorization).toBe('Bearer tok-abc');
    });

    it('returns null on a non-ok response', async () => {
      setAccessToken('tok-abc');
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 });
      expect(await fetchMe()).toBeNull();
    });
  });
});
