import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLayoutLibrary, type ScannedLayout } from './useLayoutLibrary';

const sampleLayouts: ScannedLayout[] = [
  {
    name: 'Base',
    path: 'Base.astro',
    absolutePath: '/tmp/Base.astro',
    props: [{ name: 'title', type: 'string', required: false }],
    slots: ['default'],
    frontmatter: '',
    body: '<slot />',
  },
];

describe('useLayoutLibrary', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(sampleLayouts),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fetches /__sq/scan-layouts and returns layouts', async () => {
    const { result } = renderHook(() => useLayoutLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledWith('/__sq/scan-layouts', expect.any(Object));
    expect(result.current.layouts.map((l) => l.name)).toEqual(['Base']);
  });

  it('refresh re-fetches the layouts', async () => {
    const { result } = renderHook(() => useLayoutLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    fetchSpy.mockClear();
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it('handles non-OK responses gracefully', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }) as Response);
    const { result } = renderHook(() => useLayoutLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.layouts).toEqual([]);
    expect(result.current.error).toBe('Project layouts are unavailable.');
  });
});
