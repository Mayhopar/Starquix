/**
 * task-148 item 7 — SELECT THE USAGE.
 *
 * THE PROBLEM (the affirmative half of the 2026-08-02 data-loss incident):
 * local mode renders a page's components INLINE, so every scanned element inside
 * `<Card />` carries `src/components/Card.astro` as its source file. Pressing
 * Delete on the rendered card therefore aimed at the COMPONENT, and before the
 * write-scope law that gutted `Header.astro`/`Back.astro` for every page.
 *
 * The law (`utils/localWriteScope.ts`) stopped the damage by refusing the write.
 * It could not give the user what they actually meant — "remove this card from
 * THIS page" — because the thing that means is the `<Card />` USAGE TAG in the
 * page file, and nothing on the canvas addressed it.
 *
 * THIS module is that address, and the ONE place the rule is expressed.
 *
 * ── Where the address comes from ──────────────────────────────────────────
 * NOT derived. `sq-tagging.js` computes `<placing file>:<line>:<col>` for every
 * invocation at compile time (it always did — it was hashing it into the `p…`
 * chain and discarding it) and now carries it verbatim as field 3 of
 * `data-sq-p`, rendered as `data-sq-usage` on every tagged element. The bridge
 * parses it with the same parser as `data-sq-source`, because it is deliberately
 * the same grammar. So the usage is an ORDINARY source location and every
 * existing writer, scope guard and undo op handles it with no special case.
 *
 * Ordinal counting, DOM-order matching and hash inversion were all rejected:
 * deriving placement identity is the exact bug task-159/160 spent a month
 * removing, and its symptom is an edit landing on the neighbouring component.
 *
 * ── The design decision this encodes ──────────────────────────────────────
 * There is NO "usage vs inner element" prompt. From a page view, "delete this
 * card" has one sensible meaning, because the other reading is the one we
 * refuse. A picker would make the user resolve an ambiguity that does not
 * exist. So structural ops RE-TARGET silently, and the obligation is to NAME
 * the target (DesignBar/Layers already label the component root), not to ask.
 *
 * This is strictly additive: every case it retargets is a case that is REFUSED
 * today, so nothing that works can regress. Ledger with all 31 enumerated
 * states: ../../docs/archive/plans/2026-08-10-task-148-usage-selection-ledger.md
 *
 * ── What it must never do ─────────────────────────────────────────────────
 * Weaken the cross-file default-deny. It does not touch it. It sits ABOVE the
 * guard and hands the gesture a target the guard already permits — a tag in the
 * current surface file. Every case where no such tag exists (a component placed
 * by a LAYOUT, a component nested in another component, an untaggable
 * invocation) still hits exactly the refusal it hits today.
 */
import type { SourceLocation } from '@/bridge/types';
import { isPlacementRoot, type PlacementAncestryNode } from '@/components/DesignBar/placementRoot';
import { classifyLocalWriteTarget } from './localWriteScope';

/** The fields this derivation needs off a scanned element. */
export interface UsageTargetNode extends PlacementAncestryNode {
  sourceLocation?: SourceLocation;
  usageLocation?: SourceLocation;
}

/**
 * The `<Component />` tag to write instead of `key`, or `null` to leave the
 * gesture exactly as it is today.
 *
 * All five conjuncts are load-bearing:
 *
 *  1. the element is known to the scan — otherwise there is nothing to reason
 *     about and the caller's existing refusal is the honest answer;
 *  2. its own file is NOT the current surface — a same-file element is already
 *     writable and must keep aiming at itself. This is what keeps a component's
 *     SLOT CONTENT (`<p>Card body</p>`, authored in the page) deleting itself
 *     rather than removing the whole card, and what keeps the component view's
 *     master edits pointed at the master;
 *  3. it is the outermost element the invocation rendered — an inner `<h3>`
 *     cannot be "removed from this page only", so it stays refused;
 *  4. a usage location exists — absent for an untaggable invocation or a
 *     placement the tagger warned it could not hash. Fail closed;
 *  5. the usage lives in the CURRENT surface file — a `<Card />` placed by a
 *     layout, or by another component, is cross-file for a page view and stays
 *     refused with the existing toast naming that file.
 *
 * `pageFile` is passed explicitly (never read from module state) so callers that
 * captured the surface at gesture time — the deferred-write rule of task-181 —
 * can pass what they captured rather than where the user is now.
 */
export function resolveLocalUsageTarget(
  key: string | null | undefined,
  scannedByKey: ReadonlyMap<string, UsageTargetNode> | undefined,
  pageFile: string | null,
): SourceLocation | null {
  // A caller with no scan tree (or no surface) gets no re-target — the op then
  // behaves exactly as it did before this feature existed.
  if (!key || !pageFile || !scannedByKey) return null;

  const node = scannedByKey.get(key);
  if (!node) return null; // (1)

  // (2) — an element that is already writable keeps aiming at itself.
  if (classifyLocalWriteTarget(node.sourceLocation?.file, pageFile) === 'same-file') return null;

  if (!isPlacementRoot(key, scannedByKey)) return null; // (3)

  const usage = node.usageLocation;
  if (!usage) return null; // (4)

  // (5) — the usage must be in the surface we are allowed to write.
  if (classifyLocalWriteTarget(usage.file, pageFile) !== 'same-file') return null;

  return usage;
}
