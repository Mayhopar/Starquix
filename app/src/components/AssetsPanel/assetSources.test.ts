// task-144: the WC media library's Dexie-backed source — list maps db.assets
// rows to sq-asset applySrcs with blob thumbs; upload rides THE asset path
// (uploadAssetBlob + transferAssetToIframe).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROWS = [
  { id: 'A1', projectId: 'browser_p', name: 'a.png', mimeType: 'image/png', blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), createdAt: new Date(0) },
  { id: 'B2', projectId: 'browser_p', name: 'clip.mp4', mimeType: 'video/mp4', blob: new Blob([new Uint8Array([1])], { type: 'video/mp4' }), createdAt: new Date(0) },
];
vi.mock('@/db', () => ({
  db: { assets: { where: () => ({ equals: () => ({ toArray: async () => ROWS }) }) } },
  getAssetBlob: (a: { blob: Blob }) => a.blob,
}));
const mockUploadAssetBlob = vi.fn(async () => ({ assetId: 'NEW', editorBlobUrl: 'blob:new' }));
vi.mock('@/hooks/useAssetUpload', () => ({ uploadAssetBlob: (...a: unknown[]) => mockUploadAssetBlob(...a) }));
const mockTransfer = vi.fn(async () => undefined);
vi.mock('@/utils/assetTransfer', () => ({ transferAssetToIframe: (...a: unknown[]) => mockTransfer(...a) }));
vi.mock('@/utils/imageUpload', () => ({ uploadLocalAssetFile: vi.fn() }));

import { makeDexieAssetSource } from './assetSources';

beforeEach(() => {
  mockUploadAssetBlob.mockClear();
  mockTransfer.mockClear();
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:thumb');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

describe('makeDexieAssetSource', () => {
  it('list maps rows to entries with sq-asset applySrc and blob thumbs', async () => {
    const src = makeDexieAssetSource('browser_p');
    const entries = await src.list();
    expect(entries).toEqual([
      { name: 'a.png', kind: 'image', thumbUrl: 'blob:thumb', applySrc: 'sq-asset:A1' },
      { name: 'clip.mp4', kind: 'video', thumbUrl: 'blob:thumb', applySrc: 'sq-asset:B2' },
    ]);
  });

  it('upload calls uploadAssetBlob then transfers bytes into the iframe', async () => {
    const src = makeDexieAssetSource('browser_p');
    const file = new File([new Uint8Array([1])], 'n.png', { type: 'image/png' });
    await src.upload(file);
    expect(mockUploadAssetBlob).toHaveBeenCalledWith('browser_p', file);
    expect(mockTransfer).toHaveBeenCalledWith('NEW', file);
  });

  it('offers no fileFor (bound-rebind unsupported in WC) and revokes thumbs on dispose', async () => {
    const src = makeDexieAssetSource('browser_p');
    expect(src.fileFor).toBeUndefined();
    src.dispose?.([{ name: 'a.png', kind: 'image', thumbUrl: 'blob:thumb', applySrc: 'sq-asset:A1' }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb');
  });
});

const local = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: (...args: unknown[]) => local.fetch(...args), localUrl: (url: string) => url }));
import { makeLocalAssetSource } from './assetSources';
it.each([
  () => new Response('private server detail', { status: 500 }),
  () => new Response('<html>Starting</html>', { headers: { 'content-type': 'text/html' } }),
  () => Response.json({ assets: null }),
])('local list failures stay unavailable instead of becoming an empty library', async response => {
  local.fetch.mockResolvedValue(response());
  await expect(makeLocalAssetSource('browser_lf_p', '/project').list()).rejects.toThrow();
});
it('thumbnails have source-owned cleanup, including repeat disposal', async () => {
  local.fetch.mockImplementation(async (url: string) => url.includes('/assets?') ? Response.json({ assets: [{ file: 'public/a.png', url: '/a.png', kind: 'image' }] }) : new Response('png'));
  const source = makeLocalAssetSource('browser_p', '/project');
  const list = await source.list();
  source.dispose?.(list); source.dispose?.(list);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});
