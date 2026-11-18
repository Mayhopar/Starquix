/**
 * task-118 — override orphans + the remap appliers used by SET_MASTER_MARKUP.
 *
 * When a structural source edit removes an element that held override data,
 * the data is NEVER silently dropped: the live entries are deleted and
 * snapshotted (plain JSON) into `doc.getMap('overrideOrphans')`, created in
 * the same transaction as the remap so undo restores everything coherently
 * (ledger #24). UX (toast/badge/popover) consumes this map; Discard goes
 * through the DISCARD_OVERRIDE_ORPHAN command.
 */
import * as Y from 'yjs';
import { generateId } from '@/utils/generateId';
import type { SelectorRemap, RemapFingerprint } from './selectorRemap';

export const ORPHANS_MAP = 'overrideOrphans';

export interface OrphanEntry {
  /** Element field ('classOverrides', …), 'sourceClasses'/'sourceText' (doc maps), or 'masters.childOverrides'. */
  store: string;
  key: string;
  value: unknown; // plain JSON snapshot of the removed override data
}

export interface OverrideOrphan {
  astroSource: string;
  instanceId?: string;
  oldSelector: string;
  sqId?: string;
  fingerprint: RemapFingerprint;
  entries: OrphanEntry[];
}

/** Element Y.Map fields keyed BY selector (rekeyed on remap, orphaned on miss).
 *  linkCounters / imageAttributes / linkAttributes are NOT selector-keyed — excluded. */
const SELECTOR_KEYED_MAPS = [
  'classOverrides',
  'overrides',
  'markupOverrides',
  'imageOverrides',
  'linkOverrides',
  'hrefOverrides',
  'attributeOverrides',
  'unifiedOverrides',
] as const;

export function getOrphansMap(doc: Y.Doc): Y.Map<OverrideOrphan> {
  return doc.getMap(ORPHANS_MAP);
}

export function listOrphansForSource(doc: Y.Doc, astroSource: string): Array<{ id: string; orphan: OverrideOrphan }> {
  const out: Array<{ id: string; orphan: OverrideOrphan }> = [];
  getOrphansMap(doc).forEach((orphan, id) => {
    if ((orphan as OverrideOrphan).astroSource === astroSource) out.push({ id, orphan: orphan as OverrideOrphan });
  });
  return out;
}

/** Yjs values can't be re-integrated under a new key — deep-clone Y types, pass scalars through. */
const cloneValue = (v: unknown): unknown => (v instanceof Y.AbstractType ? v.clone() : v);
const toPlain = (v: unknown): unknown => (v instanceof Y.AbstractType ? v.toJSON() : v);

/**
 * Two-phase rekey (collect → delete → set) so div-0↔div-1 swaps never clobber.
 *
 * EXPORTED for `store/placementKeyMigration.ts` (task-159), which faces the
 * same two hazards this was built for and must not re-solve them: a Yjs value
 * cannot be re-integrated under a new key without `.clone()` (task-118), and a
 * PERMUTATION — one move's target being another move's source — loses an entry
 * under a naive `set(new); delete(old)` loop. This is also the existing
 * sanctioned precedent for "an override's anchor moved in the source, so its
 * key is rewritten to follow it".
 */
export function rekeyYMap(map: Y.Map<unknown>, remap: Map<string, string>): void {
  const moves: Array<[string, string, unknown]> = [];
  map.forEach((v, k) => {
    const nk = remap.get(k);
    if (nk !== undefined && nk !== k) moves.push([k, nk, cloneValue(v)]);
  });
  for (const [k] of moves) map.delete(k);
  for (const [, nk, v] of moves) map.set(nk, v);
}

/**
 * Snapshot + delete every store entry held by an unmatched old selector.
 * MUST run BEFORE remapElementOverrides — a rekey landing on an unmatched
 * key would overwrite the data this snapshots. Only data-holding selectors
 * produce records (ledger #12); deletedSelectors are handled (dropped) by
 * remapElementOverrides, not orphaned (ledger #15).
 */
export function recordOrphans(doc: Y.Doc, astroSource: string, el: Y.Map<unknown>, r: SelectorRemap): void {
  const elId = el.get('id') as string;
  for (const u of r.unmatched) {
    const entries: OrphanEntry[] = [];
    for (const field of SELECTOR_KEYED_MAPS) {
      const map = el.get(field) as Y.Map<unknown> | undefined;
      const v = map?.get(u.selector);
      if (v === undefined) continue;
      entries.push({ store: field, key: u.selector, value: toPlain(v) });
      map!.delete(u.selector);
    }
    for (const store of ['sourceClasses', 'sourceText'] as const) {
      const m = doc.getMap(store);
      const k = `${elId}:${u.selector}`;
      const v = m.get(k);
      if (v === undefined) continue;
      entries.push({ store, key: k, value: toPlain(v) });
      m.delete(k);
    }
    if (entries.length === 0) continue;
    getOrphansMap(doc).set(generateId(), {
      astroSource,
      instanceId: elId,
      oldSelector: u.selector,
      ...(u.sqId ? { sqId: u.sqId } : {}),
      fingerprint: u.fingerprint,
      entries,
    });
  }
}

