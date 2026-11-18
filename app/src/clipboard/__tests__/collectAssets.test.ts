import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db', () => ({
  db: { assets: { get: vi.fn() } },
  getAssetBlob: (a: { blob: Blob }) => a.blob,
}));

import { db } from '@/db';
import { collectAssetRefs, collectAssets } from '../collectAssets';

const getMock = db.assets.get as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { getMock.mockReset(); });

describe('collectAssetRefs', () => {
  it('finds unique sq-asset ids across strings, excluding cover_ ids', () => {
    const refs = collectAssetRefs([
      `<img src="sq-asset:aaa-1"> bg-[url('sq-asset:bbb-2')]`,
      'sq-asset:aaa-1 sq-asset:cover_projx',
    ]);
    expect(refs).toEqual(['aaa-1', 'bbb-2']);
  });
});

// jsdom Blob lacks .arrayBuffer(); stub the blob shape (size + arrayBuffer) like the db row is stubbed.
const fakeBlob = (bytes: Uint8Array) => ({
  size: bytes.length,
  arrayBuffer: () => Promise.resolve(bytes.buffer),
});

describe('collectAssets', () => {
  it('embeds found blobs as base64 and null-marks missing rows', async () => {
    getMock.mockImplementation((id: string) =>
      id === 'aaa-1'
        ? Promise.resolve({ id, name: 'a.png', mimeType: 'image/png', blob: fakeBlob(new Uint8Array([1, 2, 3])) })
        : Promise.resolve(undefined));
    const assets = await collectAssets(['aaa-1', 'missing']);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ assetId: 'aaa-1', mime: 'image/png', name: 'a.png' });
    expect(assets[0].base64).toBeTruthy();
  });

  it('null-marks oversized blobs instead of embedding', async () => {
    const big = { size: 5 * 1024 * 1024, arrayBuffer: () => Promise.reject(new Error('should not read')) };
    getMock.mockResolvedValue({ id: 'big', name: 'b.png', mimeType: 'image/png', blob: big });
    const assets = await collectAssets(['big']);
    expect(assets[0].base64).toBeNull();
  });
});
