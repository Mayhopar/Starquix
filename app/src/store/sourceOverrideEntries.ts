/**
 * Iteration helpers for bare source-element class / image-attribute overrides
 * (Yjs `sourceClasses` / `sourceImageAttributes` entries whose key parses as
 * type 'source' = file:line:col). Persistence, export application, and scan
 * re-apply all consume the same shapes — keep the filters in one place.
 * Mirror of sourceTextEntries.ts (task-061).
 *
 * sourceClasses holds an entry for EVERY registered (clicked) element —
 * REGISTER_SOURCE_ELEMENT stores the original classes on selection. Only
 * entries stamped `edited: true` by UPDATE_SOURCE_CLASSES are user edits;
 * the rest must stay inert (never persisted, re-applied, or exported).
 */
import * as Y from 'yjs';
import { sameTokenSet } from '@/core/classes/index';
import { getObservedFileValue, notePendingWrite } from '@/services/classWriteBaseline';
import { parseKey } from './types';
import { decodeInnerHtmlEntities, encodeInnerHtmlEntities } from '../../../preview-template/src/plugins/sq-prop-fallback.js';

/** Every source-keyed override map (keys = file:line:col or instance keys).
 *  THE list — heal sweeps, Push detection, and tests iterate this; a new
 *  source-keyed map joins here or it silently escapes all of them. */
export const SOURCE_OVERRIDE_MAP_NAMES = [
  'sourceClasses',
  'sourceText',
  'sourceImageAttributes',
  'sourceLinkAttributes',
] as const;

/**
 * THE inert-entry predicate. sourceClasses holds an entry for EVERY
 * registered (clicked) element; only entries stamped `edited: true` by
 * UPDATE_SOURCE_CLASSES are user edits — the rest must never count as
 * divergence, enable Push, persist, or export.
 *
 * task-186 — AND the value has to actually DIFFER from its own ↻ anchor.
 * `classes === baseClasses` is not an edit, whatever the stamp says, and the
 * owner's storage held exactly that:
 *   "src/components/Header.astro:6:1": {classes:"…bg-white…", baseClasses:"…bg-white…"}
 * It counted for `*`, was re-applied by every scan (painting itself over
 * whatever the file rendered) and re-serialised forever — while `base === now`
 * kept ↻ structurally unable to fire, so the UI offered no way out.
 *
 * The rule is not new: ClassStoreContext already refuses to store a no-op for
 * instance children (task-102, `sameTokenSet` → delete the override entry), and
 * `sameTokenSet` is documented there as THE no-op-override predicate. This is
 * the same comparison on the other key shape, placed HERE rather than at the
 * write door so the read side agrees too — one predicate serves `*`, ↻, Push,
 * scan re-apply, persistence and export, and an already-poisoned entry restored
 * from localStorage lands inert (healed on the next save) instead of needing a
 * purge. Nothing is deleted; NO KEY_SCHEME change.
 *
 * No anchor ⇒ still an edit: unknown stays unknown (sourceClassBaseValue's
 * rule), and a pre-task-184 entry must keep painting.
 *
 * task-186 FIX-1 — the OTHER no-op shape, which the anchor comparison cannot
 * see because `classes !== baseClasses` (the anchor holds the PRE-edit value).
 * Editing a master through the COMPONENT EDITOR writes the component file
 * (correct) and ALSO leaves the entry behind:
 *   "src/components/X.astro:6:1": {classes:"…bg-zinc-800…",
 *                                  baseClasses:"…bg-red-400…"}
 * The instant that write lands the file IS that value, so the entry can only
 * ever shadow it — and it does, the moment the file moves EXTERNALLY (git
 * checkout, another tool, another session).
 *
 * So: an override equal to what the file NOW renders is not an override. The
 * "now" is `services/classWriteBaseline.ts` — the same store ↻ reads, refreshed
 * by every successful write and by the scan — and the comparison lives HERE, in
 * the one predicate `*`, ↻, Push, scan re-apply, persistence and export already
 * share. Nothing is deleted; NO KEY_SCHEME change.
 *
 * `key` omitted / no OBSERVED file value ⇒ unchanged behaviour: WC never writes
 * a file, so nothing may be inferred from a baseline the boot seed guessed (see
 * getObservedFileValue — that guess IS the override, so reading it here would
 * retire every restored override on open: the local-only-exclusion regression
 * pinned by hooks/__tests__/useSourceOverridesPersistence.test.ts). A
 * doc-overlay edit — WC, and every local cross-file edit the writer declines —
 * leaves the observed value at the file's pre-edit value, so it stays an edit
 * and survives the reload.
 */
