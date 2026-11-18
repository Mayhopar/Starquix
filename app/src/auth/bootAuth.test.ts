import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAuthBoot } from './bootAuth';
import * as authClient from './authClient';

describe('startAuthBoot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls refreshAccessToken once immediately on start', () => {
    const spy = vi.spyOn(authClient, 'refreshAccessToken').mockResolvedValue(null);
    const stop = startAuthBoot();
    expect(spy).toHaveBeenCalledTimes(1);
    stop();
  });

  it('calls refreshAccessToken again after the background interval elapses', () => {
    const spy = vi.spyOn(authClient, 'refreshAccessToken').mockResolvedValue(null);
    const stop = startAuthBoot();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stop() prevents further background refreshes', () => {
    const spy = vi.spyOn(authClient, 'refreshAccessToken').mockResolvedValue(null);
    const stop = startAuthBoot();
    stop();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(spy).toHaveBeenCalledTimes(1); // only the initial call
  });
});
