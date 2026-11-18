// useBlogBinding (task-240): the current page's blog binding read from the
// page FILE (files are truth), re-read on every scan arrival — the same
// trigger useLocalPageLayoutName rides. Non-local runtimes never fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ localPath: null as string | null }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.localPath }));

import { useBlogBinding } from '../useBlogBinding';
import { TWO_SLOTS } from '@/utils/__tests__/fixtures/lists';
import { setLocalPageFile, setLocalScannedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const BOUND = "---\nimport { getCollection } from 'astro:content';\nconst posts = (await getCollection('works'));\n---\n<BlogSlot>\n  <Fragment slot=\"posts\">{posts.map((post) => <BlogCard post={post} />)}</Fragment>\n</BlogSlot>\n";
const UNBOUND_PAGE = '---\n---\n<BlogSlot />\n';

function mockFetch(content: string) {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ content }) });
}

describe('useBlogBinding', () => {
  beforeEach(() => {
    _resetLocalPageSyncForTests();
    h.localPath = '/Users/x/site';
    setLocalPageFile('src/pages/blog.astro');
  });
  afterEach(() => { vi.unstubAllGlobals(); _resetLocalPageSyncForTests(); });

  it('parses the page file and re-parses when a scan lands', async () => {
    const fetch = mockFetch(BOUND);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useBlogBinding());
    await waitFor(() => expect(result.current?.collection).toBe('works'));

    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ content: UNBOUND_PAGE }) });
    act(() => setLocalScannedRoute('/blog')); // a write reloads the frame → ELEMENTS_SCANNED
    await waitFor(() => expect(result.current?.collection).toBeNull());
    expect(result.current?.hasSlot).toBe(true);
  });

  it('unchanged bytes on a new scan keep the same binding object (no re-render fan-out)', async () => {
    const fetch = mockFetch(BOUND);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useBlogBinding());
    await waitFor(() => expect(result.current?.collection).toBe('works'));
    const first = result.current;
    const calls = fetch.mock.calls.length;
    act(() => setLocalScannedRoute('/blog'));
    await waitFor(() => expect(fetch.mock.calls.length).toBe(calls + 1));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(first);
  });

  it('re-reads when the page FILE changes under the same route (pagination move)', async () => {
    const fetch = mockFetch(BOUND);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useBlogBinding());
    await waitFor(() => expect(result.current?.collection).toBe('works'));
    const calls = fetch.mock.calls.length;
    act(() => setLocalPageFile('src/pages/blog/[...page].astro'));
    await waitFor(() => expect(fetch.mock.calls.length).toBe(calls + 1));
    expect(String(fetch.mock.calls.at(-1)![0])).toContain(encodeURIComponent('src/pages/blog/[...page].astro'));
  });

  it('non-local runtime: null, never fetches', () => {
    h.localPath = null;
    const fetch = mockFetch(BOUND);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useBlogBinding());
    expect(result.current).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('component view (no src/pages file): null', () => {
    setLocalPageFile('src/components/BlogSlot.astro');
    const fetch = mockFetch(BOUND);
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useBlogBinding());
    expect(result.current).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('useBlogBinding — several BlogSlots on a page (task-244 L18)', () => {
  beforeEach(() => { _resetLocalPageSyncForTests(); h.localPath = '/Users/x/site'; setLocalPageFile('src/pages/index.astro'); });
  afterEach(() => { vi.unstubAllGlobals(); _resetLocalPageSyncForTests(); });

  it('the selected line picks its slot: the 2nd slot shows posts2', async () => {
    vi.stubGlobal('fetch', mockFetch(TWO_SLOTS));
    const second = TWO_SLOTS.slice(0, TWO_SLOTS.indexOf('postsClass="b"')).split('\n').length;
    const { result, rerender } = renderHook(({ line }) => useBlogBinding(line), { initialProps: { line: second as number | null } });
    await waitFor(() => expect(result.current?.postsVar).toBe('posts2'));
    expect(result.current).toMatchObject({ slot: 1, slotCount: 2, filter: { field: 'featured', not: true } });
    rerender({ line: null });
    expect(result.current).toMatchObject({ slot: 0, postsVar: 'posts' });
  });
});