export function isEditedSourceClassEntry(
  entry: Y.Map<unknown> | undefined, key?: string,
): boolean {
  if (entry?.get('edited') !== true) return false;
  // The durable source command owns this accepted value. Keeping its carrier
  // for editing/undo must not create a second positional overlay on reload.
  if (entry.get(SOURCE_OWNED_FIELD) === '1') return false;
  const tokens = ((entry.get('classes') as string) ?? '').split(/\s+/).filter(Boolean);
  // What the file renders: PERSISTED on the entry first (survives the iframe
  // reloads a write triggers), in-memory observation second. Reading only the
  // in-memory one left a master edit's own entry looking like an edit after any
  // reload — it then counted for `*`, lit ↻ in the component view, and shadowed
  // the file it was identical to (measured 2026-08-05).
  const persisted = entry.get(FILE_FIELD.sourceClasses);
  const fileNow = typeof persisted === 'string'
    ? persisted
    : (key === undefined ? undefined : getObservedFileValue('classes', key));
  if (fileNow !== undefined && sameTokenSet(tokens, fileNow)) return false;
  const base = entry.get('baseClasses');
  if (typeof base !== 'string') return true;
  return !sameTokenSet(tokens, base);
}

/** The class value of an EDITED override on `key`, or undefined if there is
 *  none. Entries that only record a registration are not overrides. */
export function editedSourceClassValue(doc: Y.Doc, key: string): string | undefined {
  const entry = doc.getMap('sourceClasses').get(key) as Y.Map<unknown> | undefined;
  if (!isEditedSourceClassEntry(entry, key)) return undefined;
  return ((entry as Y.Map<unknown>).get('classes') as string) ?? '';
}

/**
 * What the FILE rendered for `key` when the user FIRST overrode it (task-184).
 *
 * The local-mode twin of `masterBaseRev` (store/masters.ts): WC stamps the
 * master's revision on the instance at override-write time so ↻ can tell "the
 * master moved LATER" from "this instance is simply edited". Local placements
 * have no instance element to stamp, so the anchor rides on the override entry
 * itself — and persists with it (hooks/useSourceOverridesPersistence.ts), or a
 * master edit made while the editor was closed would arrive unannounced.
 *
 * `undefined` = unknown (pre-task-184 entry, or an edit on a key that was never
 * registered). Unknown means NO ↻ — a missing badge, never a false one.
 */
export function sourceClassBaseValue(doc: Y.Doc, key: string): string | undefined {
  return sourceBaseValue(doc, 'sourceClasses', 'baseClasses', key);
}

/**
 * The same anchor, for any source-override tier (task-184 unit B).
 *
 * `sourceText` shadows a moved master through the identical scan re-apply, so
 * it needs the identical anchor — one field on the entry, one reader, one gate
 * in `localMasterOverrides.localMasterOutdated`. The field NAME stays per-map
 * (`baseClasses` / `baseText`) because `baseClasses` is already on disk in
 * every `sq:source-classes:*` payload; renaming it would drop the anchor off
 * every stored override until a scan repaired it. Map+field come from the
 * MAP_NAME / BASE_FIELD tables in store/localMasterOverrides.ts.
 */
export function sourceBaseValue(
  doc: Y.Doc, mapName: string, field: string, key: string,
): string | undefined {
  const entry = doc.getMap(mapName).get(key) as Y.Map<unknown> | undefined;
  const base = entry?.get(field);
  return typeof base === 'string' ? base : undefined;
}

