export const MAX_FILE_COUNT = 2000;
export const MAX_TOTAL_SIZE = 500 * 1024 * 1024;

export type ImportValidationCode = 'invalid-path' | 'invalid-size' | 'too-large' | 'too-many-files'
  | 'duplicate-path' | 'missing-package' | 'unreadable-package' | 'not-astro';
/** Proven input refusals happen before persistence. Diagnostic text is never UI copy. */
export class ImportValidationError extends Error {
  constructor(readonly code: ImportValidationCode, diagnostic: string) {
    super(diagnostic);
    this.name = 'ImportValidationError';
  }
}

// .sq is Starquix's own runtime dir: the desktop seed refuses it (desktop/src/projects.mjs seedPathFor).
const SKIP_DIRS = new Set(['node_modules', '.git', '.sq', 'dist', '.astro', '.vercel', '.netlify', '.output']);

export interface ImportMetadata {
  path: string;
  size: number;
}

export interface PreparedImportMetadata<T extends ImportMetadata> {
  source: T;
  /** Normalized path as supplied by the picker/import adapter. */
  sourcePath: string;
  /** Normalized path that will be persisted inside the project. */
  path: string;
  size: number;
}

/** Build output, vendor and VCS dirs anywhere in the path; every other file, dot-files too, is the project's. */
export function isSkippedDir(path: string): boolean {
  return path.split('/').some((part) => SKIP_DIRS.has(part));
}

function normalizeSafePath(path: string): string {
  if (path.includes('\0')) throw new ImportValidationError('invalid-path', `NUL byte in import path: ${path}`);
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new ImportValidationError('invalid-path', `Absolute import path is not allowed: ${path}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0)) {
    throw new ImportValidationError('invalid-path', `Empty path component in import path: ${path}`);
  }
  if (parts.some((part) => part === '..')) {
    throw new ImportValidationError('invalid-path', `Path traversal detected: ${path}`);
  }
  if (parts.some((part) => part === '.')) {
    throw new ImportValidationError('invalid-path', `Relative path component is not allowed: ${path}`);
  }
  return normalized;
}

export function stripPickedFolderPaths(paths: string[]): string[] {
  const roots = new Set(paths.map((path) => path.split('/')[0]));
  const strip = roots.size === 1 && paths.every((path) => path.includes('/'));
  return paths.map((path) => strip ? path.slice(path.indexOf('/') + 1) : path);
}

function assertValidSize(size: number, path: string): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ImportValidationError('invalid-size', `Invalid file size for ${path}`);
  }
}

export function assertTotalSize(sizes: Iterable<number>): void {
  let total = 0;
  for (const size of sizes) {
    total += size;
    if (total > MAX_TOTAL_SIZE) {
      throw new ImportValidationError('too-large', `Folder exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit.`);
    }
  }
}

/**
 * Validates paths and metadata before bytes are read or persisted. The picked
 * folder prefix is retained as sourcePath and removed from the destination.
 */
export function prepareImportMetadata<T extends ImportMetadata>(
  rawEntries: T[],
): { entries: PreparedImportMetadata<T>[]; skipped: number } {
  const normalized = rawEntries.map((source) => {
    const sourcePath = normalizeSafePath(source.path);
    assertValidSize(source.size, sourcePath);
    return { source, sourcePath };
  });
  const destinationPaths = stripPickedFolderPaths(normalized.map((entry) => entry.sourcePath));
  const entries = normalized.map(({ source, sourcePath }, index) => ({
    source,
    sourcePath,
    path: destinationPaths[index],
    size: source.size,
  })).filter((entry) => !isSkippedDir(entry.path));

  if (entries.length > MAX_FILE_COUNT) {
    throw new ImportValidationError('too-many-files', `Too many files (${entries.length}). Maximum is ${MAX_FILE_COUNT}.`);
  }
  assertTotalSize(entries.map((entry) => entry.size));

  const destinations = new Set<string>();
  for (const entry of entries) {
    if (destinations.has(entry.path)) {
      throw new ImportValidationError('duplicate-path', `Duplicate import destination: ${entry.path}`);
    }
    destinations.add(entry.path);
  }

  return { entries, skipped: rawEntries.length - entries.length };
}
