// src/export/types.ts

export interface ExportFile {
  path: string;
  content: string;
}

/** Binary artifact entry (uploaded images, binary theme files, public/ assets). */
export interface BinaryExportFile {
  path: string;
  data: Uint8Array;
}

export interface ExportResult {
  files: ExportFile[];
  projectName: string;
  /** Relative asset paths found in markup (e.g. "/assets/logos/logo.svg") */
  assetPaths: string[];
  /** Theme IDs referenced by instance elements, for including theme files in export */
  referencedThemeIds?: string[];
  /** User-visible export notices (task-113 free-tier database upsell). */
  notices?: string[];
  /** Tables the export flow must flip public for repeater live-fetch (task-113). */
  repeaterPublicTables?: string[];
}
