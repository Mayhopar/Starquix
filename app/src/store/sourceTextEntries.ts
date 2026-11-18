/**
 * Iteration helpers for Yjs `sourceText` text overrides — the filter +
 * Y.Map extraction live here, in one place. Two consumer subsets:
 *
 * - `forEachSourceTextEntry` — bare source keys (`file:line:col`) only:
 *   localStorage persistence (useSourceTextPersistence) and export write-back
 *   (applySourceText) need a source location to act on.
 * - `forEachReapplicableTextEntry` — source keys PLUS instance-child keys
 *   (`elementId:h2-0`, AI/text edits on component markup): the scan re-apply
 *   (viewportMessages/scanning.ts), which is the instance-child entries' ONLY
 *   reload path — RENDER rebuilds from staticMarkup and never consults
 *   sourceText. Excluded: `dynamic:` keys (the db-binding overlay owns
 *   blog-card text and must win) and drawn keys / instance roots (applied at
 *   RENDER via selectPageDrawnElements / whole-markup respectively).
 */
import * as Y from 'yjs';
import { parseKey, isDynamicKey } from './types';
import { SOURCE_OWNED_FIELD } from './sourceOverrideEntries';

export interface SourceTextEntry {
  key: string;
  file: string;
  line: number;
  col: number;
  textContent: string;
}

function entryText(value: unknown): string {
  return ((value as Y.Map<unknown>).get('textContent') as string) ?? '';
}

export function forEachSourceTextEntry(doc: Y.Doc, cb: (entry: SourceTextEntry) => void): void {
  doc.getMap('sourceText').forEach((value, key) => {
    if ((value as Y.Map<unknown>).get(SOURCE_OWNED_FIELD) === '1') return;
    const parsed = parseKey(key);
    if (parsed?.type !== 'source') return;
    cb({ key, file: parsed.file, line: parsed.line, col: parsed.col, textContent: entryText(value) });
  });
}

export function forEachReapplicableTextEntry(
  doc: Y.Doc,
  cb: (key: string, textContent: string) => void,
): void {
  doc.getMap('sourceText').forEach((value, key) => {
    if ((value as Y.Map<unknown>).get(SOURCE_OWNED_FIELD) === '1') return;
    if (isDynamicKey(key)) return;
    const kind = parseKey(key)?.type;
    if (kind !== 'source' && kind !== 'instance-child') return;
    cb(key, entryText(value));
  });
}
