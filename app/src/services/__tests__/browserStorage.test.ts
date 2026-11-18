import { afterEach, expect, it, vi } from 'vitest';
import { getBrowserStorage, requestBrowserPersistence, storageFailureGuidance } from '../browserStorage';
afterEach(() => vi.restoreAllMocks());
it('keeps estimate and persistence failures advisory', async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => { throw new Error('denied'); }, persisted: async () => { throw new Error('denied'); }, persist: async () => { throw new Error('denied'); } } as unknown as StorageManager });
  expect(await getBrowserStorage()).toEqual({ usage: null, quota: null, persisted: null });
  expect(await requestBrowserPersistence()).toBe(null);
});
it('supports absent APIs and denied persistence', async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, get: () => ({ persist: async () => false }) });
  expect(await getBrowserStorage()).toEqual({ usage: null, quota: null, persisted: null });
  expect(await requestBrowserPersistence()).toBe(false);
});
it('recognizes wrapped quota errors without copying private error text into guidance', () => {
  const guidance = storageFailureGuidance('QuotaExceededError sk-secret-fixture', 'create');
  expect(guidance).toMatch(/browser storage/i);
  expect(guidance).not.toMatch(/sk-secret|free|clear|reload|keep this tab/i);
  expect(storageFailureGuidance(new DOMException('sk-secret-fixture', 'QuotaExceededError'), 'import')).not.toContain('sk-secret-fixture');
});
it('does not diagnose a source failure as a storage problem or expose raw import errors', () => {
  const guidance = storageFailureGuidance(new Error('import name already used (imports astro:transitions)'), 'create');
  expect(guidance).not.toMatch(/storage|astro:transitions|import name|free|clear|keep this tab/i);
});
it('does not expose private import exceptions as product copy', () => {
  expect(storageFailureGuidance(new Error('<html>/Users/private/token-secret'), 'import')).not.toMatch(/<html>|Users|token-secret/);
});
