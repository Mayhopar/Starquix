/**
 * useAssetUpload Tests (task-011)
 *
 * Verifies the editor-side asset upload contract used by ImageBlock and FillBlock:
 * - uploadAsset(file): mints a UUID, persists the file blob to IndexedDB
 *   (db.assets.add), and returns { assetId, editorBlobUrl }. The blob URL is
 *   editor-origin (URL.createObjectURL) — not the iframe-origin URL bridge.js
 *   creates separately.
 * - getAssetUrl(id): looks up the asset in IndexedDB and resolves to a fresh
 *   editor-origin blob URL, or null when the asset is missing.
 *
 * The Dexie `db` and `uuid` are mocked so the hook can be exercised in jsdom
 * without touching real IndexedDB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ----------------------------------------------------------------------------
// Mocks (must be declared before importing the hook)
// ----------------------------------------------------------------------------

const mockAdd = vi.fn(async () => undefined);
const mockGet = vi.fn(async (_id: string) => null as unknown);
const mockGetAssetBlob = vi.fn((asset: { blob: Blob }) => asset.blob);

vi.mock('uuid', () => ({
  v4: () => 'fixed-uuid-1234',
}));

vi.mock('../db', () => ({
  db: {
    assets: {
      add: (...args: unknown[]) => mockAdd(...args),
      get: (...args: unknown[]) => mockGet(...(args as [string])),
    },
  },
  getAssetBlob: (asset: { blob: Blob }) => mockGetAssetBlob(asset),
}));

// Cloud asset push (task-087b) — the real round-trip against the reference
// server is covered in store/persistence/__tests__/assetSync.test.ts; here we
// only pin that uploadAsset calls it iff sq:sync is configured.
const mockPushAsset = vi.fn(async () => undefined);
vi.mock('../store/persistence/assetSync', () => ({
  pushAsset: (...args: unknown[]) => mockPushAsset(...(args as [])),
}));

// Stable URL.createObjectURL mock so we can assert returned blob URLs.
const createObjectURLSpy = vi.fn((blob: Blob) => `blob:mock/${(blob as Blob).size}`);
beforeEach(() => {
  mockAdd.mockClear();
  mockGet.mockReset();
  mockGetAssetBlob.mockClear();
  mockPushAsset.mockClear();
  createObjectURLSpy.mockClear();
  // jsdom does not implement createObjectURL — define/replace per test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).createObjectURL = createObjectURLSpy;
});

// Import after mocks
import { useAssetUpload, uploadAssetBlob } from './useAssetUpload';

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('useAssetUpload', () => {
  it('uploadAsset persists the file to IndexedDB and returns id + editor blob URL', async () => {
    const { result } = renderHook(() => useAssetUpload('browser_proj-1'));

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    let uploaded: { assetId: string; editorBlobUrl: string } | null = null;
    await act(async () => {
      uploaded = await result.current.uploadAsset(file);
    });

    expect(uploaded).not.toBeNull();
    expect(uploaded!.assetId).toBe('fixed-uuid-1234');
    expect(uploaded!.editorBlobUrl).toBe(`blob:mock/${file.size}`);

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const stored = mockAdd.mock.calls[0][0] as {
      id: string;
      projectId: string;
      name: string;
      mimeType: string;
      blob: File;
      createdAt: Date;
    };
    expect(stored.id).toBe('fixed-uuid-1234');
    expect(stored.projectId).toBe('browser_proj-1');
    expect(stored.name).toBe('photo.png');
    expect(stored.mimeType).toBe('image/png');
    expect(stored.blob).toBe(file);
    expect(stored.createdAt).toBeInstanceOf(Date);

    expect(createObjectURLSpy).toHaveBeenCalledWith(file);
  });

  it('getAssetUrl returns a blob URL for an existing asset', async () => {
    const storedBlob = new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' });
    mockGet.mockResolvedValueOnce({ id: 'a-1', blob: storedBlob });

    const { result } = renderHook(() => useAssetUpload('browser_proj-1'));

    let url: string | null = null;
    await act(async () => {
      url = await result.current.getAssetUrl('a-1');
    });

    expect(mockGet).toHaveBeenCalledWith('a-1');
    expect(mockGetAssetBlob).toHaveBeenCalledTimes(1);
    expect(url).toBe(`blob:mock/${storedBlob.size}`);
  });

  it('getAssetUrl returns null when the asset is missing', async () => {
    mockGet.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAssetUpload('browser_proj-1'));

    let url: string | null | undefined = 'placeholder';
    await act(async () => {
      url = await result.current.getAssetUrl('missing');
    });

    expect(url).toBeNull();
    expect(mockGetAssetBlob).not.toHaveBeenCalled();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('pushes the bytes to the sync backend when sq:sync is configured (task-087b)', async () => {
    localStorage.setItem('sq:sync', JSON.stringify({ url: 'http://b', token: 't' }));
    try {
      const { result } = renderHook(() => useAssetUpload('browser_proj-1'));
      const file = new File(['x'], 'x.png', { type: 'image/png' });
      await act(async () => {
        await result.current.uploadAsset(file);
      });
      expect(mockPushAsset).toHaveBeenCalledTimes(1);
      expect(mockPushAsset).toHaveBeenCalledWith('fixed-uuid-1234', file, {
        url: 'http://b',
        token: 't',
      });
    } finally {
      localStorage.removeItem('sq:sync');
    }
  });

  it('does not push when sq:sync is not configured', async () => {
    const { result } = renderHook(() => useAssetUpload('browser_proj-1'));
    await act(async () => {
      await result.current.uploadAsset(new File(['x'], 'x.png', { type: 'image/png' }));
    });
    expect(mockPushAsset).not.toHaveBeenCalled();
  });

  it('uploadAssetBlob stores blob and returns assetId + blob url (plain function, task-119)', async () => {
    const file = new File(['x'], 'gen.png', { type: 'image/png' });
    const { assetId, editorBlobUrl } = await uploadAssetBlob('proj-1', file);
    expect(assetId).toBe('fixed-uuid-1234');
    expect(editorBlobUrl).toContain('blob:');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const stored = mockAdd.mock.calls[0][0] as { projectId: string; mimeType: string; blob: File };
    expect(stored.projectId).toBe('proj-1');
    expect(stored.mimeType).toBe('image/png');
    expect(stored.blob).toBe(file);
  });

  it('uses the projectId passed to the hook when persisting assets', async () => {
    const { result } = renderHook(() => useAssetUpload('browser_proj-XYZ'));
    const file = new File(['x'], 'x.png', { type: 'image/png' });

    await act(async () => {
      await result.current.uploadAsset(file);
    });

    const stored = mockAdd.mock.calls[0][0] as { projectId: string };
    expect(stored.projectId).toBe('browser_proj-XYZ');
  });
});
