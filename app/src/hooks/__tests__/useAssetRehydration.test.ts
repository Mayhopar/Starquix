/**
 * task-120 Phase 2 — diff-based rehydration: given the iframe's owned ids
 * and Dexie's ids, only the missing (non-cover) assets are transferred.
 */
import { describe, it, expect } from 'vitest';
import { diffMissingAssetIds } from '../useAssetRehydration';

describe('diffMissingAssetIds', () => {
  it('transfers only assets the iframe does not hold', () => {
    expect(diffMissingAssetIds(['a1'], ['a1', 'a2', 'a3'])).toEqual(['a2', 'a3']);
  });

  it('fresh boot (nothing owned) transfers everything', () => {
    expect(diffMissingAssetIds([], ['a1', 'a2'])).toEqual(['a1', 'a2']);
  });

  it('everything owned → nothing to send', () => {
    expect(diffMissingAssetIds(['a1', 'a2'], ['a1', 'a2'])).toEqual([]);
  });

  it('cover screenshots never transfer', () => {
    expect(diffMissingAssetIds([], ['cover_x', 'a1'])).toEqual(['a1']);
  });

  it('ids owned by the iframe but gone from Dexie are ignored (deletion is not a transfer)', () => {
    expect(diffMissingAssetIds(['ghost'], ['a1'])).toEqual(['a1']);
  });
});
