/**
 * useLocalPageLayoutName — file-truth layout detection for local-mode Layers.
 * Re-fetches the current page file on EVERY scan arrival (localPageSync scan
 * version), not on scannedElements identity — an empty page's scans are
 * shallow-equal-suppressed and never produce a new array, which left the
 * Layers tree blank after an empty-page layout apply (round-3 blind-judge S1).
 * Non-local (no project path) never fetches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  localPath: null as string | null,
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => h.localPath,
}));

import { useLocalPageLayoutName } from '../useLocalPageLayout';
import {
  setLocalPageFile,
  setLocalScannedRoute,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';

const WITH_LAYOUT = `---
import Layout1 from '../layouts/Layout1.astro';
---
<Layout1>
<h1>Hi</h1>
</Layout1>
`;

const NO_LAYOUT = '<html><body><h1>Hi</h1></body></html>';

function mockFetch(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ content }),
  });
}

describe('useLocalPageLayoutName', () => {
  beforeEach(() => {
    _resetLocalPageSyncForTests();
    h.localPath = '/Users/x/site';
    setLocalPageFile('src/pages/index.astro');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetLocalPageSyncForTests();
  });

  it('detects the wrapper layout from the page file bytes', async () => {
    vi.stubGlobal('fetch', mockFetch(WITH_LAYOUT));
    const { result } = renderHook(() => useLocalPageLayoutName());
    await waitFor(() => expect(result.current).toBe('Layout1'));
  });

  it('re-detects when a scan lands WITHOUT a new elements array (empty-page apply, round-3 S1)', async () => {
    const f = mockFetch(NO_LAYOUT);
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useLocalPageLayoutName());
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(result.current).toBeNull();

    // Layout applied to the EMPTY page; the HMR reload's scan arrives with the
    // same (empty) element set — no new array identity, only the scan signal.
    f.mockResolvedValue({ ok: true, json: () => Promise.resolve({ content: WITH_LAYOUT }) });
    act(() => setLocalScannedRoute('/'));
    await waitFor(() => expect(result.current).toBe('Layout1'));
  });

  it('re-nulls after an undo re-scan', async () => {
    const f = mockFetch(WITH_LAYOUT);
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useLocalPageLayoutName());
    await waitFor(() => expect(result.current).toBe('Layout1'));

    // Undo restored the original file; the reload's scan re-vouches.
    f.mockResolvedValue({ ok: true, json: () => Promise.resolve({ content: NO_LAYOUT }) });
    act(() => setLocalScannedRoute('/'));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('never fetches outside local mode', async () => {
    h.localPath = null;
    const f = mockFetch(WITH_LAYOUT);
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useLocalPageLayoutName());
    expect(result.current).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('never fetches for a non-page file (component view)', async () => {
    setLocalPageFile('src/components/Card.astro');
    const f = mockFetch(WITH_LAYOUT);
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useLocalPageLayoutName());
    await waitFor(() => expect(f).not.toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
