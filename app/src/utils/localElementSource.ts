// Source tab reads/writes for the local (files-truth) runtime: the element's
// bytes come from the PROJECT (`/__sq/local/file`), never the host repo, and a
// save is ONE durable file-batch (rewriteLocalFile → instance → Dexie + HMR).
// ponytail: no structural-undo record for a Source-tab save (none existed).
import { localFetch } from './sqLocalBase';
import { getElementSource, updateElementSource } from '@/vite-plugin/ast-updater';
import type { SourceLocation } from '@/core/state/types';

/** Any project file (src/**) through the instance — the Source tab + field binding read path. */
export async function readLocalFile(file: string): Promise<string> {
  const r = await localFetch(`/__sq/local/file?file=${encodeURIComponent(file)}`);
  if (!r.ok) throw new Error(`Could not read ${file} (${r.status})`);
  // Keep a leading U+FEFF (Response.text() drops it; disk and the CAS keep it).
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
}

export async function readLocalElementSource(loc: SourceLocation): Promise<{ source: string; startLine: number; endLine: number }> {
  const content = await readLocalFile(loc.file);
  return getElementSource(content, loc);
}

/** A snapshot hook-in for ⌘Z (UndoContext claimSnapshot shape, file inverses only). */
export interface FileWriteSnapshot { commit(): void; attachFiles?(files: unknown[]): void }

/**
 * THE whole-file write of a project file: with an open project, ONE durable file-batch
 * (acceptFileChanges) whose before-bytes are the projected source, so the
 * projection always knows what is on disk — a raw write-file left it stale and
 * the next class/structure edit on the file was refused until a restart
 * (2026-10-05, fs-traced). `compute` derives the new bytes from the current
 * ones (null = the file does not exist) inside the gesture; throw to refuse.
 * Resolves only once the bytes are on disk.
 */
export async function rewriteLocalFile(file: string, compute: (before: string | null) => string, snapshot?: FileWriteSnapshot): Promise<{ created: boolean; changed: boolean }> {
  const { getActiveSaveProjectId } = await import('@/services/pendingProjectMutations');
  const projectId = getActiveSaveProjectId();
  // No open project (scaffold/import before the editor arms) or a file the
  // journal does not admit (outside src/): the instance's plain journaled route.
  if (!projectId || !file.startsWith('src/')) return rawWriteLocalFile(file, compute(await readLocalFile(file).catch(() => null)));
  const [{ acceptFileChanges, finishAcceptedFiles }, { readProjectedSourceState }] = await Promise.all([
    import('@/services/durableEdits/fileAcceptance'), import('@/services/durableEdits/projectedSource')]);
  let created = false, changed = false;
  const accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
    const before = await readProjectedSourceState(projectId, file);
    const after = compute(before);
    created = before === null; changed = after !== before;
    return changed ? [{ file, beforeSource: before, afterSource: after }] : [];
  }, undefined, undefined, snapshot && { stage: () => {}, commit: () => snapshot.commit(), attachFiles: (f) => snapshot.attachFiles?.(f) });
  if (changed) {
    const done = await finishAcceptedFiles(accepted);
    if (done.status !== 'materialized') throw new Error(`Could not write ${file}: ${done.error instanceof Error ? done.error.message : 'not written yet'}`);
  }
  return { created, changed };
}

/**
 * rewriteLocalFile for SEVERAL files as ONE gesture (one durable batch, one ⌘Z):
 * `compute` gets every file's current bytes (null = missing) and returns the
 * new bytes of the files that change. Throw to refuse.
 */
/** `null` in the result deletes that file (same batch, same ⌘Z). */
/** A rewriteLocalFiles `before` without the files that do not exist. */
export function presentFiles(before: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(before).filter((e): e is [string, string] => e[1] !== null));
}

export async function rewriteLocalFiles(files: string[], compute: (before: Record<string, string | null>) => Record<string, string | null>, snapshot?: FileWriteSnapshot): Promise<string[]> {
  const { getActiveSaveProjectId } = await import('@/services/pendingProjectMutations');
  const projectId = getActiveSaveProjectId();
  if (!projectId) {
    const before = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await readLocalFile(f).catch(() => null)] as const)));
    const after = compute(before);
    for (const [f, c] of Object.entries(after)) if (c !== null) await rawWriteLocalFile(f, c);
    return Object.keys(after);
  }
  const [{ acceptFileChanges, finishAcceptedFiles }, { readProjectedSourceState }] = await Promise.all([
    import('@/services/durableEdits/fileAcceptance'), import('@/services/durableEdits/projectedSource')]);
  let changed: string[] = [];
  const accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
    const before = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await readProjectedSourceState(projectId, f)] as const)));
    const after = compute(before);
    const edits = Object.entries(after).filter(([f, c]) => c !== before[f]).map(([file, afterSource]) => ({ file, beforeSource: before[file] ?? null, afterSource }));
    changed = edits.map((e) => e.file);
    return edits;
  }, undefined, undefined, snapshot && { stage: () => {}, commit: () => snapshot.commit(), attachFiles: (f) => snapshot.attachFiles?.(f) });
  if (changed.length) {
    const done = await finishAcceptedFiles(accepted);
    if (done.status !== 'materialized') throw new Error(`Could not write ${changed.join(', ')}: ${done.error instanceof Error ? done.error.message : 'not written yet'}`);
  }
  return changed;
}

async function rawWriteLocalFile(file: string, content: string): Promise<{ created: boolean; changed: boolean }> {
  const r = await localFetch('/__sq/local/write-file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, content }),
  });
  if (!r.ok) throw new Error(`Could not write ${file} (${r.status})`);
  return { created: false, changed: true };
}

/** Whole-file write of a project file (journaled — see rewriteLocalFile). */
export async function writeLocalFile(file: string, content: string): Promise<void> {
  await rewriteLocalFile(file, () => content);
}

export async function writeLocalElementSource(file: string, startLine: number, endLine: number, newSource: string): Promise<void> {
  await rewriteLocalFile(file, (before) => {
    if (before === null) throw new Error(`Could not write ${file}: it does not exist`);
    return updateElementSource(before, startLine, endLine, newSource);
  });
}
