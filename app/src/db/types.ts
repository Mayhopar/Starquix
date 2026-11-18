export interface DBProject {
  id: string;
  name: string;
  pagesTree: Array<{ id: string; children: Array<any> }>;
  /** Local (files-truth) root page order, as routes — src/pages has none. */
  pageOrder?: string[];
  /** Unified-component master overlay, keyed by astroSource (Yjs `masters` map). */
  masters?: Record<string, { markup: string }>;
  /** Doc-side content collections to seed on first open (project-import writes
   *  these; the doc is authoritative once durable). */
  contentCollections?: import('@/core/collections/types').ContentCollection[];
  /** Files-truth project (2026-08-28 unification): the project IS the
   *  `projectFiles` rows — an Astro folder run by the desktop app with the
   *  local-mode wrapper. No doc persistence; the Y.Doc is a session copy. */
  filesTruth?: true;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBPage {
  id: string;
  projectId: string;
  name: string;
  components: Array<any>;
  metadata: { fonts: string[] };
  layoutName?: string | null;
  layoutProps?: Record<string, string>;
  seo?: Record<string, unknown>;
  isHome?: boolean;
}

export interface DBElement {
  id: string;
  projectId: string;
  pageId: string;
  [key: string]: any;
}

export interface DBAsset {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  blob: Blob | ArrayBuffer;
  createdAt: Date;
  /** Set when a byte push to the sync server failed (offline / server down);
   *  flushPendingAssets re-uploads and clears it on the next sync connection. */
  pendingSync?: 1;
}

export interface DBSnapshot {
  id: string;
  files: Record<string, Uint8Array>;
  version: string;
}

export interface DBTheme {
  id: string;
  name: string;
  slug: string;
  componentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DBThemeComponent {
  /** Composite key: "${themeId}:${name}" */
  id: string;
  themeId: string;
  name: string;
  path: string;
  html: string;
  source: string;
  dependencies: string[];
}

export interface DBThemeFile {
  /** Composite key: "${themeId}:${path}" */
  id: string;
  themeId: string;
  path: string;
  content: Uint8Array;
  isText: boolean;
}

/** One file of a files-truth project. Composite key "${projectId}:${path}";
 *  same shape as DBThemeFile so the mount/zip paths share code. */
export interface DBProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: Uint8Array;
  isText: boolean;
  /** Last local write (ms). Sync = last-writer-wins on this (Phase 3.5). */
  updatedAt?: number;
  /** Written locally, not yet acked by the sync server. */
  pendingSync?: 1;
}

export interface DBProjectTheme {
  /** Composite key: "${projectId}:${themeId}" */
  id: string;
  projectId: string;
  themeId: string;
  enabled: boolean;
}

/** Legacy Database-tab row (feature moved to the paid backend). Kept so the
 *  Dexie `dbRows` table — and any rows already in a user's IndexedDB — stay declared. */
export type StoredDbRow = { projectId: string; tableId: string; id: string } & Record<string, unknown>;

/** Ordered browser-local edit journal row and its project cursor. */
export type DBDurableEdit = import('@/services/durableEdits/types').StoredDurableEdit;
export type DBDurableProjectState = import('@/services/durableEdits/types').DurableProjectState;
export type DBDurableCommandReceipt = import('@/services/durableEdits/types').StoredSourceCommand;

/** Minimal permanent evidence that an operation ID already received a revision. */
export interface DBDurableEditCheckpoint {
  id: string;
  projectId: string;
  operationId: string;
  revision: number;
}
