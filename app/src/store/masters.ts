/**
 * The `masters` Yjs map — the durable in-app home for a component master's
 * edited markup, keyed by astroSource (component file path). An OVERLAY: when
 * present it wins; otherwise an instance's frozen staticMarkup is the fallback.
 * This removes the dev .astro source round-trip (see
 * docs/archive/plans/2026-06-16-unified-component-model-design.md §6).
 */
import * as Y from 'yjs';
import { addDataKeysToHtml } from './constants';
import { applyChildOverrideClasses } from '@/utils/childOverrideClasses';
import { collapseInlinedChildren, resetPaginationSlot } from '@/utils/collapseInlinedChildren';

export const MASTERS_MAP = 'masters';

/** placementKey → selector → breakpoint → full token set (replace semantics, same as resolveOverrideClasses) */
export type MasterChildOverrides = Record<string, Record<string, Record<string, string[]>>>;

/** The plain (JSON) shape persisted with the project: `{ [astroSource]: { markup, childOverrides? } }`. */
export type MastersData = Record<string, { markup: string; childOverrides?: MasterChildOverrides; rev?: number }>;

/**
 * Resolve an instance selector's classes from its base + override. The override
 * is the FULL intended class set, so when one exists it REPLACES the base
 * (never a union) — that is why a deleted class stays deleted (task-082). A
 * present-but-empty override means the user cleared every class → ''. `null`
 * tokens means no override at all → fall back to the base. The single decision
 * shared by getClassesFromYjs and the live iframe sync.
 */
export function resolveOverrideClasses(baseClasses: string, overrideTokens: string[] | null): string {
  if (overrideTokens === null) return baseClasses;
  return overrideTokens.join(' ');
}

/** masters[astroSource] = { markup, fields? } */
/** Markup revision for the ↻ axis — bumped by every REAL SET_MASTER_MARKUP change. 0 = never baked. */
export function readMasterMarkupRev(doc: Y.Doc, astroSource: string): number {
  const entry = doc.getMap(MASTERS_MAP).get(astroSource) as Y.Map<unknown> | undefined;
  return (entry?.get('rev') as number) ?? 0;
}

/** ↻ markup axis: the master design moved after this element's last override
 *  write (stampMasterBaseRev in commands.ts). Coarse by design — no
 *  per-selector conflict check. Caller gates on hasLocalOverrides. */
export function isMasterMarkupOutdated(doc: Y.Doc, yEl: Y.Map<unknown>): boolean {
  const astroSource = yEl.get('astroSource') as string | undefined;
  if (!astroSource) return false;
  return readMasterMarkupRev(doc, astroSource) > ((yEl.get('masterBaseRev') as number) ?? 0);
}

export function selectMasterMarkup(doc: Y.Doc, astroSource: string): string | undefined {
  const entry = doc.getMap(MASTERS_MAP).get(astroSource) as Y.Map<unknown> | undefined;
  return entry?.get('markup') as string | undefined;
}

/** Per-placement child overrides stored on masters[astroSource] (empty object when none). */
export function selectMasterChildOverrides(doc: Y.Doc, astroSource: string): MasterChildOverrides {
  const entry = doc.getMap(MASTERS_MAP).get(astroSource) as Y.Map<unknown> | undefined;
  return (entry?.get('childOverrides') as MasterChildOverrides | undefined) ?? {};
}

// Layering + re-stamping produce NEW strings each call; callers that memoize
// on identity (canvas render path) would re-render forever, and the layering
// runs DOMParser. Cache the final output per element id, keyed on the INPUTS'
// identities: the base markup string (replaced wholesale by SET_MASTER_MARKUP /
// UPDATE_STATIC_MARKUP) and the per-placement overrides object (replaced
// wholesale by SET_MASTER_CHILD_OVERRIDES; untouched placements keep their
// reference through the spread). A cache hit skips both DOMParser and the
// re-stamp — the hot canvas path pays two map gets.
// ponytail: per-id last-value cache, fine since one element renders one markup.
const stampCache = new Map<string, { base: string; ov: object | undefined; out: string }>();

function memoized(id: string | undefined, base: string, ov: object | undefined, make: () => string): string {
  if (!id) return make();
  const cached = stampCache.get(id);
  if (cached && cached.base === base && cached.ov === ov) return cached.out;
  const out = make();
  stampCache.set(id, { base, ov, out });
  return out;
}

/**
 * Placement key of a nested-component child: explicit placementKey, else the
 * slotName (slot-fallback children). THE shared derivation — masters layering,
 * the flush mirror, and push/reset all key childOverrides with it.
 */
export function placementKeyOf(el: Y.Map<unknown>): string {
  return (((el.get('placementKey') as string) || (el.get('slotName') as string)) || '').trim();
}

/**
 * Child of a component placement: the parent master's per-placement child
 * overrides layer between the child's own master base and its instance
 * overrides. Returns undefined when the element isn't such a child or the
 * parent has no entry for its placement key.
 */
function parentChildOverridesFor(doc: Y.Doc, el: Y.Map<unknown>): Record<string, Record<string, string[]>> | undefined {
  const parentId = el.get('parentId') as string | null | undefined;
  if (!parentId) return undefined;
  const parent = doc.getMap('elements').get(parentId) as Y.Map<unknown> | undefined;
  const parentSource = parent?.get('astroSource') as string | undefined;
  if (!parentSource) return undefined;
  const key = placementKeyOf(el);
  if (!key) return undefined;
  const overrides = selectMasterChildOverrides(doc, parentSource)[key];
  return overrides && Object.keys(overrides).length > 0 ? overrides : undefined;
}