/**
 * Anchor an EDITED override that never got one, from the value the FILE is
 * observed to render (task-184 repair).
 *
 * Two entry shapes reach this state and neither can stamp itself: one restored
 * from a payload written before the anchor existed, and one created by
 * UPDATE_SOURCE_CLASSES' `else` branch (an edit on a key no click ever
 * registered, so the doc never held the pre-edit value). Measured live: such a
 * placement could NEVER light ↻ while an anchored placement of the same
 * component, on the same page, with the same moved master, did.
 *
 * Only-if-absent, exactly like the stamp in UPDATE_SOURCE_CLASSES — the same
 * field, read by the same sourceClassBaseValue. Re-anchoring on every scan
 * would make the base track the master and ↻ could never fire.
 *
 * The CALLER must have established that `fileClasses` came from the file and
 * not from our own re-apply (see Canvas/viewportMessages/scanning.ts, the one
 * caller: the branch where the scan disagrees with the override). Anchoring on
 * an override value would light ↻ the instant anything is edited.
 *
 * 'sync' origin: a repair is not an edit, and it must not cost a ⌘Z.
 */
export function noteSourceBaseValue(
  doc: Y.Doc, mapName: string, field: string, key: string, fileValue: string,
): void {
  const entry = doc.getMap(mapName).get(key) as Y.Map<unknown> | undefined;
  if (!entry || entry.has(field)) return;
  // sourceClasses alone holds inert registration-only entries; anchoring one
  // would be harmless (nothing reads it) but the invariant is cheap to keep.
  if (mapName === 'sourceClasses' && !isEditedSourceClassEntry(entry, key)) return;
  doc.transact(() => entry.set(field, fileValue), 'sync');
}

/**
 * FILE_FIELD — "what the file renders for this element RIGHT NOW", persisted on
 * the override entry beside the anchor.
 *
 * The ↻ gate needs two halves: the anchor (what the file said when you edited)
 * and the file's value now. The "now" half used to live ONLY in the
 * `services/classWriteBaseline` module singleton, which every iframe reload
 * destroys — so whether ↻ appeared depended on a scan landing at the right
 * moment and surviving until the badge was read. Measured 2026-08-05: five
 * bridge reloads for one master write, and the user had to visit Assets several
 * times before the badge showed. Persisting it makes the gate a comparison of
 * two durable values: no timing, no reload sensitivity, no re-derivation.
 *
 * Written from two places, both of which know it is the FILE speaking: the
 * dispatch stamp (the write itself, authoritative about what the file is about
 * to render) and the scan branch where the DOM disagrees with the override —
 * there, `now` cannot have come from our own re-apply. Always overwrites,
 * unlike the anchor: this field is supposed to track the master.
 *
 * Same sibling-of-user-data caveat as IMAGE_BASE_FIELD for the image map.
 */
export const FILE_FIELD: Record<string, string> = {
  sourceClasses: 'fileClasses',
  sourceText: 'fileText',
  sourceImageAttributes: 'fileAttributes',
};

/**
 * A landed file write is the ONLY unambiguous statement of what the file
 * renders — better than any scan, because no re-apply can have touched it yet.
 * Stamp it on every override entry for that source line, whatever placement
 * they carry: `<Header/>` on `/` and on `/about` read the same lines of the
 * same file, so one write moves the master for all of them.
 *
 * This is what makes the badge appear on the FIRST trip back. Deriving it from
 * a later DOM scan made it depend on which of the (measured: five) bridge
 * reloads a scan landed between.
 */
export function stampFileValueForLine(
  doc: Y.Doc, mapName: string, writtenKey: string, fileValue: string,
): void {
  const line = sourceLineOf(writtenKey);
  const map = doc.getMap(mapName);
  const targets: string[] = [];
  map.forEach((_v, k) => { if (sourceLineOf(k) === line) targets.push(k); });
  // Arm the frame-liveness guard even when NO entry matched: an element with no
  // override still renders from this file and the frame can be just as behind.
  notePendingWrite('classes', line, fileValue);
  doc.transact(() => {
    for (const k of targets) {
      const entry = doc.getMap(mapName).get(k) as Y.Map<unknown> | undefined;
      if (entry && entry.get(FILE_FIELD[mapName]) !== fileValue) {
        entry.set(FILE_FIELD[mapName], fileValue);
      }
    }
  }, 'sync');
}

