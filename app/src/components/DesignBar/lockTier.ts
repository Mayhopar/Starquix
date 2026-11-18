/**
 * Imported-adoption phase 0 (design ledger L1–L3): per-element editability,
 * derived at selection time from facts the parent already holds. Rendered as
 * the SelectionOverlay badge — the honesty layer for imported/local projects,
 * where cross-file class/text/image writes silently resolve false and ride a
 * doc overlay that does NOT persist across sessions for `local_` ids.
 *
 * Tier semantics (binding, from the phase-0 plan):
 *   - `full`    — edits persist to the file the user is looking at
 *                 (tracked AND (not local mode OR same-file target));
 *   - `limited` — structural ops on the usage tag work; edits INSIDE won't
 *                 persist to disk in local mode (the five conjuncts of
 *                 resolveLocalUsageTarget hold);
 *   - `locked`  — nothing writable (untracked / unscanned / cross-file
 *                 without a usage on the surface).
 *
 * Pure function, no context reads. The scope law is REUSED from
 * `utils/localWriteScope.ts` and the limited conjuncts from
 * `utils/localUsageTarget.ts` — a lookalike is forbidden (parity law).
 * Fail closed: any unknown input is `locked` (L1 — a wrong ✏️ is worse than
 * a wrong 🔒). v1 merges `react-island` into `not-tracked` (no parent-side
 * island signal exists); AST-shape refusals stay write-time toasts.
 */
import type { ScannedElement } from '@/context/SelectionContext';

export interface LockTierInput {
  element: ScannedElement | null;
  isLocalMode: boolean;
}

export interface LockTierResult {
  tier: 'full' | 'locked';
  reason?: 'not-scanned' | 'not-tracked';
}

export function deriveLockTier(input: LockTierInput): LockTierResult {
  const { element, isLocalMode } = input;
  // Off the local runtime every edit is doc-native; a lock badge would lie.
  if (!isLocalMode) return { tier: 'full' };
  if (!element) return { tier: 'locked', reason: 'not-scanned' };
  // No source position = nothing to write back to. Everything else is
  // editable: a cross-file element is an INSTANCE edit from a page view
  // (Figma model, 2026-09-10) — the old "different file = locked" rule
  // predated that and only ever drew a false badge (2026-09-14).
  if (!element.hasSourceTracking || !element.sourceLocation) return { tier: 'locked', reason: 'not-tracked' };
  return { tier: 'full' };
}

/** Badge copy. `null` = no badge (full tier). */
export function lockLabel(result: LockTierResult): string | null {
  if (result.tier === 'full') return null;
  return result.reason === 'not-scanned' ? 'Scanning…' : 'Not editable — open in code';
}

/** key → locked? Same rule as the badge; used for multi-select membership
 *  (a locked element can't be styled, deleted or moved — design ledger A14). */
export function lockedKeyPredicate(byKey: ReadonlyMap<string, ScannedElement>, isLocalMode: boolean): (key: string) => boolean {
  return key => deriveLockTier({ element: byKey.get(key) ?? null, isLocalMode }).tier === 'locked';
}
