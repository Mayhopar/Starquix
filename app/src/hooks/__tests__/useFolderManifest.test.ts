import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFolderManifest } from '../useFolderManifest';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => mockPath }));
let mockPath: string | null = null;

beforeEach(() => { mockPath = null; vi.restoreAllMocks(); });

describe('useFolderManifest', () => {
  it('loads from /__sq/folders in WC mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ version: 1, roots: ['f_1'], folders: { f_1: { name: 'A', children: [] } } }),
    );
    const { result } = renderHook(() => useFolderManifest());
    await waitFor(() => expect(result.current.manifest.roots).toEqual(['f_1']));
    expect(fetchSpy).toHaveBeenCalledWith('/__sq/folders');
  });

  it('loads from /__sq/local/folders?path= for a local project', async () => {
    mockPath = '/tmp/site';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: 1, roots: [], folders: {} }));
    renderHook(() => useFolderManifest());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(`/__sq/local/folders?path=${encodeURIComponent('/tmp/site')}`));
  });

  it('an unchanged reload neither re-renders nor changes the manifest identity (perf: every edit reloads it)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ version: 1, roots: ['f_1'], folders: { f_1: { name: 'A', children: [] } } }));
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useFolderManifest(); });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const manifest = result.current.manifest; const before = renders;
    await act(async () => { result.current.reload(); await new Promise(r => setTimeout(r, 20)); });
    expect(result.current.manifest).toBe(manifest);
    expect(renders).toBe(before);
  });

  it('save() updates the built-in library after its write is acknowledged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ version: 1, roots: [], folders: {} }));
    const { result } = renderHook(() => useFolderManifest());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const next = { version: 1 as const, roots: ['f_x'], folders: { f_x: { name: 'X', children: [] } } };
    fetchSpy.mockResolvedValueOnce(Response.json({ success: true }));
    await act(async () => { await result.current.save(next); });
    expect(result.current.manifest).toEqual(next);
    expect(fetchSpy).toHaveBeenCalledWith('/__sq/folders', expect.objectContaining({ method: 'POST' }));
  });
});