/**
 * Rewrite one element's selector-keyed override stores against a remap:
 * map keys rekeyed; array values (deletedSelectors/orderOverrides) and
 * renderOrderOverrides keys+values rewritten; sourceClasses/sourceText doc
 * entries (`${el.id}:${sel}`) rekeyed. Unmatched array values are dropped —
 * their target no longer exists (deletedSelectors: intent fulfilled, #15).
 */
export function remapElementOverrides(doc: Y.Doc, el: Y.Map<unknown>, r: SelectorRemap): void {
  const remap = r.remap;
  const gone = new Set(r.orphanCandidates);

  for (const field of SELECTOR_KEYED_MAPS) {
    const map = el.get(field) as Y.Map<unknown> | undefined;
    if (map) rekeyYMap(map, remap);
  }

  for (const field of ['deletedSelectors', 'orderOverrides'] as const) {
    const arr = el.get(field) as Y.Array<string> | undefined;
    if (!arr || arr.length === 0) continue;
    const next: string[] = [];
    let changed = false;
    for (const sel of arr.toArray()) {
      const nsel = remap.get(sel);
      if (nsel !== undefined) {
        next.push(nsel);
        if (nsel !== sel) changed = true;
      } else if (gone.has(sel)) {
        changed = true;
        console.info(`[SET_MASTER_MARKUP] ${field} target '${sel}' vanished from source — dropped (intent fulfilled)`);
      } else {
        next.push(sel); // foreign key (blogcard etc.) — untouched
      }
    }
    if (changed) {
      arr.delete(0, arr.length);
      if (next.length) arr.insert(0, next);
    }
  }

  const roo = el.get('renderOrderOverrides') as Y.Map<Y.Array<string>> | undefined;
  if (roo && roo.size > 0) {
    const rebuilt: Array<[string, string[] | null]> = [];
    roo.forEach((arr, k) => {
      const nk = remap.get(k) ?? (gone.has(k) ? null : k);
      if (nk === null) {
        rebuilt.push([k, null]); // parent vanished — entry meaningless
        return;
      }
      const values = arr.toArray()
        .map((sel) => remap.get(sel) ?? (gone.has(sel) ? null : sel))
        .filter((s): s is string => s !== null);
      rebuilt.push([k, null]);
      if (values.length) rebuilt.push([nk, values]);
    });
    // two-phase: delete every old key first, then set survivors
    for (const [k, v] of rebuilt) if (v === null) roo.delete(k);
    for (const [k, v] of rebuilt) {
      if (v === null) continue;
      const yArr = new Y.Array<string>();
      yArr.insert(0, v);
      roo.set(k, yArr);
    }
  }

  const elId = el.get('id') as string;
  for (const store of ['sourceClasses', 'sourceText'] as const) {
    const m = doc.getMap(store);
    const moves: Array<[string, string, unknown]> = [];
    m.forEach((v, k) => {
      if (!k.startsWith(elId + ':')) return;
      const sel = k.slice(elId.length + 1);
      const nsel = remap.get(sel);
      if (nsel !== undefined && nsel !== sel) moves.push([k, `${elId}:${nsel}`, cloneValue(v)]);
    });
    for (const [k] of moves) m.delete(k);
    for (const [, nk, v] of moves) m.set(nk, v);
  }
}

/**
 * Remap the masters entry's per-placement childOverrides (plain JSON).
 * Vanished data-holding subSelectors are orphaned as 'masters.childOverrides'.
 */
export function remapMasterChildOverrides(
  doc: Y.Doc,
  astroSource: string,
  entry: Y.Map<unknown>,
  r: SelectorRemap | undefined
): void {
  if (!r || r.identity) return;
  const all = entry.get('childOverrides') as Record<string, Record<string, unknown>> | undefined;
  if (!all) return;
  const gone = new Set(r.orphanCandidates);
  const byOldSelector = new Map(r.unmatched.map((u) => [u.selector, u]));
  let changed = false;
  const next: Record<string, Record<string, unknown>> = {};
  for (const [placementKey, bySel] of Object.entries(all)) {
    const nextSel: Record<string, unknown> = {};
    for (const [sel, v] of Object.entries(bySel)) {
      const nsel = remapOf(r.remap, gone, sel);
      if (nsel === null) {
        changed = true;
        const u = byOldSelector.get(sel)!;
        getOrphansMap(doc).set(generateId(), {
          astroSource,
          oldSelector: sel,
          ...(u.sqId ? { sqId: u.sqId } : {}),
          fingerprint: u.fingerprint,
          entries: [{ store: 'masters.childOverrides', key: `${placementKey}:${sel}`, value: v }],
        });
        continue;
      }
      if (nsel !== sel) changed = true;
      nextSel[nsel] = v;
    }
    if (Object.keys(nextSel).length > 0) next[placementKey] = nextSel;
    else changed = true;
  }
  if (changed) entry.set('childOverrides', next);
}

const remapOf = (remap: Map<string, string>, gone: Set<string>, sel: string): string | null =>
  remap.get(sel) ?? (gone.has(sel) ? null : sel);
