/**
 * Persistence for bare source-element class and image-attribute overrides —
 * the classes/images extension of the task-061 sourceText tier (model b,
 * docs/archive/plans/2026-06-11-source-writes-dev-model-design.md, decision 4
 * follow-up = task-070). Same contract as useSourceTextPersistence:
 * localStorage per project, restore never clobbers in-session entries,
 * 'sync' origin (not user-undoable), stale keys are inert.
 */
import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { parseKey } from '@/store/types';
import {
  forEachEditedSourceClassEntry,
  forEachSourceImageAttrsEntry,
  sourceClassBaseValue,
  sourceFileValue,
  HYDRATE_ORIGIN,
} from '@/store/sourceOverrideEntries';
import { containsBlobUrl, stripBlobUrlTokens } from '@/utils/classSanitize';
import { plural, verb } from '@/utils/plural';

export interface PersistedSourceClasses {
  /** `baseClasses` = the task-184 ↻ anchor (what the file rendered before the
   *  first edit). Optional: entries written before task-184 have none, and an
   *  absent anchor means "no ↻ for this key", never a wrong one. */
  [key: string]: { classes: string; baseClasses?: string; fileClasses?: string };
}

export interface PersistedSourceImageAttrs {
  [key: string]: Record<string, string>;
}

const classesStorageKey = (projectId: string) => `sq:source-classes:${projectId}`;
const imagesStorageKey = (projectId: string) => `sq:source-images:${projectId}`;

/** Pure: collect persistable class entries (bare source keys, edited only). */
export function serializeSourceClasses(doc: Y.Doc): PersistedSourceClasses {
  const out: PersistedSourceClasses = {};
  forEachEditedSourceClassEntry(doc, ({ key, classes }) => {
    const baseClasses = sourceClassBaseValue(doc, key);
    // fileClasses = the ↻ gate's "now" half. Persisted with the override so a
    // reload does not send the badge dark until some later scan re-derives it.
    const fileClasses = sourceFileValue(doc, 'sourceClasses', key);
    out[key] = {
      classes,
      ...(baseClasses === undefined ? {} : { baseClasses }),
      ...(fileClasses === undefined ? {} : { fileClasses }),
    };
  });
  return out;
}

/** Pure: collect persistable image-attribute entries (bare source keys). */
export function serializeSourceImageAttrs(doc: Y.Doc): PersistedSourceImageAttrs {
  const out: PersistedSourceImageAttrs = {};
  forEachSourceImageAttrsEntry(doc, ({ key, attributes }) => {
    out[key] = attributes;
  });
  return out;
}

/** Read + parse a localStorage JSON blob; any failure → null (untrusted input). */
export function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ *
 * THE KEY-SCHEME GENERATION (task-173)
 * ------------------------------------------------------------------------ */

/**
 * The tagger key-scheme generation THIS build emits.
 *
 * A stored override is nothing but a `file:line:col` address plus a value. The
 * address only means something relative to the tagger that produced it, and a
 * tagger change can move it. When that happens the OLD address is still a
 * perfectly valid-looking key — it resolves cleanly, to the WRONG element.
 *
 * Generation 1 → 2 is the 2026-08-05 occurrence-shift fix (ledger ROUND 17,
 * `preview-template/src/plugins/sq-tagging.js`): an element whose FIRST
 * attribute is dynamic emitted no separator after the tag name, so the compiled
 * scan never saw it, never counted it, and every later same-tag element in that
 * file inherited the PREVIOUS one's coordinates. Post-fix the miss is counted,
 * so those elements moved back onto their own coordinates — and for siblings
 * after a dynamic-first element the pre-fix key of element k+1 is EXACTLY the
 * post-fix key of element k. Reproduced live (ledger ROUND 20): a style saved
 * on the third `<a>` reappeared on the second, dirty-marked, one Push from
 * being written into the file.
 *
 * Generation 2 → 3 is the 2026-08-05 opaque-region fix (ledger ROUND 21,
 * task-168) — the MIRROR of the same defect. A compiled tag with NO AST element
 * behind it (an HTML comment holding markup, an `is:raw` body, an inline
 * `<script>` holding an HTML string) used to CONSUME an occurrence slot, so
 * every later same-tag element wore the coordinates of the one AFTER it. The
 * fix moves them back by one, which means the pre-fix key of element k is now
 * element k−1's key: a stored generation-2 override in such a file resolves
 * cleanly, to the wrong element. Same transplant, opposite direction.
 *
 * Generation 3 → 4 is the 2026-08-05 dynamic-first tagging fix (ledger ROUND 26,
 * task-167). ROUND 17 left an element whose FIRST attribute is dynamic
 * (`<div class={…}>`, `class:list={…}`, `{...spread}`) UNTAGGED; it now gets
 * `data-sq-source` and `data-sq-placement` like any other element. That moves
 * BOTH halves of such an element's key at once:
 *   - the coordinate half, from Astro's `data-astro-source-loc` fallback (the
 *     CONTENT start, e.g. `4:30`) to the tagger's TAG start (`4:1`);
 *   - the placement half, from the nearest tagged ANCESTOR's placement (the
 *     layout's div, shared by every invocation) to the element's own.
 * Unlike generations 2 and 3 this is expected to ORPHAN rather than transplant —
 * `4:30` is not any other element's tagger address — but it is a re-key in both
 * halves and the rule below does not distinguish, deliberately: the guard is
 * cheap and a mis-analysis of "this one is safe" is exactly how a silent
 * transplant ships.
 *
 * BUMP THIS whenever a tagger change can move an element's `file:line:col`.
 * The cost of bumping is that stored overrides stop painting (recoverable —
 * they are kept, and the user is told). The cost of NOT bumping is a silent
 * wrong-element write.
 */