/** The file's current value for this entry, or undefined if never observed. */
export function sourceFileValue(
  doc: Y.Doc, mapName: string, key: string,
): string | undefined {
  const entry = doc.getMap(mapName).get(key) as Y.Map<unknown> | undefined;
  const v = entry?.get(FILE_FIELD[mapName]);
  return typeof v === 'string' ? v : undefined;
}

/**
 * The placement-free source line a key addresses — `file:line:col`.
 *
 * Via parseKey, not a hand-rolled `indexOf('~')`: a key can also carry a `#N`
 * repeat suffix, which the naive strip leaves on. The two stamp call sites feed
 * different shapes (the element key, and a rebuilt `file:line:col`), so the
 * naive form put one write in two cells — the pending entry then never cleared
 * and the paint repeated forever.
 */
export function sourceLineOf(key: string): string {
  const p = parseKey(key);
  return p?.type === 'source' ? `${p.file}:${p.line}:${p.col}` : key;
}

/**
 * Record what the file renders now, on the entry. Guarded: an unchanged value
 * would re-open a Yjs transaction on every scan, and every transaction on
 * `sourceClasses` rebuilds ClassStoreContext's whole state and re-runs every
 * useYjsValue selector in the tree.
 */
export function noteSourceFileValue(
  doc: Y.Doc, mapName: string, key: string, fileValue: string,
): void {
  const entry = doc.getMap(mapName).get(key) as Y.Map<unknown> | undefined;
  if (!entry) return;
  const field = FILE_FIELD[mapName];
  if (entry.get(field) === fileValue) return;
  doc.transact(() => entry.set(field, fileValue), 'sync');
}



/**
 * The ↻ anchor's field name inside a `sourceImageAttributes` entry
 * (`BASE_FIELD.image` in store/localMasterOverrides.ts, which imports it from
 * here — the map's shape is owned by this module and importing the other way
 * would close a cycle).
 *
 * Unlike `baseClasses` / `baseText`, this one is a SIBLING of user data: an
 * image entry's other string values are `src` / `alt` / `loading`, which Push
 * and the export pipeline write into the real .astro file and the iframe sync
 * paints onto the element. Every place that treats those values as attributes
 * therefore has to skip this key — the three of them are here,
 * hooks/useSourceImageSync.ts and context/hooks/useInstanceOverrideSync.ts.
 */
export const IMAGE_BASE_FIELD = 'baseAttributes';

/**
 * The image entry's bookkeeping keys — siblings of REAL `<img>` attributes that
 * Push writes into the .astro file, export emits, and the iframe sync paints.
 * One predicate, so a future third field means editing one site rather than
 * five; missing one leaks `baseAttributes="…"` into the user's real markup.
 */
export function isImageBookkeepingField(attr: string): boolean {
  return attr === IMAGE_BASE_FIELD || attr === FILE_FIELD.sourceImageAttributes || attr === SOURCE_OWNED_FIELD;
}

export interface SourceClassOverrideEntry {
  key: string;
  file: string;
  line: number;
  col: number;
  classes: string;
}

export interface SourceImageAttrsEntry {
  key: string;
  file: string;
  line: number;
  col: number;
  attributes: Record<string, string>;
}

export function forEachEditedSourceClassEntry(
  doc: Y.Doc,
  cb: (entry: SourceClassOverrideEntry) => void,
): void {
  doc.getMap('sourceClasses').forEach((value, key) => {
    const parsed = parseKey(key);
    if (parsed?.type !== 'source') return;
    const entry = value as Y.Map<unknown>;
    if (!isEditedSourceClassEntry(entry, key)) return;
    const classes = (entry.get('classes') as string) ?? '';
    cb({ key, file: parsed.file, line: parsed.line, col: parsed.col, classes });
  });
}

export function forEachSourceImageAttrsEntry(
  doc: Y.Doc,
  cb: (entry: SourceImageAttrsEntry) => void,
): void {
  doc.getMap('sourceImageAttributes').forEach((value, key) => {
    const parsed = parseKey(key);
    if (parsed?.type !== 'source') return;
    const attributes: Record<string, string> = {};
    (value as Y.Map<unknown>).forEach((v, attr) => {
      if (isImageBookkeepingField(attr)) return; // anchors, not attributes
      if (typeof v === 'string' && !isSourceOwnedImageValue(value as Y.Map<unknown>, attr, v)) attributes[attr] = v;
    });
    if (Object.keys(attributes).length === 0) return;
    cb({ key, file: parsed.file, line: parsed.line, col: parsed.col, attributes });
  });
}

