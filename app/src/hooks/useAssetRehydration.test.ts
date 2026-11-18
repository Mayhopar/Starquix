/**
 * useAssetRehydration Tests (task-012, reworked in task-120)
 *
 * Diff-based rehydration contract:
 * - The bridge reports the asset ids it already holds via the
 *   `sq:assets-owned` window event (relayed from ASSETS_OWNED after
 *   IFRAME_READY); the hook diffs that list against Dexie and transfers ONLY
 *   the missing (non-cover) assets.
 * - Mount race: if the report fired before the hook attached (or before
 *   projectId hydrated), the hook catches up from getLastAssetsOwned().
 * - `projectId` null → no-op.
 * - RENDER never triggers rehydration (no per-RENDER event anymore).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ----------------------------------------------------------------------------
// Mocks (must be declared before importing the hook)
// ----------------------------------------------------------------------------

const mockToArray = vi.fn(async () => [] as unknown[]);
const mockEquals = vi.fn(() => ({ toArray: () => mockToArray() }));
const mockWhere = vi.fn(() => ({ equals: (id: string) => mockEquals(id) }));
const mockGetAssetBlob = vi.fn((asset: { blob: Blob }) => asset.blob);

vi.mock('@/db', () => ({
  db: {
    assets: {
      where: (field: string) => mockWhere(field),
    },
  },
  getAssetBlob: (asset: { blob: Blob }) => mockGetAssetBlob(asset),
}));

const mockTransferAsset = vi.fn(async (_id: string, _blob: Blob) => undefined);
vi.mock('@/utils/assetTransfer', () => ({
  transferAssetToIframe: (id: string, blob: Blob) => mockTransferAsset(id, blob),
}));

const mockLastOwned = vi.fn((): string[] | null => null);
vi.mock('@/components/Canvas/viewportMessages/lifecycle', () => ({
  getLastAssetsOwned: () => mockLastOwned(),
}));

beforeEach(() => {
  mockWhere.mockClear();
  mockEquals.mockClear();
  mockToArray.mockReset();
  mockToArray.mockResolvedValue([]);
  mockGetAssetBlob.mockClear();
  mockTransferAsset.mockClear();
  mockLastOwned.mockReset();
  mockLastOwned.mockReturnValue(null);
});

// Import after mocks
import { useAssetRehydration, diffMissingAssetIds } from './useAssetRehydration';

function ownedEvent(ids: string[]): void {
  window.dispatchEvent(new CustomEvent('sq:assets-owned', { detail: { ids } }));
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('useAssetRehydration (task-120 diff-based)', () => {
  it('transfers only the assets the iframe does NOT hold', async () => {
    const blobA = new Blob([new Uint8Array([1])], { type: 'image/png' });
    const blobB = new Blob([new Uint8Array([2, 3])], { type: 'image/jpeg' });
    mockToArray.mockResolvedValue([
      { id: 'asset-a', projectId: 'proj-1', blob: blobA, mimeType: 'image/png' },
      { id: 'asset-b', projectId: 'proj-1', blob: blobB, mimeType: 'image/jpeg' },
      { id: 'cover_proj-1', projectId: 'proj-1', blob: blobA, mimeType: 'image/jpeg' },
    ]);

    renderHook(() => useAssetRehydration('proj-1'));
    ownedEvent(['asset-a']); // iframe already holds asset-a

    await waitFor(() => {
      expect(mockTransferAsset).toHaveBeenCalledTimes(1);
    });
    expect(mockWhere).toHaveBeenCalledWith('projectId');
    expect(mockEquals).toHaveBeenCalledWith('proj-1');
    expect(mockTransferAsset).toHaveBeenCalledWith('asset-b', blobB); // cover_ never transfers
  });

  it('fresh boot (empty owned list) transfers everything except covers', async () => {
    const blob = new Blob([new Uint8Array([9])], { type: 'image/png' });
    mockToArray.mockResolvedValue([
      { id: 'asset-x', projectId: 'proj-1', blob, mimeType: 'image/png' },
    ]);

    renderHook(() => useAssetRehydration('proj-1'));
    ownedEvent([]);

    await waitFor(() => {
      expect(mockTransferAsset).toHaveBeenCalledTimes(1);
    });
    expect(mockTransferAsset).toHaveBeenCalledWith('asset-x', blob);
  });

  it('catches up from getLastAssetsOwned when the report fired before mount', async () => {
    const blob = new Blob([new Uint8Array([5])], { type: 'image/png' });
    mockToArray.mockResolvedValue([
      { id: 'asset-late', projectId: 'proj-1', blob, mimeType: 'image/png' },
    ]);
    mockLastOwned.mockReturnValue([]); // bridge reported "holds nothing" earlier

    renderHook(() => useAssetRehydration('proj-1'));

    await waitFor(() => {
      expect(mockTransferAsset).toHaveBeenCalledTimes(1);
    });
    expect(mockTransferAsset).toHaveBeenCalledWith('asset-late', blob);
  });

  it('is a no-op when projectId is null (project not yet hydrated)', async () => {
    renderHook(() => useAssetRehydration(null));

    await Promise.resolve();
    await Promise.resolve();

    expect(mockWhere).not.toHaveBeenCalled();
    ownedEvent([]);
    await Promise.resolve();
    expect(mockTransferAsset).not.toHaveBeenCalled();
  });

  it('removes the sq:assets-owned listener on unmount (no leaked transfers)', async () => {
    mockLastOwned.mockReturnValue([]);
    const { unmount } = renderHook(() => useAssetRehydration('proj-1'));

    await waitFor(() => {
      expect(mockWhere).toHaveBeenCalledTimes(1); // mount catch-up read
    });

    unmount();

    ownedEvent([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it('survives an IndexedDB read failure without throwing or breaking later runs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockToArray.mockRejectedValueOnce(new Error('IDB closed'));
    renderHook(() => useAssetRehydration('proj-1'));
    ownedEvent([]);

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(mockTransferAsset).not.toHaveBeenCalled();

    // A later report (DB recovered) still rehydrates.
    const blob = new Blob([new Uint8Array([7])], { type: 'image/png' });
    mockToArray.mockResolvedValueOnce([
      { id: 'asset-recovered', projectId: 'proj-1', blob, mimeType: 'image/png' },
    ]);
    ownedEvent([]);
    await waitFor(() => {
      expect(mockTransferAsset).toHaveBeenCalledTimes(1);
    });
    expect(mockTransferAsset).toHaveBeenCalledWith('asset-recovered', blob);

    warnSpy.mockRestore();
  });

  it('diffMissingAssetIds: missing minus covers', () => {
    expect(diffMissingAssetIds(['a'], ['a', 'b', 'cover_x'])).toEqual(['b']);
  });
});