/** The single base-markup rule every render path uses (overlay → fallback). */
export function baseMarkup(doc: Y.Doc, el: Y.Map<unknown>): string {
  const astroSource = el.get('astroSource') as string | undefined;
  const fromMaster = astroSource ? selectMasterMarkup(doc, astroSource) : undefined;
  // Parent childOverrides layer onto BOTH the overlay and the staticMarkup
  // fallback — a child whose master was never edited still receives layering.
  const parentOverrides = parentChildOverridesFor(doc, el);
  const id = el.get('id') as string | undefined;
  if (fromMaster !== undefined) {
    // The masters overlay is SHARED by every placement of a component. The baked
    // markup carries whatever single instance's data-keys were captured at bake
    // time (editor element or the pushing placement). Re-stamp THIS element's id
    // so two placements never collide on identical data-keys — addDataKeysToHtml
    // strips the baked-in keys before re-stamping. Without this, the iframe scan
    // sees duplicate keys → isInstanceRootKey miscounts → selection/delete break.
    return memoized(id, fromMaster, parentOverrides, () => {
      const layered = applyChildOverrideClasses(fromMaster, parentOverrides);
      return id ? addDataKeysToHtml(layered, (sel) => `${id}:${sel}`) : layered;
    });
  }
  const frozen = (el.get('staticMarkup') as string | undefined) ?? '';
  if (!parentOverrides) return frozen;
  // Fallback path with layering: keys are already stamped in the frozen copy
  // (addKeysToMarkup at ADD_ELEMENT) — no re-stamp needed.
  return memoized(id, frozen, parentOverrides, () => applyChildOverrideClasses(frozen, parentOverrides));
}

/** Serialize the masters map to its plain persisted shape, or undefined when empty (lazy seeding). */
export function serializeMasters(doc: Y.Doc): MastersData | undefined {
  const masters = doc.getMap(MASTERS_MAP);
  if (masters.size === 0) return undefined;
  const out: MastersData = {};
  masters.forEach((entry, astroSource) => {
    const markup = (entry as Y.Map<unknown>).get('markup') as string | undefined;
    if (markup === undefined) return;
    out[astroSource] = { markup };
    const childOverrides = (entry as Y.Map<unknown>).get('childOverrides') as MasterChildOverrides | undefined;
    if (childOverrides && Object.keys(childOverrides).length > 0) out[astroSource].childOverrides = childOverrides;
    const rev = (entry as Y.Map<unknown>).get('rev') as number | undefined;
    if (typeof rev === 'number' && rev > 0) out[astroSource].rev = rev; // ↻ axis survives reload
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Clear the masters map and rebuild it from persisted data (absent data =
 * stays empty). Runs once per project hydrate — the single MIGRATION point for
 * legacy masters whose markup still carries inlined child HTML
 * (data-sq-component-src markers): each marker-rooted subtree collapses to an
 * <sq-child> placeholder, and a root-class divergence from the child's own
 * masters entry is preserved as a childOverrides patch (existing keys win).
 * Children with no sibling masters entry collapse without a diff — pre-masters
 * edits routed to .astro writes and cannot be diffed here (accepted, warned).
 */
export function rebuildMasters(doc: Y.Doc, data: MastersData | undefined): void {
  const masters = doc.getMap(MASTERS_MAP);
  masters.forEach((_, key) => masters.delete(key));
  if (!data) return;

  // childBases for the migration diff: every OTHER entry's markup, path-keyed.
  const childBases = new Map<string, string>();
  for (const [astroSource, entry] of Object.entries(data)) {
    if (entry && typeof entry.markup === 'string') childBases.set(astroSource, entry.markup);
  }

  for (const [astroSource, entry] of Object.entries(data)) {
    if (!entry || typeof entry.markup !== 'string') continue;
    let markup = entry.markup;
    let childOverrides: MasterChildOverrides | undefined =
      entry.childOverrides && typeof entry.childOverrides === 'object' && Object.keys(entry.childOverrides).length > 0
        ? entry.childOverrides
        : undefined;

    // Settings-driven pagination chrome must never live in master markup —
    // old-era bakes inlined it and it painted regardless of the setting.
    const paginationReset = resetPaginationSlot(markup);
    if (paginationReset.changed) {
      markup = paginationReset.markup;
      console.warn(`[masters-migrate] reset settings-driven pagination slot in ${astroSource}`);
    }

    if (markup.includes('data-sq-component-src')) {
      const collapsed = collapseInlinedChildren(markup, childBases);
      markup = collapsed.markup;
      for (const [placementKey, patch] of Object.entries(collapsed.patches)) {
        // Existing keys win — never clobber newer data with a migration diff.
        if (childOverrides?.[placementKey]) continue;
        childOverrides = { ...(childOverrides ?? {}), [placementKey]: patch };
        console.warn(`[masters-migrate] collapsed child in ${astroSource}; root class diff → childOverrides[${placementKey}]`);
      }
    }

    const m = new Y.Map();
    m.set('markup', markup);
    if (childOverrides) m.set('childOverrides', childOverrides);
    if (typeof entry.rev === 'number' && entry.rev > 0) m.set('rev', entry.rev);
    masters.set(astroSource, m);
  }
}
