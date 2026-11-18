/**
 * Promote / un-promote a component into the project's sq/ folder (task-207
 * Task 12). The move is the in-instance `/__sq/local/component-promote` route;
 * with no project path there is nothing to move into, so the call refuses
 * without touching the network (the built-in library has no sq/ folder).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useComponentFileOps } from '../useComponentFileOps';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => mockLocalPath }));
let mockLocalPath: string | null = null;

let calls: Array<{ url: string; body?: Record<string, unknown> }> = [];

beforeEach(() => {
  mockLocalPath = null;
  calls = [];
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    if (url.startsWith('/__sq/local/component-promote')) {
      return new Response(JSON.stringify({ success: true, path: 'src/components/sq/Card.astro' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});

describe('useComponentFileOps.promote', () => {
  it('routes through /__sq/local/component-promote', async () => {
    mockLocalPath = 'wc://browser_site';
    const { result } = renderHook(() => useComponentFileOps());

    const next = await result.current.promote('src/components/Card.astro', true);

    expect(next).toEqual({ ok: true, path: 'src/components/sq/Card.astro' });
    expect(calls.find(c => c.url.startsWith('/__sq/local/component-promote'))?.body).toEqual({
      path: 'wc://browser_site',
      componentPath: 'src/components/Card.astro',
      promote: true,
    });
  });

  it('refuses with no project path, without touching the network', async () => {
    const { result } = renderHook(() => useComponentFileOps());

    expect(await result.current.promote('library/Card.astro', true)).toEqual({ ok: false });
    expect(calls).toEqual([]);
  });
});
