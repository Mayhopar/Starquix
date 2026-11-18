/**
 * task-149 review fix (owner ruling 2026-08-03): the instance lifecycle chrome
 * (`↗` go-to-source + the `⋮` Push/Reset menu) belongs to the PLACEMENT ROOT
 * only — the outermost element a component invocation rendered.
 *
 * Server/WC mode already behaves that way for free: only the instance ROOT key
 * (`el-…`) is `isInstanceRoot`, and its children are `instance-child` keys that
 * get the `*` divergence marker and nothing else. Local mode had no equivalent
 * signal, so `DesignBar` derived the cluster from the key's FILE PATH alone —
 * which is true for every element inside the component, and the `↗`/`⋮` showed
 * up on all of them.
 *
 * The placement segment task-149 added is the missing signal. An element is the
 * root of its placement when its nearest source-keyed ancestor belongs to a
 * DIFFERENT (file, placement) pair — i.e. the component boundary is between
 * them. Both halves of the pair are load-bearing:
 *
 *   - `file` catches the degenerate invocation the tagger cannot hash (a
 *     component reached through a computed expression inherits its caller's
 *     placement, so only the file changes at the boundary).
 *   - `placement` catches a component nested inside ITSELF (`<Wrapper><Wrapper>`),
 *     where the file is the same on both sides of the boundary.
 *
 * Pure data-in/data-out over the scan tree, so it is unit-testable without an
 * iframe. No-op outside local mode: WC/server keys carry no placement segment
 * and their instance chrome never routed through here.
 */
import { parseKey } from '@/store/types';

/** The one field this derivation needs off a scanned element. */
export interface PlacementAncestryNode {
  parentKey?: string | null;
}

/**
 * Is `key` the outermost element of its component placement?
 *
 * `false` for anything that is not a source key (drawn elements, instance
 * children, dynamic keys) — those have their own chrome rules.
 *
 * An element with no source-keyed ancestor at all IS a root: nothing above it
 * can own it. That covers a layout's `<html>` as well as any scan whose tree
 * did not reach the DesignBar (the tests' single-element maps).
 */
export function isPlacementRoot(
  key: string | null | undefined,
  scannedByKey: ReadonlyMap<string, PlacementAncestryNode>,
): boolean {
  if (!key) return false;
  const self = parseKey(key);
  if (self?.type !== 'source') return false;

  const seen = new Set<string>([key]);
  let cursor = scannedByKey.get(key)?.parentKey ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = parseKey(cursor);
    if (parent?.type === 'source') {
      return parent.file !== self.file || parent.placement !== self.placement;
    }
    // A dynamic / untracked wrapper (e.g. a component root spreading
    // `{...Astro.props}`, which the tagger's regex cannot stamp) is transparent
    // — keep walking rather than reading it as a component boundary.
    cursor = scannedByKey.get(cursor)?.parentKey ?? null;
  }
  return true;
}
