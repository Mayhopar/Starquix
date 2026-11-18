/**
 * task-133 Task 5: "select this element after the next scan" for local-mode
 * structural inserts.
 *
 * Mirrors ViewportFrame's pendingSelectRef precedent (sq:pending-select →
 * consumed in viewportMessages/scanning.ts) but lives at module level: the
 * setter runs in Editor's insert flow, not inside a ViewportFrame instance,
 * and the existing ref-based mechanism neither restricts matches to the exact
 * line nor clears when unmatched — both required here (carry-forward b).
 *
 * Semantics: ONE pending at a time; the first ELEMENTS_SCANNED whose keys
 * cover the inserted file consumes it — matched or not — so a component that
 * never surfaces its own key (no Astro.props spread → no data-sq-source on
 * its root) can't leave a sticky pending that later grabs an unrelated
 * element at that line. Scans of other surfaces leave it untouched.
 */
import { matchPredictedKey, predictSelectionKey } from './localStructural';
import type { SourceLocation } from '@/bridge';
import { getActiveSaveProjectGeneration, getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { getLocalAcceptedSourceLocation, getLocalSurfaceGeneration } from './localPageSync';

export interface LocalPendingSelection {
  /** Project-relative file the insert landed in. */
  file: string;
  /** `file:line:` prefix from predictSelectionKey. */
  predicted: string;
  projectId?: string;
  projectGeneration?: number;
  surfaceGeneration?: number;
  sourceLocation?: SourceLocation;
  /** getSelectionEpoch() when the gesture began. */
  selectionEpoch?: number;
}

let pending: LocalPendingSelection | null = null;

// The user's newest selection wins (e2e A2 2026-11-10, log-proven: ⌘D's pending
// resolved after Escape + a click on another element, re-selected the copy, and
// Backspace deleted the copy). SelectionContext bumps this whenever the selected
// key changes; a gesture's pending applies only if nothing re-selected since it began.
let selectionEpoch = 0;
export function noteSelectionChanged(): void { selectionEpoch++; }
export function getSelectionEpoch(): number { return selectionEpoch; }

/** `sinceEpoch` = getSelectionEpoch() at the gesture's start: a gesture the user
 *  re-selected past sets nothing (and never clears a newer gesture's pending). */
export function setLocalPendingSelection(file: string, insertedLine: number, sinceEpoch?: number): void {
  if (sinceEpoch !== undefined && sinceEpoch !== selectionEpoch) return;
  const projectId = getActiveSaveProjectId();
  pending = { file, predicted: predictSelectionKey(file, insertedLine), ...(sinceEpoch !== undefined ? { selectionEpoch: sinceEpoch } : {}), ...(projectId ? {
    projectId, projectGeneration: getActiveSaveProjectGeneration(), surfaceGeneration: getLocalSurfaceGeneration(),
    sourceLocation: getLocalAcceptedSourceLocation(projectId, file, insertedLine),
  } : {}) };
}

/** A pending the user re-selected past is gone: no reader can apply it. */
export function peekLocalPendingSelection(): LocalPendingSelection | null {
  if (pending?.selectionEpoch !== undefined && pending.selectionEpoch !== selectionEpoch) pending = null;
  return pending;
}

export function clearLocalPendingSelection(): void {
  pending = null;
}

/**
 * Pure matcher for one scan. `consumed` = the scan covered `p.file` (caller
 * must then clear the pending, match or not). `key` = the fresh key at the
 * EXACT predicted line (never ±1 — carry-forward b), instance copies skipped.
 */
export function resolveLocalPendingMatch(
  p: LocalPendingSelection,
  freshKeys: string[]
): { key: string | null; consumed: boolean } {
  const covers = freshKeys.some((k) => k.startsWith(`${p.file}:`));
  if (!covers) return { key: null, consumed: false };
  return { key: matchPredictedKey(p.predicted, freshKeys, { exactLineOnly: true }), consumed: true };
}

/** Resolve the accepted insertion through later edits, never through a
 * neighboring line. A component root may expose its page address as usage. */
export async function resolveOwnedLocalPendingMatch(p: LocalPendingSelection,
  elements: Array<{ key: string; sourceLocation?: SourceLocation; usageLocation?: SourceLocation }>,
  projectId: string | undefined, scanRevision: number): Promise<{ key: string | null; consumed: boolean }> {
  if (p.projectId && (p.projectId !== projectId || p.projectGeneration !== getActiveSaveProjectGeneration() || p.surfaceGeneration !== getLocalSurfaceGeneration())) return { key: null, consumed: true };
  if (!p.sourceLocation || !p.projectId) return resolveLocalPendingMatch(p, elements.map(el => el.key));
  const covers = elements.some(el => el.sourceLocation?.file === p.file || el.usageLocation?.file === p.file);
  if (!covers) return { key: null, consumed: false };
  try {
    const { resolveProjectedSourceLocation } = await import('@/services/durableEdits/sourceIdentity');
    const location = await resolveProjectedSourceLocation(p.projectId, p.sourceLocation, p.sourceLocation.sourceRevision, scanRevision);
    if (p.projectGeneration !== getActiveSaveProjectGeneration() || p.surfaceGeneration !== getLocalSurfaceGeneration()) return { key: null, consumed: true };
    const match = elements.find(el => !/#\d+$/.test(el.key) && [el.sourceLocation, el.usageLocation].some(loc =>
      loc?.file === location.file && loc.line === location.line && loc.column === location.column));
    return { key: match?.key ?? null, consumed: true };
  } catch { return { key: null, consumed: true }; }
}
