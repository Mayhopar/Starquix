/**
 * Files-truth project files (2026-08-28 unification, Phase 2 Task 2.1).
 *
 * A files-truth project IS these rows: an Astro project folder persisted in
 * IndexedDB and mirrored to the project's disk folder as-is. `readProjectFiles`
 * returns the files as the desktop driver writes them (text decoded, binaries
 * as bytes).
 *
 * Row id = "{projectId}:{path}" (same convention as themeFiles).
 */
import { db } from './index';
import type { DBProjectFile } from './types';

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx',
  '.json', '.html', '.css', '.scss', '.less', '.md', '.mdx',
  '.astro', '.svelte', '.vue', '.yaml', '.yml', '.toml',
  '.txt', '.xml', '.svg', '.sh', '.env', '.gitignore', '.gitkeep',
  '.prettierrc', '.eslintrc', '.browserslistrc',
]);

/** Same rule as services/snapshotLoader.isTextFile — ONE notion of "text". */
export function isTextPath(path: string): boolean {
  const fileName = path.split('/').pop() || path;
  const ext = '.' + fileName.split('.').pop()?.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || !fileName.includes('.') || fileName.endsWith('rc');
}

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

export const projectFileId = (projectId: string, path: string): string =>
  `${projectId}:${normalizeProjectPath(path)}`;

export interface ProjectFileEntry { path: string; content: Uint8Array; updatedAt?: number }

/** Local writes stamp updatedAt + pendingSync; a sync PULL passes
 *  `fromSync` so the row carries the remote stamp and is not re-pushed. */
export async function putProjectFiles(projectId: string, entries: ProjectFileEntry[], opts: { fromSync?: boolean } = {}): Promise<void> {
  const now = Date.now();
  const rows: DBProjectFile[] = entries.map((e) => {
    const path = normalizeProjectPath(e.path);
    const row: DBProjectFile = { id: projectFileId(projectId, path), projectId, path, content: e.content, isText: isTextPath(path), updatedAt: e.updatedAt ?? now };
    if (!opts.fromSync) row.pendingSync = 1;
    return row;
  });
  await db.projectFiles.bulkPut(rows);
}

export async function writeProjectFile(projectId: string, path: string, content: Uint8Array): Promise<void> {
  await putProjectFiles(projectId, [{ path, content }]);
}

export async function deleteProjectFile(projectId: string, path: string): Promise<void> {
  await db.projectFiles.delete(projectFileId(projectId, path));
}

export async function deleteAllProjectFiles(projectId: string): Promise<void> {
  await db.projectFiles.where('projectId').equals(projectId).delete();
}

export async function listProjectFilePaths(projectId: string): Promise<string[]> {
  // Primary keys only ("{projectId}:{path}"): never loads the file bytes of a 150 MB mirror just to list paths.
  const prefix = projectFileId(projectId, '');
  return (await db.projectFiles.where('projectId').equals(projectId).primaryKeys()).map(id => String(id).slice(prefix.length)).sort();
}

/** The project's files as the desktop driver writes them (its first-open seed),
 *  losslessly: valid UTF-8 text decoded with its BOM, everything else — binaries,
 *  an extensionless or *rc binary isTextPath calls "text" — as its exact bytes. */
export async function readProjectFiles(projectId: string): Promise<Record<string, string | Uint8Array>> {
  const rows = await db.projectFiles.where('projectId').equals(projectId).toArray();
  const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const out: Record<string, string | Uint8Array> = {};
  for (const r of rows) {
    out[r.path] = r.content;
    if (r.isText) try { out[r.path] = dec.decode(r.content); } catch { /* not UTF-8: keep the bytes */ }
  }
  return out;
}
