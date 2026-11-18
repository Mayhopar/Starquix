// One-time migration: legacy JSON/Dexie project state → durable local Y.Doc
// (cloud-tier Phase 1, task-086). On first open we run the legacy hydrate
// into the doc and stamp `meta.migratedToYDoc`; afterwards the doc loads from
// y-indexeddb and the legacy stores are import-only.
// Design: docs/plans/2026-06-21-cloud-tier-phase1-local-first-foundation.md
import type * as Y from 'yjs';
import { COMPONENT_EDITOR_PAGE_ID } from '../constants';
import { isWrapperKey } from '../keyKind';
import { SOURCE_OVERRIDE_MAP_NAMES } from '../sourceOverrideEntries';
import {
  bindLocalPersistence,
  type LocalPersistenceHandle,
} from './YjsLocalPersistence';

export const MIGRATED_FLAG = 'migratedToYDoc';

export type LocalFirstLoadResult = {
  handle: LocalPersistenceHandle;
  /** 'from-local' = doc restored from y-indexeddb, legacy loader skipped. */
  source: 'fresh-migration' | 'from-local';
};

export function isDocMigrated(doc: Y.Doc): boolean {
  return doc.getMap('meta').get(MIGRATED_FLAG) === true;
}

/**
 * Bind local persistence for `projectId`, wait for the stored state to load,
 * then either skip the legacy path (already migrated) or run `legacyLoader`
 * once and stamp the migration flag. The flag lives IN the doc so it persists
 * with it — a partially-written local doc (no flag) safely re-imports.
 */
export async function loadDocLocalFirst(
  projectId: string,
  doc: Y.Doc,
  legacyLoader: (doc: Y.Doc) => Promise<void> | void
): Promise<LocalFirstLoadResult> {
  const handle = await bindLocalPersistence(projectId, doc);
  await handle.whenSynced;

  if (isDocMigrated(doc)) {
    return { handle, source: 'from-local' };
  }

  await legacyLoader(doc);
  doc.getMap('meta').set(MIGRATED_FLAG, true);
  return { handle, source: 'fresh-migration' };
}

/**
 * Deterministic meta repair after a y-indexeddb restore. `createEditorDoc()`
 * pre-seeds meta (projectId '', projectName '', currentPageId null) on the
 * fresh doc BEFORE the stored state merges in; concurrent Y.Map sets resolve
 * by clientID — a coin flip per session — so the seeds can clobber the
 * restored values (found live in the task-086 smoke: reload landed with no
 * page selected → blank canvas). The legacy path never hits this because
 * hydrateFromProject overwrites meta after binding.
 */
export function repairMetaAfterRestore(
  doc: Y.Doc,
  projectId: string,
  fallbackName?: string
): void {
  const meta = doc.getMap('meta');
  const pages = doc.getMap('pages');
  const rootPages = doc.getArray('rootPages');

  doc.transact(() => {
    if (meta.get('projectId') !== projectId) meta.set('projectId', projectId);

    const name = meta.get('projectName');
    if (!name && fallbackName) meta.set('projectName', fallbackName);

    const cur = meta.get('currentPageId') as string | null | undefined;
    if (!cur || !pages.has(cur)) {
      const firstRoot =
        rootPages.length > 0 ? (rootPages.get(0) as string) : undefined;
      const first =
        firstRoot && pages.has(firstRoot)
          ? firstRoot
          : (pages.keys().next().value as string | undefined);
      if (first) meta.set('currentPageId', first);
    }

    // Purge overrides written against the #sq-components wrapper key. The
    // wrapper is editor infrastructure — a class override on it reflows EVERY
    // section ("all sections float"), and selection refuses infra keys so the
    // damage is unfixable from the UI. Docs poisoned before the command-level
    // guard existed heal here on load.
    for (const mapName of SOURCE_OVERRIDE_MAP_NAMES) {
      const map = doc.getMap(mapName);
      for (const key of [...map.keys()]) {
        if (isWrapperKey(key)) map.delete(key);
      }
    }

    // Same poison, different home: the scan-seed path (REORDER_PAGE_ELEMENTS)
    // used to write the wrapper key into pages' rootElementIds render order.
    for (const pageId of [...pages.keys()]) {
      const page = pages.get(pageId) as Y.Map<unknown> | undefined;
      const rootIds = page?.get('rootElementIds') as Y.Array<string> | undefined;
      if (!rootIds) continue;
      for (let i = rootIds.length - 1; i >= 0; i--) {
        if (isWrapperKey(rootIds.get(i))) rootIds.delete(i, 1);
      }
    }
  });
}

/**
 * The component-editor page is EPHEMERAL by design (task-098): the Dexie save
 * path filters it, but the raw y-indexeddb doc persists everything — so it
 * must be dropped on every load. Removes the page entry, its rootPages slot,
 * and any elements stranded on it. Direct map mutation is fine here: this is
 * load-time infra cleanup, same class as the self-heal migrations.
 */
export function dropEphemeralEditorPage(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');
  const rootPages = doc.getArray('rootPages');

  const rootIdx = (rootPages.toArray() as string[]).indexOf(COMPONENT_EDITOR_PAGE_ID);
  const strandedElementIds: string[] = [];
  elements.forEach((el, id) => {
    if ((el as Y.Map<unknown>).get('pageId') === COMPONENT_EDITOR_PAGE_ID) {
      strandedElementIds.push(id);
    }
  });
  if (!pages.has(COMPONENT_EDITOR_PAGE_ID) && rootIdx < 0 && strandedElementIds.length === 0) return;

  doc.transact(() => {
    pages.delete(COMPONENT_EDITOR_PAGE_ID);
    if (rootIdx >= 0) rootPages.delete(rootIdx, 1);
    for (const id of strandedElementIds) elements.delete(id);
  });
}
