import * as React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/db', () => ({ db: { projects: { get: vi.fn(async () => ({ filesTruth: true })) } } }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('resolves the persisted mode across two fresh sessions when the mirror cannot be written, without reloading', async () => {
  const reload = vi.fn();
  const setItem = vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem });
  const browser = Object.create(window);
  Object.defineProperty(browser, 'location', { value: { reload } });
  vi.stubGlobal('window', browser);
  const resolved: unknown[] = [];
  for (let session = 0; session < 2; session++) {
    vi.resetModules();
    vi.doMock('react', () => React);
    const { useFilesTruthMirror } = await import('../useFilesTruthMirror');
    const { isLocalProjectId, findLocalProjectEntry } = await import('@/utils/localMode');
    expect(isLocalProjectId('browser_persisted')).toBe(false);
    const { result, unmount } = renderHook(() => {
      const mode = useFilesTruthMirror('browser_persisted');
      return React.useMemo(() => ({ mode, path: findLocalProjectEntry('browser_persisted')?.path }), [mode]);
    });
    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(session + 1));
    resolved.push(result.current);
    unmount();
  }
  expect(setItem).toHaveBeenCalledTimes(2);
  expect(reload).not.toHaveBeenCalled();
  expect(resolved).toEqual([{ mode: true, path: 'wc://browser_persisted' }, { mode: true, path: 'wc://browser_persisted' }]);
});
it('reads non-prefixed legacy rows and handles storage-open rejection without an unhandled failure', async () => {
  const { db } = await import('@/db');
  vi.mocked(db.projects.get).mockRejectedValueOnce(new Error('private storage'));
  const { useFilesTruthMirror } = await import('../useFilesTruthMirror');
  const { result } = renderHook(() => useFilesTruthMirror('legacy-id'));
  await waitFor(() => expect(db.projects.get).toHaveBeenCalledWith('legacy-id'));
  expect(result.current).toBe(false);
});
