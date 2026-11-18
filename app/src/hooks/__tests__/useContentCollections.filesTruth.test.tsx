/**
 * useContentCollections used to mount the doc-era localStorage content tier +
 * Dexie uploads into the WebContainer, keyed by the GLOBAL
 * `starquix:last-project-id` — so another project's posts landed in the wrong
 * container (2026-09-10). Files are truth and the WC runtime is gone: the hook
 * only reads collections — on mount and on every `sq:content-changed`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  fetchCollections: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock('@/core/collections/content-ops', () => ({
  contentOps: { fetchCollections: h.fetchCollections },
}));

import { useContentCollections } from '../useContentCollections';

beforeEach(() => {
  h.fetchCollections.mockReset();
  h.fetchCollections.mockResolvedValue([]);
});

describe('useContentCollections (files-truth, no mount tier)', () => {
  it('reads collections on mount and exposes them', async () => {
    const cols = [{ name: 'blog', posts: [] }];
    h.fetchCollections.mockResolvedValue(cols);
    const { result } = renderHook(() => useContentCollections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.fetchCollections).toHaveBeenCalledTimes(1);
    expect(result.current.collections).toEqual(cols);
    expect(result.current.error).toBeNull();
  });

  it('re-reads on a sq:content-changed window event; stops after unmount', async () => {
    const { result, unmount } = renderHook(() => useContentCollections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => { window.dispatchEvent(new Event('sq:content-changed')); });
    await waitFor(() => expect(h.fetchCollections).toHaveBeenCalledTimes(2));
    unmount();
    window.dispatchEvent(new Event('sq:content-changed'));
    expect(h.fetchCollections).toHaveBeenCalledTimes(2);
  });

  it('a read failure surfaces as error with empty collections', async () => {
    h.fetchCollections.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useContentCollections());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.collections).toEqual([]);
    expect(result.current.error).toContain('boom');
  });
});
