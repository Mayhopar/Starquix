/**
 * The layout file ops with no project path: the built-in library writes
 * through /__sq/save-layout. A project's layouts are accepted file changes
 * (useComponentFileOps.durableLayouts.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useComponentFileOps } from '../useComponentFileOps';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => mockLocalPath }));
let mockLocalPath: string | null = null;

let calls: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  calls = [];
  mockLocalPath = null;
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('useComponentFileOps — layouts', () => {
  it('creates through the built-in save-layout endpoint', async () => {
    const { result } = renderHook(() => useComponentFileOps());
    const path = await result.current.createLayout('Layout1', '<slot />');
    expect(calls[0].url).toBe('/__sq/save-layout');
    expect(calls[0].body).toMatchObject({ name: 'Layout1', astroContent: '<slot />' });
    expect(path).toBe('layouts/Layout1.astro');
  });

  it('deletes by NAME', async () => {
    const { result } = renderHook(() => useComponentFileOps());
    await result.current.deleteLayout('Layout1');
    expect(calls[0].url).toBe('/__sq/delete-layout');
    expect(calls[0].body).toMatchObject({ name: 'Layout1' });
  });

  // A failed write must return null so the caller skips takeSnapshot — an undo
  // entry for a file that was never created would delete someone else's file.
  it('returns null when the endpoint fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const { result } = renderHook(() => useComponentFileOps());
    expect(await result.current.createLayout('Layout1', '<slot />')).toBeNull();
  });
});
