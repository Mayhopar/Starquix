import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  DBProject, DBPage, DBElement, DBAsset, DBSnapshot,
  DBTheme, DBThemeComponent, DBThemeFile, DBProjectTheme, DBProjectFile, StoredDbRow,
  DBDurableEdit, DBDurableProjectState, DBDurableEditCheckpoint, DBDurableCommandReceipt,
} from './types';

export const db = new Dexie('starquix') as Dexie & {
  projects: EntityTable<DBProject, 'id'>;
  pages: EntityTable<DBPage, 'id'>;
  elements: EntityTable<DBElement, 'id'>;
  assets: EntityTable<DBAsset, 'id'>;
  snapshots: EntityTable<DBSnapshot, 'id'>;
  themes: EntityTable<DBTheme, 'id'>;
  themeComponents: EntityTable<DBThemeComponent, 'id'>;
  themeFiles: EntityTable<DBThemeFile, 'id'>;
  projectThemes: EntityTable<DBProjectTheme, 'id'>;
  /** Files-truth project files (2026-08-28): id = "{projectId}:{path}". */
  projectFiles: EntityTable<DBProjectFile, 'id'>;
  /** Legacy Database-tab rows (feature moved to the paid backend); kept declared for existing IndexedDBs. */
  dbRows: Table<StoredDbRow, [string, string, string]>;
  /** Immutable accepted edits, ordered by a project-scoped revision. */
  durableEdits: EntityTable<DBDurableEdit, 'id'>;
  /** Accepted/materialized revision cursors for one project. */
  durableProjectState: EntityTable<DBDurableProjectState, 'projectId'>;
  /** Permanent operation-ID dedupe evidence retained after payload compaction. */
  durableEditCheckpoints: EntityTable<DBDurableEditCheckpoint, 'id'>;
  /** Immutable one-file preparations and independently durable writer outcomes. */
  durableCommandReceipts: Table<DBDurableCommandReceipt, [string, string]>;
};

db.version(1).stores({
  projects: 'id, updatedAt',
  pages: 'id, projectId',
  elements: 'id, projectId, pageId',
  assets: 'id, projectId',
  snapshots: 'id',
});

db.version(2).stores({
  projects: 'id, updatedAt',
  pages: 'id, projectId',
  elements: 'id, projectId, pageId',
  assets: 'id, projectId',
  snapshots: 'id',
  themes: 'id, slug',
  themeComponents: 'id, themeId',
  themeFiles: 'id, themeId',
  projectThemes: 'id, projectId, themeId',
});

db.version(3).stores({
  projects: 'id, updatedAt',
  pages: 'id, projectId',
  elements: 'id, projectId, pageId',
  assets: 'id, projectId',
  snapshots: 'id',
  themes: 'id, slug',
  themeComponents: 'id, themeId',
  themeFiles: 'id, themeId',
  projectThemes: 'id, projectId, themeId',
  dbRows: '[projectId+tableId+id], [projectId+tableId]',
});

db.version(4).stores({
  projects: 'id, updatedAt',
  pages: 'id, projectId',
  elements: 'id, projectId, pageId',
  assets: 'id, projectId',
  snapshots: 'id',
  themes: 'id, slug',
  themeComponents: 'id, themeId',
  themeFiles: 'id, themeId',
  projectThemes: 'id, projectId, themeId',
  dbRows: '[projectId+tableId+id], [projectId+tableId]',
  projectFiles: 'id, projectId',
});

db.version(5).stores({
  projects: 'id, updatedAt',
  pages: 'id, projectId',
  elements: 'id, projectId, pageId',
  assets: 'id, projectId',
  snapshots: 'id',
  themes: 'id, slug',
  themeComponents: 'id, themeId',
  themeFiles: 'id, themeId',
  projectThemes: 'id, projectId, themeId',
  dbRows: '[projectId+tableId+id], [projectId+tableId]',
  projectFiles: 'id, projectId',
  durableEdits: 'id, [projectId+revision], projectId, operationId, materializedAt',
  durableProjectState: 'projectId',
});

db.version(6).stores({
  projects: 'id, updatedAt',
  pages: 'id, projectId',
  elements: 'id, projectId, pageId',
  assets: 'id, projectId',
  snapshots: 'id',
  themes: 'id, slug',
  themeComponents: 'id, themeId',
  themeFiles: 'id, themeId',
  projectThemes: 'id, projectId, themeId',
  dbRows: '[projectId+tableId+id], [projectId+tableId]',
  projectFiles: 'id, projectId',
  durableEdits: 'id, [projectId+revision], projectId, operationId, materializedAt',
  durableProjectState: 'projectId',
  durableEditCheckpoints: 'id, projectId, [projectId+revision]',
});

db.version(7).stores({
  durableCommandReceipts: '[projectId+commandId], projectId',
});

/** Normalize asset blob field (ArrayBuffer or Blob) to a Blob. */
export function getAssetBlob(asset: DBAsset): Blob {
  if (asset.blob instanceof ArrayBuffer) {
    return new Blob([asset.blob], { type: asset.mimeType });
  }
  return asset.blob;
}

/** Rename a project. Trims the name; rejects empty. Bumps updatedAt
 *  so the projects grid (sorted by updatedAt desc) re-sorts. */
export async function renameProject(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Project name cannot be empty');
  await db.projects.update(id, { name: trimmed, updatedAt: new Date() });
}

export type {
  DBProject, DBPage, DBElement, DBAsset, DBSnapshot,
  DBTheme, DBThemeComponent, DBThemeFile, DBProjectTheme, DBProjectFile,
  DBDurableEdit, DBDurableProjectState, DBDurableEditCheckpoint,
};