export const KEY_SCHEME = 4;

/** A generation of entries we refuse to apply. Kept verbatim — NEVER purged. */
export interface SetAsideBucket<T> {
  keyScheme: number;
  entries: T;
}

export interface OverrideBlobRead<T> {
  /** Entries written under the CURRENT scheme — the only ones ever applied. */
  entries: T | null;
  /** Every other generation found in the blob, carried through untouched. */
  setAside: SetAsideBucket<T>[];
  /** Total number of set-aside keys, for the user-facing notice. */
  setAsideCount: number;
}

function keyCount(value: unknown): number {
  return value && typeof value === 'object' ? Object.keys(value as object).length : 0;
}

/**
 * Read a source-override blob, splitting it by key-scheme generation.
 *
 * Two on-disk shapes are accepted:
 *  - the ENVELOPE `{ keyScheme, entries, setAside? }` (what this build writes);
 *  - a bare `{ "file:line:col": … }` map — everything written before the stamp
 *    existed, which is generation 1 BY DEFINITION.
 *
 * Anything that is not the current generation — older OR newer, the latter
 * being an app downgrade — is set aside rather than applied. Orphan beats
 * transplant: an entry that paints nothing is a visible loss the user can
 * redo, an entry that paints the wrong element is silent corruption that one
 * Push burns into their file.
 */
export function readOverrideBlob<T extends object>(storageKey: string): OverrideBlobRead<T> {
  const parsed = readStorage<Record<string, unknown>>(storageKey);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { entries: null, setAside: [], setAsideCount: 0 };
  }

  const setAside: SetAsideBucket<T>[] = [];
  const carry = (bucket: unknown): void => {
    if (!bucket || typeof bucket !== 'object') return;
    const b = bucket as { keyScheme?: unknown; entries?: unknown };
    if (typeof b.keyScheme !== 'number' || keyCount(b.entries) === 0) return;
    setAside.push({ keyScheme: b.keyScheme, entries: b.entries as T });
  };

  const isEnvelope =
    typeof parsed.keyScheme === 'number' &&
    !!parsed.entries &&
    typeof parsed.entries === 'object';

  if (!isEnvelope) {
    carry({ keyScheme: 1, entries: parsed });
  } else {
    if (Array.isArray(parsed.setAside)) parsed.setAside.forEach(carry);
    if (parsed.keyScheme !== KEY_SCHEME) carry({ keyScheme: parsed.keyScheme, entries: parsed.entries });
  }

  const current = isEnvelope && parsed.keyScheme === KEY_SCHEME ? (parsed.entries as T) : null;
  return {
    entries: current,
    setAside,
    setAsideCount: setAside.reduce((n, b) => n + keyCount(b.entries), 0),
  };
}

/**
 * One console line per set-aside tier so the exact keys are recoverable by
 * hand. The user-facing half is `keySchemeSetAsideNotice` — a toast cannot
 * carry 12 keys and stay readable.
 */
