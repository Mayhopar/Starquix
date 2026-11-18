/**
 * One reusable list (task-244): the project-open pass. Simple imported list
 * components become BlogSlots (utils/listToBlogSlot) in ONE journaled batch
 * with an undo snapshot — ⌘Z restores every file byte-exact (L27). No toast
 * (owner: no banners); a failure writes nothing and only warns. Runs once per
 * open, after the project's pages + components are read (Editor
 * CardTitleLockSync) — the import path runs the same converter in
 * normalizeImportedEntries.
 */
import { loadSnapshot } from './snapshotLoader';
import { convertListsToBlogSlots } from '@/utils/listToBlogSlot';
import { planMissingCards, type CardAssignment } from '@/utils/cardAssignment';
import { resolveImportPath } from '@/utils/blogBinding';
import { collectImportSpecifiers } from '../../../preview-template/src/plugins/sq-prop-fallback.js';
import { presentFiles, rewriteLocalFiles, type FileWriteSnapshot } from '@/utils/localElementSource';
import { acquireStructuralWrite, releaseStructuralWrite } from '@/store/structuralWriteGuard';

/** A shipped library component's source (`BlogSlot` → src/components/library/BlogSlot.astro), or undefined. */
export async function librarySource(name: string): Promise<string | undefined> {
  const raw = await loadSnapshot().then((s) => s[`src/components/library/${name}.astro`]).catch(() => undefined);
  return typeof raw === 'string' && raw ? raw : undefined;
}

/** Every component a page imports from src/components is in `files` (the reader caught up) — or gone from disk (`exists` false). */
export function sourcesComplete(files: Readonly<Record<string, string>>, exists: (file: string) => boolean = () => true): boolean {
  const pages = Object.keys(files).filter((f) => f.startsWith('src/pages/'));
  return pages.length > 0 && pages.every((page) => {
    return [...collectImportSpecifiers(files[page]).values()].filter((spec: string) => /^\.\.?\/.*\.astro$/.test(spec))
      .map((spec: string) => resolveImportPath(page, spec))
      .every((f) => !f.startsWith('src/components/') || f in files || !exists(f));
  });
}

/**
 * Convert and write. True = the pass ran (or had nothing to do); false = try
 * again later (a structural write was in flight).
 */
export async function convertListsOnOpen({ files, blogSlotLibrary, exists, assignments, fieldsOf, takeSnapshot, claimSnapshot }: {
  files: Readonly<Record<string, string>>; blogSlotLibrary: string;
  /** The project's component files on disk: a Blog slot whose card file is gone switches cards (planMissingCards). */
  exists: (file: string) => boolean; assignments: ReadonlyMap<string, CardAssignment>; fieldsOf: (collection: string) => ReadonlyArray<{ name: string; type: string }>;
  takeSnapshot: () => void; claimSnapshot: () => FileWriteSnapshot | undefined;
}): Promise<boolean> {
  // Heal missing cards first, then convert lists over the healed pages — ONE batch.
  const plan = (f: Readonly<Record<string, string>>) => {
    const heal = planMissingCards(f, exists, assignments, fieldsOf);
    const conversion = convertListsToBlogSlots({ ...f, ...heal }, { blogSlotLibrary });
    return { writes: { ...heal, ...conversion.writes }, skipped: conversion.skipped };
  };
  const first = plan(files);
  if (first.skipped.length) console.debug('[lists] left as they are', first.skipped);
  const touched = Object.keys(first.writes);
  if (!touched.length) return true;
  await acquireStructuralWrite(); // its turn — never skipped (owner 2026-11-10)
  try {
    takeSnapshot();
    await rewriteLocalFiles(touched, (before) => {
      return plan({ ...files, ...presentFiles(before) }).writes;
    }, claimSnapshot());
  } catch (err) {
    console.warn('[lists] conversion skipped — nothing written', err);
  } finally {
    releaseStructuralWrite();
  }
  return true;
}
