// Group move for any-layer multi-selections (task-076 Phase D).
//
// planGroupMove is PURE: scanned elements in (scan order == DOM order),
// reparent ops + final child order out. executeGroupMove REUSES the real
// single-drag primitives via injected deps (Editor.reparentElement,
// useReorderElements.*ByKeys) — never a parallel move system, and exactly
// ONE takeSnapshot per group move.
// Design: docs/archive/plans/2026-06-13-multi-select-any-layer-design.md §4.
import type { ScannedElement } from '@/context/SelectionContext';
import { parseKey } from './types';
import { isInstanceRootKey } from './keyKind';
import { pruneDescendants } from './multiSelect';

export interface GroupMoveTarget {
  /** Literal scanned parentKey of the drop container; null = page roots.
   *  Roots may also be scanned under the infra wrapper key — the planner is
   *  literal about whatever it receives; the caller routes the final order
   *  (Editor handleDragEnd checks isWrapperKey). */
  parentKey: string | null;
  insertIndex: number;
}

export interface PlannedReparent {
  key: string;
  newParentKey: string | null;
  insertIndex: number;
  currentParentKey: string | null;
  currentSiblingKeys: string[];
}

export interface GroupMovePlan {
  reparents: PlannedReparent[];
  finalOrder: { parentKey: string | null; orderedKeys: string[] } | null;
  /** Members that can't make this move (instance children leaving their
   *  instance) — reported via onSkipped, never silently dropped. */
  skipped: string[];
}

interface PlanArgs {
  /** Primary + extras, any order — the planner re-sorts by scan order. */
  groupKeys: string[];
  target: GroupMoveTarget;
  scannedElements: ScannedElement[];
}

export function planGroupMove({ groupKeys, target, scannedElements }: PlanArgs): GroupMovePlan {
  const byKey = new Map(scannedElements.map((el) => [el.key, el]));
  const getParent = (k: string) => byKey.get(k)?.parentKey;

  // 1. Prune descendants — children ride with their moving ancestor.
  const pruned = pruneDescendants(groupKeys.map((key) => ({ key, elementId: null })), getParent)
    .map((e) => e.key);

  // 2. Order members by scan order (== DOM order == Layers order), so the
  //    block lands in visual order regardless of click order.
  const scanIndex = new Map(scannedElements.map((el, i) => [el.key, i]));
  const ordered = [...pruned].sort((a, b) => (scanIndex.get(a) ?? 0) - (scanIndex.get(b) ?? 0));

  // 3. Capability: an instance child (non-root) may only stay inside its
  //    own instance — leaving it has no Yjs representation.
  const movable: string[] = [];
  const skipped: string[] = [];
  for (const key of ordered) {
    const parsed = parseKey(key);
    if (parsed?.type === 'instance-child'
      && !isInstanceRootKey(key, parsed.instanceId, scannedElements)) {
      const targetParsed = target.parentKey ? parseKey(target.parentKey) : null;
      const staysInside = targetParsed != null && targetParsed.type !== 'source'
        && targetParsed.instanceId === parsed.instanceId;
      if (!staysInside) {
        skipped.push(key);
        continue;
      }
    }
    movable.push(key);
  }
  if (movable.length === 0) return { reparents: [], finalOrder: null, skipped };

  // 4. Current children of the target parent, scan order.
  const currentChildren = scannedElements
    .filter((el) => el.parentKey === target.parentKey)
    .map((el) => el.key);

  // 5. Members not already under the target parent → reparent ops. The block
  //    is contiguous: each foreigner's insertIndex is its slot within the
  //    final block position (kept children before the drop point + offset).
  const memberSet = new Set(movable);
  const keptBefore = currentChildren.slice(0, target.insertIndex)
    .filter((k) => !memberSet.has(k)).length;
  const foreigners = movable.filter((k) => getParent(k) !== target.parentKey);
  const reparents: PlannedReparent[] = foreigners.map((key) => ({
    key,
    newParentKey: target.parentKey,
    insertIndex: keptBefore + movable.indexOf(key),
    currentParentKey: getParent(key) ?? null,
    currentSiblingKeys: scannedElements
      .filter((el) => el.parentKey === getParent(key))
      .map((el) => el.key),
  }));

  // 6. Final order of the target's children: kept children with the whole
  //    block spliced in at the drop point. slice() clamps a past-the-end
  //    insertIndex to append.
  const kept = currentChildren.filter((k) => !memberSet.has(k));
  const orderedKeys = [...kept.slice(0, keptBefore), ...movable, ...kept.slice(keptBefore)];
  return { reparents, finalOrder: { parentKey: target.parentKey, orderedKeys }, skipped };
}

export interface GroupMoveDeps {
  takeSnapshot: () => void;
  /** Editor.reparentElement with { snapshot: false } applied. */
  reparentOne: (
    key: string,
    newParentKey: string | null,
    insertIndex: number,
    currentParentKey: string | null,
    currentSiblingKeys: string[],
  ) => void | Promise<void>;
  /** useReorderElements.reorderChildElementsByKeys / reorderRootElementsByKeys, no-snapshot. */
  applyFinalOrder: (parentKey: string | null, orderedKeys: string[]) => void | Promise<void>;
  /** Toast for members the plan couldn't move. */
  onSkipped: (count: number) => void;
}

export async function executeGroupMove(plan: GroupMovePlan, deps: GroupMoveDeps): Promise<void> {
  const hasWork = plan.reparents.length > 0 || plan.finalOrder !== null;
  if (hasWork) deps.takeSnapshot(); // exactly ONE undo step for the whole group
  for (const r of plan.reparents) {
    await deps.reparentOne(r.key, r.newParentKey, r.insertIndex, r.currentParentKey, r.currentSiblingKeys);
  }
  if (plan.finalOrder) await deps.applyFinalOrder(plan.finalOrder.parentKey, plan.finalOrder.orderedKeys);
  if (plan.skipped.length > 0) deps.onSkipped(plan.skipped.length);
}
