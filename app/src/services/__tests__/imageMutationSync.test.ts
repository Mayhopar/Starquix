import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../filesTruthSync', () => ({ syncChangedFiles: vi.fn(async () => {}), getFilesTruthSyncStatus: () => ({ projectId: 'browser_sync_image', status: 'idle', error: null }), subscribeFilesTruthSyncStatus: () => () => {} }));
vi.mock('@/utils/localMode', () => ({ findLocalProjectEntry: () => ({ path: '/project' }), isLocalProjectId: () => true, PROJECT_NOT_READY: 'missing' }));
import { uploadLocalAssetFile } from '@/utils/imageUpload';
import { makeTransport } from '../localTransport';
import { resetLocalTransportForTests, setLocalTransport } from '@/utils/sqLocalBase';
import { syncChangedFiles } from '../filesTruthSync';
import { setActiveSaveProjectId } from '../pendingProjectMutations';

type Send = (p: string, init?: RequestInit) => Promise<Response>;
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers });
/** Installs the desktop transport contract (makeTransport) over a fake IPC sender. */
function attach(send: Send) { setLocalTransport(makeTransport(undefined, send)); }

afterEach(() => { resetLocalTransportForTests(); vi.restoreAllMocks(); setActiveSaveProjectId(null); });
it('an acknowledged upload returns its src even when the mirror pull fails; the pull owns its own retry', async () => {
  setActiveSaveProjectId('browser_sync_image');
  const calls: string[] = [];
  attach(async (p) => { calls.push(p); return json(p.includes('mutation-session') ? { session: 'epoch' } : { src: '/uploads/once.png' }); });
  vi.mocked(syncChangedFiles).mockRejectedValue(new Error('IndexedDB quota'));
  const result = await uploadLocalAssetFile('browser_sync_image', new File(['bytes'], 'once.png'));
  expect(result.src).toBe('/uploads/once.png');
  expect(syncChangedFiles).toHaveBeenCalledTimes(1);
  expect(calls.filter(path => path.startsWith('/__sq/local/asset?'))).toHaveLength(1);
});
it('an explicit no-write image refusal rejects the upload and lets a corrected input use the same name', async () => {
  setActiveSaveProjectId('browser_sync_image');
  vi.mocked(syncChangedFiles).mockResolvedValue();
  let posts = 0;
  attach(async (_p, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const refused = method === 'POST' && ++posts === 1;
    const data = method === 'GET' ? { session: 'corrected-input-epoch' } : refused ? { error: 'asset too large' } : { src: '/uploads/corrected.png' };
    return json(data, refused ? 413 : 200, refused ? { 'x-sq-mutation-outcome': 'no-write' } : {});
  });
  await expect(uploadLocalAssetFile('browser_sync_image', new File(['invalid input'], 'corrected.png'))).rejects.toThrow('asset too large');
  expect((await uploadLocalAssetFile('browser_sync_image', new File(['corrected input'], 'corrected.png'))).src).toBe('/uploads/corrected.png');
});
it('dispatches the captured File bytes without a second fallible file read', async () => {
  setActiveSaveProjectId('browser_sync_image'); vi.mocked(syncChangedFiles).mockResolvedValue();
  const sent: number[][] = [];
  attach(async (p, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      sent.push(Array.from(new Uint8Array(init!.body as ArrayBuffer)));
      expect(init!.headers).toMatchObject({ 'content-type': 'image/png' });
      expect(p).toContain('name=captured.png');
    }
    return json(method === 'GET' ? { session: 'captured-bytes-epoch' } : { src: '/uploads/captured.png' });
  });
  const file = new File(['bytes'], 'captured.png', { type: 'image/png' });
  const read = vi.fn().mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer).mockRejectedValue(new DOMException('File became unreadable', 'NotReadableError'));
  Object.defineProperty(file, 'arrayBuffer', { value: read });
  const result = await uploadLocalAssetFile('browser_sync_image', file);
  expect(result.src).toBe('/uploads/captured.png');
  expect(result.previewUrl).toBe('data:image/png;base64,AQID');
  expect(read).toHaveBeenCalledTimes(1); expect(sent).toEqual([[1, 2, 3]]);
});

it('preview preparation failure sends no upload and allows the original file to retry', async () => {
  setActiveSaveProjectId('browser_sync_image'); vi.mocked(syncChangedFiles).mockResolvedValue();
  const sent: number[][] = [];
  attach(async (_p, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') sent.push(Array.from(new Uint8Array(init!.body as ArrayBuffer)));
    return json(method === 'GET' ? { session: 'preview-preparation-epoch' } : { src: '/uploads/retry.png' });
  });
  const file = new File([new Uint8Array([1, 2, 3])], 'retry.png', { type: 'image/png' });
  const fail = () => { throw new Error('Preview encoding failed'); };
  // Node >=25 (and Chromium) encode with the native Uint8Array.prototype.toBase64; btoa is the fallback.
  const proto = Uint8Array.prototype as unknown as { toBase64?: () => string };
  if (proto.toBase64) vi.spyOn(proto as Required<typeof proto>, 'toBase64').mockImplementationOnce(fail);
  else vi.spyOn(globalThis, 'btoa').mockImplementationOnce(fail);
  await expect(uploadLocalAssetFile('browser_sync_image', file)).rejects.toThrow('Preview encoding failed');
  expect(sent).toEqual([]);
  const result = await uploadLocalAssetFile('browser_sync_image', file);
  expect(result).toEqual({ src: '/uploads/retry.png', previewUrl: 'data:image/png;base64,AQID' });
  expect(sent).toEqual([[1, 2, 3]]);
});
