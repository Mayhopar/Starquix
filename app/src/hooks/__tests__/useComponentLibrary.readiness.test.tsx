import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useComponentLibrary, type ScannedComponent } from '../useComponentLibrary';
import { useLocalInstance, type LocalInstanceDriver } from '../useLocalInstance';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { resetLocalTransportForTests, setLocalTransport, setWaitForLocalTransport } from '@/utils/sqLocalBase';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => localPath }));
let localPath = 'wc://browser_a';
const component = (name: string): ScannedComponent => ({
  name, path: `src/components/${name}.astro`, source: 'user-project', html: `<p>${name}</p>`,
  category: '', props: [], slots: [], dependencies: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  resetLocalTransportForTests(); localPath = 'wc://browser_a'; markFilesTruth('browser_a');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).startsWith('/__sq/local/')
    ? new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } })
    : Response.json([component('BuiltIn')]));
});
afterEach(() => { resetLocalTransportForTests(); unmarkFilesTruth('browser_a'); vi.restoreAllMocks(); });

it('loads project components when the real library effect precedes the real instance lifecycle effect', async () => {
  const boot = deferred<{ url: string }>();
  const driver: LocalInstanceDriver = {
    open: async path => { setWaitForLocalTransport(true, path); return boot.promise; },
    probe: async () => true, status: async () => null,
    stop: () => { setWaitForLocalTransport(false); },
  };
  const { result } = renderHook(() => {
    // Same order as EditorContent: library first, useLocalInstance later.
    const library = useComponentLibrary();
    const instance = useLocalInstance('browser_a', localPath, { driver });
    return { library, instance };
  });
  await act(async () => {
    setLocalTransport({ projectPath: localPath, fetch: async url => Response.json(url.includes('scan-components') ? [component('Actual')] : { pages: [] }) });
    boot.resolve({ url: 'https://instance.test' });
  });
  await waitFor(() => expect(result.current.instance.status).toBe('running'));
  await waitFor(() => expect(result.current.library.isLoading).toBe(false));
  expect(result.current.library.error).toBeNull();
  expect(result.current.library.userProject.map(c => c.name)).toEqual(['Actual']);
  expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).startsWith('/__sq/local/'))).toBe(false);
});

it.each(['success', 'failure'] as const)('ignores a late old-project scan %s after the new project scan succeeds', async outcome => {
  const old = deferred<Response>();
  setLocalTransport({ projectPath: localPath, fetch: () => old.promise });
  const { result, rerender } = renderHook(() => useComponentLibrary());
  localPath = 'wc://browser_b';
  setWaitForLocalTransport(true, localPath);
  setLocalTransport({ projectPath: localPath, fetch: async () => Response.json([component('Current')]) });
  rerender();
  await waitFor(() => expect(result.current.userProject.map(c => c.name)).toEqual(['Current']));
  await act(async () => {
    if (outcome === 'success') old.resolve(Response.json([component('Obsolete')]));
    else old.reject(new Error('Old request failed after project changed'));
  });
  expect(result.current.userProject.map(c => c.name)).toEqual(['Current']);
  expect(result.current.error).toBeNull();
});

it('ignores a superseded built-in response as well as its project scan', async () => {
  const oldBuiltIn = deferred<Response>();
  vi.mocked(globalThis.fetch).mockImplementationOnce(() => oldBuiltIn.promise);
  setLocalTransport({ projectPath: localPath, fetch: async () => Response.json([component('Own')]) });
  const { result } = renderHook(() => useComponentLibrary());
  await act(async () => { result.current.refresh(); });
  await waitFor(() => expect(result.current.builtIn.map(c => c.name)).toEqual(['BuiltIn']));
  await act(async () => { oldBuiltIn.resolve(Response.json([component('Obsolete')])); });
  expect(result.current.builtIn.map(c => c.name)).toEqual(['BuiltIn']);
  expect(result.current.isLoading).toBe(false);
});