export function warnSetAside<T extends object>(tier: string, buckets: SetAsideBucket<T>[]): void {
  for (const b of buckets) {
    console.warn(
      `[SourceOverrides] ${keyCount(b.entries)} ${tier} override(s) written under key scheme ` +
        `${b.keyScheme} were NOT applied (this build emits ${KEY_SCHEME}); they stay in ` +
        `localStorage and can be recovered by hand:`,
      Object.keys(b.entries as object),
    );
  }
}

export interface SetAsideCounts {
  classes: number;
  text: number;
  images: number;
}

/**
 * The ONE sentence the user gets. Null when nothing was set aside — a silent
 * orphan is exactly how this class of bug stays hidden, and an unconditional
 * toast is how a real notice gets trained away.
 */
export function keySchemeSetAsideNotice(counts: SetAsideCounts): string | null {
  const parts: string[] = [];
  if (counts.classes > 0) parts.push(plural(counts.classes, 'style edit'));
  if (counts.text > 0) parts.push(plural(counts.text, 'text edit'));
  if (counts.images > 0) parts.push(plural(counts.images, 'image edit'));
  if (parts.length === 0) return null;

  const total = counts.classes + counts.text + counts.images;
  const head =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return (
    `Set aside ${head} saved by an earlier version of Starquix — ` +
    `${total === 1 ? 'it' : 'they'} ${verb(total, 'point')} at element positions this version ` +
    `reads differently, so re-applying could restyle the wrong element. ` +
    `Nothing was deleted; redo any edit you still want.`
  );
}

// Non-throwing sibling of commands.ts sourceLocationToYMap: restore runs over
// untrusted localStorage inside a transact and must never throw on junk keys.
function sourceLocationYMap(file: string, line: number, column: number): Y.Map<unknown> {
  const m = new Y.Map();
  m.set('file', file);
  m.set('line', line);
  m.set('column', column);
  return m;
}

/**
 * Restore persisted class overrides. Never clobbers an existing entry
 * (in-session state wins). 'sync' origin: not user-undoable.
 *
 * task-149: a key with NO `~p…` placement segment is NOT stale. Page files'
 * own elements scan bare by design (the tagger stamps `data-sq-placement=""`
 * to terminate the bridge's closest() walk), and a component reached without a
 * resolvable call site scans bare too. Never filter on the absence of a
 * placement — an earlier "pre-placement purge" here deleted every page-level
 * override on first open. See __tests__/placementStorageMigration.test.ts.
 *
 * task-173: entries from an older key scheme are NOT applied (see KEY_SCHEME).
 * They are also NOT deleted — the blob keeps them under `setAside` forever.
 * Returns the number of set-aside entries so the caller can tell the user.
 */
export function restoreSourceClasses(doc: Y.Doc, projectId: string): number {
  const { entries: parsed, setAside, setAsideCount } = readOverrideBlob<PersistedSourceClasses>(
    classesStorageKey(projectId),
  );
  if (setAsideCount > 0) warnSetAside('class', setAside);
  if (!parsed) return setAsideCount;
  const map = doc.getMap('sourceClasses');
  doc.transact(() => {
    for (const [key, entry] of Object.entries(parsed)) {
      const p = parseKey(key);
      if (p?.type !== 'source') continue;
      if (map.has(key)) continue;
      if (typeof entry?.classes !== 'string') continue;
      // Repair poisoned pre-fix data: persisted blob: URLs are dead across
      // reloads (session-scoped) and unrecoverable — strip them.
      let classes = entry.classes;
      if (containsBlobUrl(classes)) {
        classes = stripBlobUrlTokens(classes);
        console.warn(`[ClassStore] stripped dead blob: URL from persisted classes for ${key}`);
      }
      const yEntry = new Y.Map();
      yEntry.set('classes', classes);
      yEntry.set('edited', true);
      // The ↻ anchor outlives the session that made the edit — a master file
      // edited while the editor was closed must still announce itself.
      if (typeof entry.baseClasses === 'string') yEntry.set('baseClasses', entry.baseClasses);
      if (typeof entry.fileClasses === 'string') yEntry.set('fileClasses', entry.fileClasses);
      // file:line:col keys ARE the location — rebuild it so downstream
      // consumers (pending-update tracking, legacy persist paths) see one.
      yEntry.set('sourceLocation', sourceLocationYMap(p.file, p.line, p.col));
      map.set(key, yEntry);
    }
  }, 'sync');
  return setAsideCount;
}

