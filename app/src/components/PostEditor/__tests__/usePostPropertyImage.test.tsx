import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fetchImage = vi.hoisted(() => vi.fn());
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: fetchImage }));
import { postPropertyImageFile, usePostPropertyImage } from '../usePostPropertyImage';
const post = 'src/content/works/PetcubeTracker.mdx';
let blobs: Blob[];
beforeEach(() => {
  fetchImage.mockReset(); blobs = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return `blob:owned-${blobs.length}`; }),
    revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe('post image preview paths and read ownership', () => {
  it('resolves the imported Petcube paths relative to the post directory', () => {
    expect(postPropertyImageFile(post, './images/PetcubeTracker/PetcubeTracker.png')).toBe('src/content/works/images/PetcubeTracker/PetcubeTracker.png');
    expect(postPropertyImageFile(post, './images/misc/blank.png')).toBe('src/content/works/images/misc/blank.png');
    expect(postPropertyImageFile(post, '/uploads/cover.png')).toBe('public/uploads/cover.png');
    expect(postPropertyImageFile(post, '../../../assets/cover.png')).toBe('assets/cover.png');
    expect(postPropertyImageFile(post, '../../../../secret')).toBeNull();
    expect(postPropertyImageFile(post, '../../../node_modules/a.png')).toBeNull();
  });
  it.each(['/host/project', 'wc://browser_fixture'])('reads binary through localFetch for %s and revokes only its own preview', async projectPath => {
    fetchImage.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71])));
    const { result, unmount } = renderHook(() => usePostPropertyImage('./images/PetcubeTracker/PetcubeTracker.png', post, projectPath));
    await waitFor(() => expect(result.current.url).toBe('blob:owned-1'));
    const request = new URL(fetchImage.mock.calls[0][0], 'https://editor.test');
    expect(request.pathname).toBe('/__sq/local/file');
    expect(request.searchParams.get('path')).toBe(projectPath);
    expect(request.searchParams.get('file')).toBe('src/content/works/images/PetcubeTracker/PetcubeTracker.png');
    expect(blobs[0].type).toBe('image/png'); expect(blobs[0].size).toBe(4);
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
  });
  it('does not expose a stale response after changing post owner', async () => {
    let finishOld!: (response: Response) => void;
    fetchImage.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const { result, rerender } = renderHook(({ path }) => usePostPropertyImage('./images/a.png', post, path), { initialProps: { path: '/old' } });
    fetchImage.mockResolvedValue(new Response(new Uint8Array([2])));
    rerender({ path: '/new' });
    await waitFor(() => expect(result.current.url).toBe('blob:owned-1'));
    await act(async () => finishOld(new Response(new Uint8Array([1]))));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(result.current.url).toBe('blob:owned-1');
    expect(fetchImage.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('keeps missing images as a non-mutating unavailable preview', async () => {
    fetchImage.mockResolvedValue(new Response('missing', { status: 404 }));
    const { result } = renderHook(() => usePostPropertyImage('./images/missing.png', post, '/project'));
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.url).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

it.each(['host', 'browser'])('reads a real imported image through the production %s file route', async disk => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { registerProjectFsRoutes } = await import('../../../../../preview-template/src/plugins/sq-project-fs-routes.js');
  const root = mkdtempSync(join(tmpdir(), 'sq-post-preview-'));
  const relative = 'src/content/works/images/PetcubeTracker/PetcubeTracker.png';
  mkdirSync(join(root, 'src/content/works/images/PetcubeTracker'), { recursive: true });
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 201]);
  writeFileSync(join(root, relative), png);
  type Reply = { statusCode: number; setHeader: () => void; writeHead: (status: number) => void; end: (bytes: BodyInit) => void };
  type Route = (req: { method: string; url: string }, res: Reply, next: () => void) => void;
  const handlers = new Map<string, Route>();
  registerProjectFsRoutes({ middlewares: { use: (path: string, handler: Route) => handlers.set(path, handler) } }, {
    resolveRoot: (req: { url: string }) => disk === 'host' ? new URL(req.url, 'http://fixture').searchParams.get('path') : root,
    sqComponentsDir: root,
  });
  fetchImage.mockImplementation((url: string) => new Promise<Response>(resolve => {
    const reply: Reply = { statusCode: 200, setHeader: () => {}, writeHead(status) { this.statusCode = status; }, end(bytes) { resolve(new Response(bytes, { status: this.statusCode })); } };
    handlers.get('/__sq/local/file')!({ url, method: 'GET' }, reply, () => { throw new Error('Missing production route'); });
  }));
  const { result, unmount } = renderHook(() => usePostPropertyImage('./images/PetcubeTracker/PetcubeTracker.png', post, disk === 'host' ? root : 'wc://browser_fixture'));
  try {
    await waitFor(() => expect(result.current.url).toBe('blob:owned-1'));
    expect(blobs[0].size).toBe(png.byteLength); expect(blobs[0].type).toBe('image/png');
    // The original source spelling never becomes a URL relative to the editor.
    expect(fetchImage.mock.calls[0][0]).toContain('file=src%2Fcontent%2Fworks%2Fimages%2FPetcubeTracker%2FPetcubeTracker.png');
  } finally { unmount(); rmSync(root, { recursive: true, force: true }); }
});
