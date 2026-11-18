// useFieldBinding (task-240 Phase 2): the selected element's field, parsed
// from the element's own source bytes, re-read on every scan arrival.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ localPath: '/Users/x/site' as string | null, source: '' }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.localPath }));
vi.mock('@/utils/localElementSource', () => ({
  readLocalElementSource: vi.fn(() => Promise.resolve({ source: h.source, startLine: 5, endLine: 5 })),
}));

import { readLocalElementSource } from '@/utils/localElementSource';
import { useFieldBinding } from '../useFieldBinding';
import { setLocalScannedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const LOC = { file: 'src/components/BlogCard.astro', line: 5, column: 3 };

describe('useFieldBinding', () => {
  beforeEach(() => { _resetLocalPageSyncForTests(); h.localPath = '/Users/x/site'; vi.mocked(readLocalElementSource).mockClear(); });
  afterEach(() => _resetLocalPageSyncForTests());

  it('parses the element source and re-reads when a scan lands', async () => {
    h.source = '<h3 class="t">{post.data.title}</h3>';
    const { result } = renderHook(() => useFieldBinding(LOC, 'h3'));
    await waitFor(() => expect(result.current).toEqual({ field: 'title', bindable: true, slot: null, dateFormat: '' }));
    h.source = '<h3 class="t">Static</h3>';
    act(() => setLocalScannedRoute('/__sq_component_view/src/components/BlogCard.astro'));
    await waitFor(() => expect(result.current.field).toBeNull());
  });

  it('no location / non-local: null, never reads', () => {
    const { result } = renderHook(() => useFieldBinding(null, 'h3'));
    expect(result.current).toEqual({ field: null, bindable: false, slot: null, dateFormat: null });
    h.localPath = null;
    renderHook(() => useFieldBinding(LOC, 'h3'));
    expect(readLocalElementSource).not.toHaveBeenCalled();
  });
});

describe('useFieldBinding — a placeholder box', () => {
  it('reads the bound image inside a box and reports a box with block children as not bindable', async () => {
    _resetLocalPageSyncForTests(); h.localPath = '/Users/x/site';
    h.source = '<div class="aspect-video"><img src={post.data.cover.src ?? post.data.cover} alt="" /></div>';
    const { result } = renderHook(() => useFieldBinding(LOC, 'div'));
    await waitFor(() => expect(result.current).toEqual({ field: 'cover', bindable: true, slot: null, dateFormat: null }));
    h.source = '<div class="p-4"><h3>{post.data.title}</h3></div>';
    act(() => setLocalScannedRoute('/__sq_component_view/src/components/BlogCard.astro'));
    await waitFor(() => expect(result.current).toEqual({ field: null, bindable: false, slot: null, dateFormat: null }));
  });
});
