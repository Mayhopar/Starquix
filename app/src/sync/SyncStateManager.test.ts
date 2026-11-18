// app/src/sync/SyncStateManager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useSyncState, type ConflictInfo } from './SyncStateManager';

describe('SyncStateManager', () => {
  beforeEach(() => {
    useSyncState.setState({
      pageStates: new Map(),
      conflicts: new Map(),
    });
  });

  describe('markClean', () => {
    it('should set page state to clean with hash', () => {
      useSyncState.getState().markClean('page-1', 'abc123');

      const state = useSyncState.getState().pageStates.get('page-1');
      expect(state?.status).toBe('clean');
      expect(state?.localHash).toBe('abc123');
      expect(state?.remoteHash).toBe('abc123');
      expect(state?.hasLocalChanges).toBe(false);
    });
  });

  describe('markDirty', () => {
    it('should set page state to dirty', () => {
      useSyncState.getState().markClean('page-1', 'abc123');
      useSyncState.getState().markDirty('page-1');

      const state = useSyncState.getState().pageStates.get('page-1');
      expect(state?.status).toBe('dirty');
      expect(state?.hasLocalChanges).toBe(true);
    });

    it('should do nothing if page not tracked', () => {
      useSyncState.getState().markDirty('unknown-page');
      expect(useSyncState.getState().pageStates.has('unknown-page')).toBe(false);
    });
  });

  describe('conflicts', () => {
    it('should add conflict', () => {
      const conflict: ConflictInfo = {
        pageId: 'page-1',
        localContent: '<div>local</div>',
        remoteContent: '<div>remote</div>',
        localHash: 'abc',
        remoteHash: 'def',
        detectedAt: Date.now(),
      };

      useSyncState.getState().addConflict(conflict);

      expect(useSyncState.getState().conflicts.has('page-1')).toBe(true);
      expect(useSyncState.getState().conflicts.get('page-1')).toEqual(conflict);
    });

    it('should resolve conflict', () => {
      const conflict: ConflictInfo = {
        pageId: 'page-1',
        localContent: '',
        remoteContent: '',
        localHash: 'a',
        remoteHash: 'b',
        detectedAt: Date.now(),
      };

      useSyncState.getState().addConflict(conflict);
      expect(useSyncState.getState().conflicts.has('page-1')).toBe(true);

      useSyncState.getState().resolveConflict('page-1');
      expect(useSyncState.getState().conflicts.has('page-1')).toBe(false);
    });
  });

  describe('hasConflict', () => {
    it('should return true when conflict exists', () => {
      useSyncState.getState().addConflict({
        pageId: 'page-1',
        localContent: '',
        remoteContent: '',
        localHash: 'a',
        remoteHash: 'b',
        detectedAt: Date.now(),
      });

      expect(useSyncState.getState().hasConflict('page-1')).toBe(true);
      expect(useSyncState.getState().hasConflict('page-2')).toBe(false);
    });

    it('should return false after conflict is resolved', () => {
      useSyncState.getState().addConflict({
        pageId: 'page-1',
        localContent: '',
        remoteContent: '',
        localHash: 'a',
        remoteHash: 'b',
        detectedAt: Date.now(),
      });

      expect(useSyncState.getState().hasConflict('page-1')).toBe(true);
      useSyncState.getState().resolveConflict('page-1');
      expect(useSyncState.getState().hasConflict('page-1')).toBe(false);
    });
  });

  describe('updateRemoteHash', () => {
    it('should update remote hash without conflict when no local changes', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');
      useSyncState.getState().updateRemoteHash('page-1', 'hash-2');

      const state = useSyncState.getState().pageStates.get('page-1');
      expect(state?.remoteHash).toBe('hash-2');
      expect(state?.status).toBe('clean');
    });

    it('should detect conflict when remote differs and has local changes', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');
      useSyncState.getState().markDirty('page-1');
      useSyncState.getState().updateRemoteHash('page-1', 'hash-2');

      const state = useSyncState.getState().pageStates.get('page-1');
      expect(state?.remoteHash).toBe('hash-2');
      expect(state?.status).toBe('conflict');
    });

    it('should not change status when remote hash matches local hash', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');
      useSyncState.getState().markDirty('page-1');
      useSyncState.getState().updateRemoteHash('page-1', 'hash-1');

      const state = useSyncState.getState().pageStates.get('page-1');
      expect(state?.status).toBe('dirty');
    });

    it('should do nothing if page not tracked', () => {
      useSyncState.getState().updateRemoteHash('unknown-page', 'hash-1');
      expect(useSyncState.getState().pageStates.has('unknown-page')).toBe(false);
    });
  });

  describe('getDirtyPages', () => {
    it('should return empty array when no dirty pages', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');
      useSyncState.getState().markClean('page-2', 'hash-2');

      expect(useSyncState.getState().getDirtyPages()).toEqual([]);
    });

    it('should return array of dirty page IDs', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');
      useSyncState.getState().markClean('page-2', 'hash-2');
      useSyncState.getState().markClean('page-3', 'hash-3');

      useSyncState.getState().markDirty('page-1');
      useSyncState.getState().markDirty('page-3');

      const dirtyPages = useSyncState.getState().getDirtyPages();
      expect(dirtyPages).toHaveLength(2);
      expect(dirtyPages).toContain('page-1');
      expect(dirtyPages).toContain('page-3');
    });
  });

  describe('markDirty concurrent safety', () => {
    it('should not crash with rapid concurrent markDirty calls', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');

      // Simulate rapid concurrent calls
      for (let i = 0; i < 100; i++) {
        useSyncState.getState().markDirty('page-1');
      }

      const state = useSyncState.getState().pageStates.get('page-1');
      expect(state?.status).toBe('dirty');
      expect(state?.hasLocalChanges).toBe(true);
    });

    it('should handle markDirty when page is deleted mid-operation', () => {
      useSyncState.getState().markClean('page-1', 'hash-1');

      // This should not crash even if page doesn't exist
      useSyncState.setState({ pageStates: new Map() });
      useSyncState.getState().markDirty('page-1');

      expect(useSyncState.getState().pageStates.has('page-1')).toBe(false);
    });
  });
});
