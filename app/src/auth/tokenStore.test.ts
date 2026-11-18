import { describe, it, expect, beforeEach } from 'vitest';
import { getAccessToken, setAccessToken } from './tokenStore';

const STORAGE_KEY = 'sq:access-token';

describe('tokenStore', () => {
  beforeEach(() => {
    localStorage.clear();
    setAccessToken(null);
  });

  it('returns null when nothing has been set', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('setAccessToken persists to localStorage and getAccessToken reads it back', () => {
    setAccessToken('tok-123');
    expect(getAccessToken()).toBe('tok-123');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('tok-123');
  });

  it('setAccessToken(null) clears localStorage', () => {
    setAccessToken('tok-123');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
