// getSyncConfig — the config reader that survives the disposable-doc cut.
import { describe, it, expect, afterEach } from 'vitest';
import { getSyncConfig, SYNC_CONFIG_KEY } from '../SyncClient';

afterEach(() => localStorage.removeItem(SYNC_CONFIG_KEY));

describe('getSyncConfig', () => {
  it('null without config, parses {url, token}, strips trailing slash', () => {
    expect(getSyncConfig('browser_x')).toBeNull();
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify({ url: 'http://h:1/', token: 't' }));
    expect(getSyncConfig('browser_x')).toEqual({ url: 'http://h:1', token: 't' });
  });
});