/**
 * The inline-link markup override's field name inside a `sourceLinkAttributes`
 * entry — the element's persisted innerHTML after a link wrap/unwrap
 * (MARKUP_CHANGED). Same sibling-of-user-data caveat as IMAGE_BASE_FIELD:
 * every consumer that treats the entry's values as link ATTRIBUTES
 * (href/target/ariaLabel) must skip this key. It lives here rather than in a
 * new map so the existing sourceLinkAttributes machinery — undo capture
 * (UndoContext SOURCE_OVERRIDE_FIELDS), delete cleanup
 * (deleteSourceOverridesForElement), placement-key migration, and the scan
 * re-apply — all carry it for free.
 */
export const LINK_MARKUP_FIELD = 'sqMarkup';
/** String bookkeeping so existing attr snapshots persist the original owner. */
export const LINK_MARKUP_OWNER_FIELD = 'sqMarkupOwner';
export interface LinkMarkupOwner {
  location: import('@/bridge').SourceLocation;
  acceptedRevision?: number;
  actionIndex?: number;
}
export function linkMarkupOwner(entry: Y.Map<unknown> | undefined): LinkMarkupOwner | undefined {
  const raw = entry?.get(LINK_MARKUP_OWNER_FIELD);
  if (typeof raw !== 'string') return undefined;
  try {
    const owner = JSON.parse(raw) as LinkMarkupOwner;
    return typeof owner.location?.file === 'string' && Number.isFinite(owner.location.line)
      && Number.isFinite(owner.location.column) ? owner : undefined;
  } catch { return undefined; }
}
/** Accepted file intent owns this carrier; it must never shadow later source. */
export const SOURCE_OWNED_FIELD = 'sqSourceOwned';

/** Origin of a transaction that records state the files or the editor cache
 *  ALREADY hold (the scan's seeds and anchors, the override-cache restore) —
 *  observers paint it, never write it back as an edit. */
export const HYDRATE_ORIGIN = 'hydrate';

/** Image ownership is per attribute/value: a later legacy edit must still run
 * through its observer writer. String metadata survives existing undo snapshots. */
export function sourceOwnedImageValues(entry: Y.Map<unknown> | undefined): Record<string, string> {
  const raw = entry?.get(SOURCE_OWNED_FIELD);
  if (typeof raw !== 'string') return {};
  try {
    const values: unknown = JSON.parse(raw);
    return values && typeof values === 'object' && !Array.isArray(values)
      ? Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
  }
  catch { return {}; }
}
export function isSourceOwnedImageValue(entry: Y.Map<unknown> | undefined, attribute: string, value: string): boolean {
  return sourceOwnedImageValues(entry)[attribute] === value;
}


/** Bookkeeping keys of a sourceLinkAttributes entry — not real DOM attributes. */
export function isLinkBookkeepingField(attr: string): boolean {
  return attr === LINK_MARKUP_FIELD || attr === LINK_MARKUP_OWNER_FIELD || attr === SOURCE_OWNED_FIELD;
}

/**
 * The flat text a stored link-markup override renders — tags stripped, the
 * entities innerHTML serialization produces decoded. Used by
 * UPDATE_SOURCE_TEXT to decide whether a later plain-text edit invalidates
 * the markup override (mismatching flat text = the text edit is newer truth,
 * so the markup must not resurrect the old text on reload).
 */
export function linkMarkupFlatText(markup: string): string {
  return decodeInnerHtmlEntities(markup.replace(/<[^>]*>/g, ''));
}

