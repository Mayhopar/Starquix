/**
 * task-159 — move stored overrides from the LEGACY placement address to the
 * STRUCTURAL one, driven by the live scan.
 *
 * Until task-159 a placement id hashed `<file>:<line>:<col>` of the authored
 * invocation, so inserting a line above a `<SiteNav/>` handed that nav its
 * neighbour's id and the neighbour's overrides came with it — a silent, visible
 * transplant (reproduced on real `astro dev` bytes; see the ledger). Identity is
 * now `<file>|<import specifier><member>#<ordinal>`, prefixed `q` instead of
 * `p`, so an outstanding override stored under the old key must be carried over
 * or the user loses work they can still see.
 *
 * task-160 stamps the identity into the user's own source (`data-sq-id`), so
 * there is now a THIRD scheme and two legacy ones. The tagger emits all three
 * chains for the migration window (`data-sq-p` carries `"<s-id> <q-id> <p-id>"`
 * in ONE prop), the bridge composes `legacyKeys` beside `key`, most recent
 * first, and this module is the only thing that rewrites an override's
 * address.
 *
 * FOUR RULES, all of them load-bearing:
 *
 *  1. **Never purge.** An unmatched legacy key is left exactly where it is.
 *     `store/placementMigration.ts` was deleted for sweeping keys it believed
 *     stale and it destroyed live user data — a page file's own elements scan
 *     BARE by design, and so does a component reached through a computed
 *     expression. Purging can only destroy live data; keeping can only leave
 *     dead data. (`hooks/__tests__/placementStorageMigration.test.ts`)
 *
 *  2. **Move, don't copy.** The legacy address is deleted ONLY in the same
 *     transaction that proved the same value written at the new address, driven
 *     by a LIVE element asserting the correspondence. Leaving a copy behind
 *     means a later shift can hand that address to a DIFFERENT element, which
 *     would re-create the transplant this work removes.
 *
 *  3. **Permutation-safe.** The reported defect's own shape is that one nav's
 *     new id IS another nav's old id, so a sequential `set(new); delete(old)`
 *     loop loses an entry. Both hazards (that, and Yjs values not being
 *     re-integratable under a new key) are already solved by `rekeyYMap`.
 *
 *  4. **All four tiers.** `SOURCE_OVERRIDE_MAP_NAMES` is THE list, and its own
 *     comment says a map that does not join it silently escapes every sweep —
 *     `sourceLinkAttributes` included.
 */
import * as Y from 'yjs';
import { rekeyYMap } from './overrideOrphans';
import { SOURCE_OVERRIDE_MAP_NAMES } from './sourceOverrideEntries';
import { parseKey } from './types';

/** The shape this needs off a scanned element — nothing more. */
export interface PlacementMigrationElement {
  key: string;
  /**
   * The same element's key under each TRANSITIONAL placement chain, MOST
   * RECENT FIRST (task-159's `q…` ordinal chain, then the original `p…`
   * coordinate chain). Absent for a bare key or outside local mode.
   *
   * task-160 — a LIST, not a single key, because a user's outstanding work can
   * predate either scheme and eager stamping means the stamp lands BEFORE the
   * first scan ever runs: there is no intermediate scan at which a `p…` key
   * could have become a `q…` key. Walking the list and taking the first tier
   * that has a stored value migrates p→s and q→s each in ONE hop, with no
   * transitive replay through an address nothing was ever stored at.
   */
  legacyKeys?: readonly string[];
}

/**
 * Build the legacy → current address map the scan asserts.
 *
 * Only source keys carrying a placement segment participate: instance keys
 * (`el-…`, `el-…:h1-0`), drawn keys, `dynamic:` keys and bare page-file keys
 * are never legacy addresses and must be untouchable by the planner.
 */
/** One element's current address plus its superseded ones, MOST RECENT FIRST. */
interface Candidate {
  to: string;
  from: string[];
}

function planMoves(elements: readonly PlacementMigrationElement[]): Candidate[] {
  const out: Candidate[] = [];
  const claimed = new Set<string>();
  const offered = new Set<string>();
  for (const el of elements) {
    if (!el.key || claimed.has(el.key)) continue;
    const to = parseKey(el.key);
    if (to?.type !== 'source' || !to.placement) continue;
    const from: string[] = [];
    for (const legacy of el.legacyKeys ?? []) {
      if (!legacy || legacy === el.key || offered.has(legacy)) continue;
      const parsed = parseKey(legacy);
      if (parsed?.type !== 'source') continue;
      // Both halves must be a real placement address, and the ELEMENT half must
      // agree — a move across files would mean the scan is describing two
      // different elements.
      if (!parsed.placement) continue;
      if (parsed.file !== to.file || parsed.line !== to.line || parsed.col !== to.col) continue;
      from.push(legacy);
    }
    if (from.length === 0) continue;
    // First writer wins, deterministically in scan order. Two elements offering
    // the same legacy address cannot happen (every chain is computed over the
    // same tree, so they partition it identically) — but if it ever did,
    // silently merging two users' edits is the worse outcome.
    for (const f of from) offered.add(f);
    claimed.add(el.key);
    out.push({ to: el.key, from });
  }
  return out;
}

/**
 * Narrow the plan to what THIS tier can actually do, then hand it to the
 * existing two-phase rekey.
 *
 * A target that is already occupied is left alone — UNLESS its occupant is
 * itself moving away in this same plan, which is exactly the permutation case.
 */
function planForTier(map: Y.Map<unknown>, moves: readonly Candidate[]): Map<string, string> {
  // task-160 — resolve each element's tier list INSIDE this map, in order: the
  // most recent superseded address that actually holds a value wins. Resolving
  // globally would let an older tier overwrite a newer one, because both are
  // legitimate addresses for the same element and a flat map has no order.
  const chosen: Array<[string, string]> = [];
  for (const c of moves) {
    const hit = c.from.find((f) => map.has(f));
    if (hit !== undefined) chosen.push([hit, c.to]);
  }

  const vacating = new Set(chosen.map(([legacy]) => legacy));

  const tierPlan = new Map<string, string>();
  for (const [legacy, next] of chosen) {
    if (map.has(next) && !vacating.has(next)) continue;   // occupied by a stranger
    tierPlan.set(legacy, next);
  }
  return tierPlan;
}

/**
 * Rewrite every stored override addressed by a legacy placement onto its
 * current address. Idempotent: a second scan finds nothing left to move.
 *
 * Runs with the `'sync'` transaction origin and takes NO undo snapshot — this
 * is the same data at a new address, not an edit the user made.
 *
 * @returns how many entries moved, across all tiers (0 = no-op).
 */
export function migratePlacementKeys(
  doc: Y.Doc,
  elements: readonly PlacementMigrationElement[],
): number {
  const moves = planMoves(elements);
  if (moves.length === 0) return 0;

  let moved = 0;
  const plans: Array<[Y.Map<unknown>, Map<string, string>]> = [];
  for (const name of SOURCE_OVERRIDE_MAP_NAMES) {
    const map = doc.getMap(name) as Y.Map<unknown>;
    if (map.size === 0) continue;
    const tierPlan = planForTier(map, moves);
    if (tierPlan.size === 0) continue;
    plans.push([map, tierPlan]);
    moved += tierPlan.size;
  }
  if (moved === 0) return 0;

  doc.transact(() => {
    for (const [map, tierPlan] of plans) rekeyYMap(map, tierPlan);
  }, 'sync');

  return moved;
}