/** Restore persisted image-attribute overrides. Never clobbers. See KEY_SCHEME. */
export function restoreSourceImageAttrs(doc: Y.Doc, projectId: string): number {
  const { entries: parsed, setAside, setAsideCount } = readOverrideBlob<PersistedSourceImageAttrs>(
    imagesStorageKey(projectId),
  );
  if (setAsideCount > 0) warnSetAside('image-attribute', setAside);
  if (!parsed) return setAsideCount;
  const map = doc.getMap('sourceImageAttributes');
  doc.transact(() => {
    for (const [key, attrs] of Object.entries(parsed)) {
      if (parseKey(key)?.type !== 'source') continue;
      if (map.has(key)) continue;
      if (!attrs || typeof attrs !== 'object') continue;
      // Note: .size on an unintegrated Y.Map is always 0 (prelim content),
      // so count string values ourselves before deciding to attach.
      const stringAttrs = Object.entries(attrs).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string',
      );
      if (stringAttrs.length === 0) continue;
      const yAttrs = new Y.Map();
      for (const [attr, value] of stringAttrs) yAttrs.set(attr, value);
      map.set(key, yAttrs);
    }
  }, HYDRATE_ORIGIN); // the cached value is painted, never re-written over the files
  return setAsideCount;
}

const DEBOUNCE_MS = 300;

/**
 * Shared observe-debounce-save core for all source-override localStorage
 * tiers (text/classes/image attrs). Contract: `storageKeyFor` and `serialize`
 * must be stable references (module-level functions) — they sit in dep arrays.
 */
export function useMapPersistence(
  doc: Y.Doc,
  projectId: string | null,
  mapName: string,
  storageKeyFor: (projectId: string) => string,
  serialize: (doc: Y.Doc) => Record<string, unknown>,
): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWrittenRef = useRef<string>('');

  const save = useCallback(() => {
    if (!projectId) return;
    const persisted = serialize(doc);
    const k = storageKeyFor(projectId);
    // Re-read rather than remember: this hook's restore may never have run for
    // this blob (another tab, a later mount, a project switch), and a save that
    // forgets `setAside` is a PURGE — the one thing this tier must never do.
    const { setAside } = readOverrideBlob<Record<string, unknown>>(k);
    const hasEntries = Object.keys(persisted).length > 0;

    if (!hasEntries && setAside.length === 0) {
      localStorage.removeItem(k);
      lastWrittenRef.current = '';
      return;
    }
    const blob: Record<string, unknown> = { keyScheme: KEY_SCHEME, entries: persisted };
    if (setAside.length > 0) blob.setAside = setAside;
    const json = JSON.stringify(blob);
    if (json === lastWrittenRef.current) return;
    lastWrittenRef.current = json;
    localStorage.setItem(k, json);
  }, [doc, projectId, storageKeyFor, serialize]);

  // Flush the pending debounced write on every page-exit path (task-077):
  // pagehide (reload/close), visibilitychange→hidden (tab switch, mobile
  // Safari's only reliable pre-unload event), and unmount/project-switch.
  // save() dedupes identical JSON, so double-firing writes once; setItem is
  // synchronous, so it completes inside the unload handler.
  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    save();
  }, [save]);

  useEffect(() => {
    if (!projectId) return;
    const map = doc.getMap(mapName);
    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(save, DEBOUNCE_MS);
    };
    map.observeDeep(handler);
    return () => {
      map.unobserveDeep(handler);
      // Flush, don't drop: a pending write here is an edit made <300ms
      // before unmount/doc-swap — clearing it silently loses the edit.
      if (debounceRef.current) flush();
    };
  }, [doc, projectId, mapName, save, flush]);

  useEffect(() => {
    if (!projectId) return;
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [projectId, flush]);
}

/** Observe `sourceClasses` and debounce-save edited source-kind entries. */
export function useSourceClassesPersistence(doc: Y.Doc, projectId: string | null): void {
  useMapPersistence(doc, projectId, 'sourceClasses', classesStorageKey, serializeSourceClasses);
}

/** Observe `sourceImageAttributes` and debounce-save source-kind entries. */
export function useSourceImageAttrsPersistence(doc: Y.Doc, projectId: string | null): void {
  useMapPersistence(doc, projectId, 'sourceImageAttributes', imagesStorageKey, serializeSourceImageAttrs);
}
