/**
 * Projects page ⌘Z (owner 2026-11-10: "Good ux is when you can delete anything AND UNDO!"). The page has no editor doc
 * and no UndoContext, so a project's rows are captured BEFORE its delete and kept for the app session: ⌘Z puts them
 * back, ⇧⌘Z deletes again. docs/plans/2026-11-10-delete-then-undo-ledger.md, cases 11–19.
 */
import { db } from '@/db';
import { isLocalProjectId, markFilesTruth } from '@/utils/localMode';
import { deleteFilesTruthData } from '@/services/projectImport/createFilesTruthProject';

/** A project's rows can be MBs (binary files): deletions older than this become permanent. */
const MAX_DELETIONS = 10;

export type DeletedProject = Awaited<ReturnType<typeof captureProject>>;

/** Every row deleteProject removes, read before anything is removed. `filesTruth` is the local marker the delete
 *  clears (unmarkFilesTruth) — the exact inverse restores it as it was. */
export async function captureProject(id: string) {
  const [project, files, pages, elements, assets] = await Promise.all([
    db.projects.get(id),
    db.projectFiles.where('projectId').equals(id).toArray(),
    db.pages.where('projectId').equals(id).toArray(),
    db.elements.where('projectId').equals(id).toArray(),
    db.assets.where('projectId').equals(id).toArray(),
  ]);
  if (!project) throw new Error('The project could not be read.');
  return { project, files, pages, elements, assets, filesTruth: isLocalProjectId(id) };
}

/** The delete, step by step: one that stops half-way leaves the rest in place (the page shows it) and its captured
 *  rows make it one ⌘Z from whole. The same five tables captureProject reads and restoreProject puts back. */
export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
  await deleteFilesTruthData(id);
  await db.pages.where('projectId').equals(id).delete();
  await db.elements.where('projectId').equals(id).delete();
  await db.assets.where('projectId').equals(id).delete();
}

/** Puts every captured row back — idempotent, so it also completes a delete that stopped half-way. */
export async function restoreProject(deleted: DeletedProject): Promise<void> {
  await db.transaction('rw', [db.projects, db.projectFiles, db.pages, db.elements, db.assets], async () => {
    await db.projects.put(deleted.project);
    await db.projectFiles.bulkPut(deleted.files);
    await db.pages.bulkPut(deleted.pages);
    await db.elements.bulkPut(deleted.elements);
    await db.assets.bulkPut(deleted.assets);
  });
  if (deleted.filesTruth) markFilesTruth(deleted.project.id);
}

// Module scope: the stacks outlive leaving the page for the editor and coming back; an app restart clears them.
const done: DeletedProject[] = [];
const undone: DeletedProject[] = [];

export const projectUndo = {
  /** A delete ran (whole or half-way). A fresh one forgets what ⇧⌘Z could re-delete; a redo keeps the rest. */
  deleted(entry: DeletedProject, redo = false): void {
    done.push(entry);
    if (done.length > MAX_DELETIONS) done.shift();
    if (!redo) undone.length = 0;
  },
  nextUndo: (): DeletedProject | undefined => done[done.length - 1],
  nextRedo: (): DeletedProject | undefined => undone[undone.length - 1],
  restored(entry: DeletedProject): void { done.splice(done.lastIndexOf(entry), 1); undone.push(entry); },
  redoing(entry: DeletedProject): void { undone.splice(undone.lastIndexOf(entry), 1); },
};

export function _resetProjectUndoForTests(): void { done.length = 0; undone.length = 0; }
