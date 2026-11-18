// app/src/sync/SyncStateManager.ts
import { create } from 'zustand';

export interface SyncState {
  pageId: string;
  localHash: string;
  remoteHash: string;
  hasLocalChanges: boolean;
  status: 'clean' | 'dirty' | 'conflict';
}

export interface ConflictInfo {
  pageId: string;
  localContent: string;
  remoteContent: string;
  localHash: string;
  remoteHash: string;
  detectedAt: number;
}

interface SyncStateStore {
  pageStates: Map<string, SyncState>;
  conflicts: Map<string, ConflictInfo>;

  markDirty: (pageId: string) => void;
  markClean: (pageId: string, hash: string) => void;
  updateRemoteHash: (pageId: string, newHash: string) => void;
  addConflict: (conflict: ConflictInfo) => void;
  resolveConflict: (pageId: string) => void;
  hasConflict: (pageId: string) => boolean;
  getDirtyPages: () => string[];
}

export const useSyncState = create<SyncStateStore>((set, get) => ({
  pageStates: new Map(),
  conflicts: new Map(),

  markDirty: (pageId) => {
    set((state) => {
      const current = state.pageStates.get(pageId);
      if (!current) return state;

      const newMap = new Map(state.pageStates);
      newMap.set(pageId, {
        ...current,
        hasLocalChanges: true,
        status: 'dirty',
      });
      return { pageStates: newMap };
    });
  },

  markClean: (pageId, hash) => {
    set((state) => {
      const newMap = new Map(state.pageStates);
      newMap.set(pageId, {
        pageId,
        localHash: hash,
        remoteHash: hash,
        hasLocalChanges: false,
        status: 'clean',
      });
      return { pageStates: newMap };
    });
  },

  updateRemoteHash: (pageId, newHash) => {
    set((state) => {
      const current = state.pageStates.get(pageId);
      if (!current) return state;

      const newMap = new Map(state.pageStates);
      const hasConflict = current.localHash !== newHash && current.hasLocalChanges;
      newMap.set(pageId, {
        ...current,
        remoteHash: newHash,
        status: hasConflict ? 'conflict' : current.status,
      });
      return { pageStates: newMap };
    });
  },

  addConflict: (conflict) => set((state) => {
    const newConflicts = new Map(state.conflicts);
    newConflicts.set(conflict.pageId, conflict);
    return { conflicts: newConflicts };
  }),

  resolveConflict: (pageId) => set((state) => {
    const newConflicts = new Map(state.conflicts);
    newConflicts.delete(pageId);
    return { conflicts: newConflicts };
  }),

  hasConflict: (pageId) => get().conflicts.has(pageId),

  getDirtyPages: () => {
    const dirtyPages: string[] = [];
    get().pageStates.forEach((state, pageId) => {
      if (state.status === 'dirty') {
        dirtyPages.push(pageId);
      }
    });
    return dirtyPages;
  },
}));
