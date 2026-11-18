import type { SourceLocation } from '@/bridge';
import type { FolderManifest } from '@/store/folderManifest';
import type { StructuralOp } from '@/store/structuralUndo';
import type { LocalWriteOrigin } from '@/utils/localWriteScope';
import type { SkippedEntry, SourceWritePayload } from '@/utils/pushOverridesToSource';

export interface SourceWriteBatch {
  payloads: SourceWritePayload[];
  skipped: SkippedEntry[];
  /** Source-coordinate text/markup intents retain their scan ownership. */
  sourceTextEdits?: Array<{ sourceLocation: SourceLocation; text: string; origin: LocalWriteOrigin; masterWrite?: boolean }>;
  /** Ordered source transforms frozen inside the accepted document gesture. */
  preparedFiles?: DurableFileChange[];
  preparedSkipped?: SkippedEntry[];
  preparedAppliedTotal?: number;
  /** Scheduling only; accepted intent is already durable while source is deferred. */
  deferUntil?: number;
}

export interface DurableClassWrite {
  sourceLocation: SourceLocation;
  newClasses: string;
  baseClasses: string | null;
  origin: LocalWriteOrigin | null;
  deferUntil?: number;
  sourceRevision?: number;
  /** Exact accepted projection and coordinate correspondence, when captured. */
  preparedFiles?: DurableFileChange[];
}

export interface DurableLayoutAppend {
  pageFile: string;
  markup: string;
  importName?: string;
  importPath?: string;
  origin?: LocalWriteOrigin;
  deferUntil?: number;
  preparedFiles?: DurableFileChange[];
}

export interface DurableVariablesWrite {
  projectPath: string;
  file: string;
  css: string;
  imports: Array<{ file: string; name: string; importPath: string }>;
  preparedFiles: DurableFileChange[];
}

export type DurableValue = string | number | boolean | null | DurableValue[] | { [key: string]: DurableValue };

export interface DurablePostWrite {
  collection: string;
  slug: string;
  frontmatter: { [key: string]: DurableValue };
  body: string;
  expectedSource: string | null;
  preparedFiles: DurableFileChange[];
}

export interface DurableFolderManifest {
  localPath: string | null;
  manifest: FolderManifest;
  preparedFiles: DurableFileChange[];
}

export interface DurableImageBinding {
  sourceLocation: SourceLocation;
  attribute: 'src' | 'alt' | 'loading' | 'autoplay' | 'loop' | 'muted' | 'controls';
  value: string;
  masterWrite: boolean;
  origin: LocalWriteOrigin | null;
}

export interface DurableStructuralWrite {
  operations: StructuralOp[];
  origin?: LocalWriteOrigin;
  masterWrite?: boolean;
}

/** null is proven absence, never a failed read. */
export interface DurableFileChange {
  file: string;
  /** Binary bundled dependencies retain exact bytes through JSON transport. */
  encoding?: 'base64';
  beforeSource: string | null;
  afterSource: string | null;
  /** Operation-derived element correspondence, committed with these exact bytes. */
  identityMaps?: SourceIdentityMap[];
}

export interface SourceCoordinate { line: number; column: number }
export interface SourceIdentityMap {
  id: string;
  inverse?: boolean;
  beforeVersion: string;
  afterVersion: string;
  entries: Array<{ before: SourceCoordinate | null; after: SourceCoordinate | null }>;
}

/** Inverse intent refers to immutable preparations, not positional selectors
 * whose identities can change when same-tag siblings are reordered. */
export interface DurableReceiptReplay {
  commandIds: string[];
  direction: 'before' | 'after';
}

export interface DurableAssetWrite {
  assetId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  projectFilePath: string | null;
}

export type MaterializationCommand =
  | { kind: 'source-batch'; payload: SourceWriteBatch }
  | { kind: 'class-write'; payload: DurableClassWrite }
  | { kind: 'layout-append'; payload: DurableLayoutAppend }
  | { kind: 'variables-css'; payload: DurableVariablesWrite }
  | { kind: 'post-write'; payload: DurablePostWrite }
  | { kind: 'folder-manifest'; payload: DurableFolderManifest }
  | { kind: 'image-bind'; payload: DurableImageBinding }
  | { kind: 'structural-write'; payload: DurableStructuralWrite }
  | { kind: 'file-batch'; payload: { files: DurableFileChange[] } }
  | { kind: 'receipt-replay'; payload: DurableReceiptReplay }
  | { kind: 'asset-write'; payload: DurableAssetWrite };

export interface NewDurableEdit {
  operationId: string;
  projectId: string;
  yjsUpdate: Uint8Array | null;
  commands: MaterializationCommand[];
  acceptedAt: number;
}

export interface StoredDurableEdit extends NewDurableEdit {
  id: string;
  revision: number;
  materializedAt: number | null;
}

export interface DurableProjectState {
  projectId: string;
  acceptedRevision: number;
  materializedRevision: number;
}

export interface AcceptedEdit {
  operationId: string;
  revision: number;
}

export interface MaterializationReceipt {
  projectId: string;
  operationId: string;
  materializedAt: number;
}

/** One prepared file replacement, frozen before its first runtime dispatch. */
export interface PreparedSourceCommand {
  projectId: string;
  commandId: string;
  commandDigest: string;
  file: string;
  beforeSource: string;
  afterSource: string;
  beforeHash: string;
  afterHash: string;
  skipped: SkippedEntry[];
  /** Category-operation count from the pure transform; absent on older receipts. */
  appliedTotal?: number;
  structuralResults?: Array<Record<string, unknown>>;
  files?: Array<DurableFileChange & { beforeHash: string; afterHash: string }>;
}

export type SourceCommandOutcome =
  | { status: 'not-written' }
  | { status: 'written'; receipt: MaterializationReceipt }
  | { status: 'partial'; skipped: SkippedEntry[] }
  | { status: 'unknown'; error: string };

export interface StoredSourceCommand {
  projectId: string;
  commandId: string;
  prepared: PreparedSourceCommand;
  outcome: SourceCommandOutcome | null;
}
