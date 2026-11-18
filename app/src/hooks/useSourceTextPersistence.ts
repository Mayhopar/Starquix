/**
 * Persistence for bare source-element text overrides.
 *
 * The Yjs `sourceText` map holds text edits for three element kinds, but only
 * bare source-tracked keys (`file:line:col`, parseKey type 'source') need this
 * tier: drawn-element text persists via useDrawnElementsPersistence, and
 * `elementId:selector` entries persist in the doc itself (y-indexeddb) and
 * re-apply via the scan re-apply — their only reload path (see
 * store/sourceTextEntries.ts). This module saves the source-kind entries to
 * localStorage and restores them after project hydration
 * (hydrateFromProject clears all source maps).
 *
 * Model (b) of docs/archive/plans/2026-06-11-source-writes-dev-model-design.md.
 * Shares the observe-debounce-save core and storage reader with the
 * classes/image-attrs tiers (useSourceOverridesPersistence, task-070).
 */
import * as Y from 'yjs';
import { parseKey } from '@/store/types';
import { forEachSourceTextEntry } from '@/store/sourceTextEntries';
import { sourceBaseValue } from '@/store/sourceOverrideEntries';
import { readOverrideBlob, useMapPersistence, warnSetAside } from './useSourceOverridesPersistence';

export interface PersistedSourceText {
  /** `baseText` = the task-184 ↻ anchor (what the file rendered before the
   *  first edit). Absent on pre-anchor payloads; the scan repairs those. */
  [key: string]: { textContent: string; baseText?: string };
}

const storageKey = (projectId: string) => `sq:source-text:${projectId}`;

/** Pure: collect persistable entries (bare source keys only). */
export function serializeSourceText(doc: Y.Doc): PersistedSourceText {
  const out: PersistedSourceText = {};
  forEachSourceTextEntry(doc, ({ key, textContent }) => {
    const baseText = sourceBaseValue(doc, 'sourceText', 'baseText', key);
    out[key] = baseText === undefined ? { textContent } : { textContent, baseText };
  });
  return out;
}

/**
 * Restore persisted entries into the doc. Never clobbers an existing entry
 * (in-session state wins). 'sync' origin: not user-undoable.
 *
 * task-173: entries from an older tagger key scheme are kept in storage but
 * NOT applied — a moved `file:line:col` resolves to a NEIGHBOUR, and a
 * transplanted text override is a wrong-element edit one Push from the file.
 * See KEY_SCHEME in useSourceOverridesPersistence. Returns the set-aside count.
 */
export function restoreSourceText(doc: Y.Doc, projectId: string): number {
  const { entries: parsed, setAside, setAsideCount } = readOverrideBlob<PersistedSourceText>(
    storageKey(projectId),
  );
  if (setAsideCount > 0) warnSetAside('text', setAside);
  if (!parsed) return setAsideCount;

  const sourceText = doc.getMap('sourceText');
  doc.transact(() => {
    for (const [key, entry] of Object.entries(parsed)) {
      if (parseKey(key)?.type !== 'source') continue;
      if (sourceText.has(key)) continue;
      if (typeof entry?.textContent !== 'string') continue;
      const yEntry = new Y.Map();
      yEntry.set('textContent', entry.textContent);
      if (typeof entry.baseText === 'string') yEntry.set('baseText', entry.baseText);
      sourceText.set(key, yEntry);
    }
  }, 'sync');
  return setAsideCount;
}

/** Observe `sourceText` and debounce-save source-kind entries to localStorage. */
export function useSourceTextPersistence(doc: Y.Doc, projectId: string | null): void {
  useMapPersistence(doc, projectId, 'sourceText', storageKey, serializeSourceText);
}