/**
 * Apply a plain-text edit ON TOP of a stored link-markup override, keeping the
 * wrap (gap: editing text after a wrap silently unwrapped the link on the next
 * reload while the live DOM kept showing it \u2014 DOM/doc divergence).
 *
 * EDIT_MODE_EXITED carries flat text only, so the edit is located by a common
 * prefix/suffix diff against the markup's current flat text and spliced into
 * the ONE text run that fully contains the changed span \u2014 an edit before/after
 * the <a>, or inside the link's own text, updates that run in place and the
 * wrap persists (the same "a later edit updates the override" semantics the
 * sourceText tier has). Returns the updated markup, or null when the change
 * spans a tag boundary (retyped across the link edge, wholesale replacement):
 * ambiguous \u2014 the caller falls back to dropping the markup (text is the newer
 * truth) and should then flatten the DOM to match.
 */
export function spliceLinkMarkupText(markup: string, newFlat: string): string | null {
  const oldFlat = linkMarkupFlatText(markup);
  if (oldFlat === newFlat) return markup;
  const minLen = Math.min(oldFlat.length, newFlat.length);
  let p = 0;
  while (p < minLen && oldFlat.charCodeAt(p) === newFlat.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < minLen - p
    && oldFlat.charCodeAt(oldFlat.length - 1 - s) === newFlat.charCodeAt(newFlat.length - 1 - s)
  ) s++;
  const changeStart = p;
  const changeEndOld = oldFlat.length - s;
  const replacement = newFlat.slice(p, newFlat.length - s);

  // split with a capture keeps tags at ODD indices; text runs (possibly '')
  // at even indices. Their decoded concatenation IS oldFlat, so flat offsets
  // map 1:1 onto runs.
  const tokens = markup.split(/(<[^>]*>)/);
  let flat = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 1) continue; // tag token
    const decoded = decodeInnerHtmlEntities(tokens[i]);
    const start = flat;
    const end = flat + decoded.length;
    if (changeStart >= start && changeEndOld <= end) {
      const next = decoded.slice(0, changeStart - start)
        + replacement
        + decoded.slice(changeEndOld - start);
      tokens[i] = encodeInnerHtmlEntities(next);
      return tokens.join('');
    }
    flat = end;
  }
  return null;
}

/**
 * Drop a stored link-markup override once the FILE holds the same bytes \u2014
 * local-mode files-truth bookkeeping (never an edit: 'sync' origin, no \u2318Z
 * cost). `expectedMarkup` guards the async caller against clearing a NEWER
 * wrap stored while its own write was in flight: the field is deleted only
 * while it still holds the exact markup that write carried.
 */
export function clearLinkMarkupOverride(
  doc: Y.Doc, key: string, expectedMarkup?: string,
): void {
  const map = doc.getMap('sourceLinkAttributes');
  const entry = map.get(key) as Y.Map<unknown> | undefined;
  if (!entry) return;
  const stored = entry.get(LINK_MARKUP_FIELD);
  if (typeof stored !== 'string') return;
  if (expectedMarkup !== undefined && stored !== expectedMarkup) return;
  doc.transact(() => {
    entry.delete(LINK_MARKUP_FIELD);
    entry.delete(LINK_MARKUP_OWNER_FIELD);
    if (entry.size === 0) map.delete(key);
  }, 'sync');
}

export interface SourceLinkAttrsEntry {
  key: string;
  file: string;
  line: number;
  col: number;
  /** Real link attributes, doc names (href/target/ariaLabel) — bookkeeping fields excluded. */
  attributes: Record<string, string>;
  /** Persisted innerHTML from an inline link wrap/unwrap, when present. */
  markup?: string;
}

export function forEachSourceLinkAttrsEntry(
  doc: Y.Doc,
  cb: (entry: SourceLinkAttrsEntry) => void,
): void {
  doc.getMap('sourceLinkAttributes').forEach((value, key) => {
    const parsed = parseKey(key);
    if (parsed?.type !== 'source') return;
    const attributes: Record<string, string> = {};
    let markup: string | undefined;
    (value as Y.Map<unknown>).forEach((v, attr) => {
      if (typeof v !== 'string') return;
      if (isLinkBookkeepingField(attr)) {
        if (attr === LINK_MARKUP_FIELD && (value as Y.Map<unknown>).get(SOURCE_OWNED_FIELD) !== '1') markup = v;
        return;
      }
      attributes[attr] = v;
    });
    if (Object.keys(attributes).length === 0 && markup === undefined) return;
    cb({ key, file: parsed.file, line: parsed.line, col: parsed.col, attributes, markup });
  });
}
