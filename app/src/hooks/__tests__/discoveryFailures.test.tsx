import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useComponentLibrary } from '../useComponentLibrary';
import { useLayoutLibrary } from '../useLayoutLibrary';
import { resetLocalTransportForTests, setLocalTransport } from '@/utils/sqLocalBase';
import { db } from '@/db';

let localPath = 'wc://browser_a';
vi.mock('../useLocalProjectPath', () => ({ useLocalProjectPath: () => localPath }));
const component = (name = 'Own') => ({ name, path: `src/components/${name}.astro`, html: '<p/>', category: '', props: [], slots: [], dependencies: [] });
const layout = (name = 'Main') => ({ name, path: `${name}.astro`, absolutePath: `/private/${name}.astro`, frontmatter: '', body: '<slot/>', props: [], slots: [] });
let response: () => Promise<Response>;
beforeEach(async () => {
  await db.delete(); await db.open();
  localPath = 'wc://browser_a'; resetLocalTransportForTests();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
  response = async () => Response.json([component()]);
  setLocalTransport({ projectPath: localPath, fetch: () => response() });
});
afterEach(() => { resetLocalTransportForTests(); vi.restoreAllMocks(); });

it.each([
  ['HTML', () => new Response('<html>/Users/private/token-secret', { headers: { 'content-type': 'text/html' } })],
  ['wrong shape', () => Response.json([{ name: 'Looks real', path: 9 }])],
  ['missing type', () => new Response(JSON.stringify([component()]))],
] as const)('rejects a successful %s component response without publishing it or raw text', async (_name, value) => {
  response = async () => value();
  const { result } = renderHook(() => useComponentLibrary());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.error).toMatch(/components.*unavailable/i);
  expect(result.current.error).not.toMatch(/Users|token-secret|JSON|Response/);
  expect(result.current.userProject).toEqual([]);
});

it('retains a failed refresh only as last-good display data and never reuses it in another project', async () => {
  const { result, rerender } = renderHook(() => useComponentLibrary());
  await waitFor(() => expect(result.current.userProject).toHaveLength(1));
  response = async () => { throw new Error('private error'); };
  await act(async () => { result.current.refresh(); });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.userProject).toEqual([]);
  expect(result.current.projectState).toMatchObject({ status: 'unavailable', data: [{ name: 'Own' }] });
  localPath = 'wc://browser_b';
  setLocalTransport({ projectPath: localPath, fetch: async () => Response.json([]) });
  rerender();
  expect(result.current.userProject).toEqual([]);
  expect(result.current.projectState.data).toBeNull();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.projectState).toMatchObject({ status: 'ready', data: [] });
  expect(result.current.error).toBeNull();
});

it('distinguishes a malformed layout list from a genuine empty project and retains same-project last-good layouts', async () => {
  response = async () => Response.json({ layouts: [layout()] });
  const { result } = renderHook(() => useLayoutLibrary());
  await waitFor(() => expect(result.current.layouts).toHaveLength(1));
  response = async () => Response.json({ layouts: [{ name: 'Looks real', path: 9 }] });
  await act(async () => { result.current.refresh(); });
  // A revalidation of a ready library never flips to loading (stale-while-revalidate): wait for the outcome.
  await waitFor(() => expect(result.current.error).toMatch(/layouts.*unavailable/i));
  expect(result.current.layouts).toEqual([]);
  expect(result.current.readState).toMatchObject({ status: 'unavailable', data: [{ name: 'Main' }] });
  response = async () => Response.json({ layouts: [] });
  await act(async () => { result.current.refresh(); });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.error).toBeNull();
  expect(result.current.layouts).toEqual([]);
});

it('cancels the accepted-layout transport read when its discovery owner unmounts', async () => {
  let requestSignal: AbortSignal | null | undefined;
  let entered!: () => void, rejectRequest!: (error: Error) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  setLocalTransport({ projectPath: localPath, fetch: (_url, init) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init?.signal; rejectRequest = reject; entered();
    requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  const view = renderHook(() => useLayoutLibrary());
  await act(async () => { await started; });
  try {
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
  } finally { await act(async () => { rejectRequest(new DOMException('Test cleanup', 'AbortError')); }); }
});

it.each(['success', 'failure'])('ignores a late old-project layout %s after a new owner loads', async outcome => {
  let resolve!: (response: Response) => void; let reject!: (error: Error) => void;
  let entered!: () => void;
  const started = new Promise<void>(yes => { entered = yes; });
  response = () => new Promise((yes, no) => { resolve = yes; reject = no; entered(); });
  const { result, rerender } = renderHook(() => useLayoutLibrary());
  await act(async () => { await started; });
  localPath = 'wc://browser_b';
  setLocalTransport({ projectPath: localPath, fetch: async () => Response.json({ layouts: [layout('Current')] }) });
  rerender();
  await waitFor(() => expect(result.current.layouts[0]?.name).toBe('Current'));
  await act(async () => { if (outcome === 'success') resolve(Response.json({ layouts: [layout('Old')] })); else reject(new Error('Old failure')); });
  expect(result.current.layouts[0]?.name).toBe('Current');
  expect(result.current.error).toBeNull();
});

it.each([
  ['HTML', () => new Response('<html>/Users/private/token-secret', { headers: { 'content-type': 'text/html' } })],
  ['missing type', () => new Response(JSON.stringify({ layouts: [layout()] }))],
] as const)('rejects a successful %s accepted-layout response without publishing it or raw text', async (_name, value) => {
  response = async () => value();
  const { result } = renderHook(() => useLayoutLibrary());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.error).toMatch(/layouts.*unavailable/i);
  expect(result.current.error).not.toMatch(/Users|token-secret|JSON|Response/);
  expect(result.current.layouts).toEqual([]);
});
