import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as authClient from './authClient';
import { useAuthUser } from './useAuthUser';

describe('useAuthUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts loading, then resolves to the fetched user', async () => {
    vi.spyOn(authClient, 'fetchMe').mockResolvedValue({
      userId: 'u1', email: 'a@b.com', name: 'A', avatarUrl: null,
    });

    const { result } = renderHook(() => useAuthUser());
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual({ userId: 'u1', email: 'a@b.com', name: 'A', avatarUrl: null });
  });

  it('resolves to a null user when not signed in (fetchMe returns null)', async () => {
    vi.spyOn(authClient, 'fetchMe').mockResolvedValue(null);

    const { result } = renderHook(() => useAuthUser());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });
});
