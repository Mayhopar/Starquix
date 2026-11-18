// Group-move planner + executor (task-076 Phase D). The planner is PURE:
// scanned elements in (scan order == DOM order), reparent ops + final child
// order out. The executor REUSES the real single-drag primitives by
// injection — it never dispatches move commands itself.
// Design: docs/archive/plans/2026-06-13-multi-select-any-layer-design.md §4.
import { describe, it, expect, vi } from 'vitest';
import { planGroupMove, executeGroupMove } from '../multiSelectMove';
import type { GroupMovePlan } from '../multiSelectMove';
import type { ScannedElement } from '@/context/SelectionContext';

function el(key: string, parentKey: string | null): ScannedElement {
  return {
    key,
    parentKey,
    tagName: 'div',
    classes: '',
    rect: { top: 0, left: 0, width: 10, height: 10 },
    hasSourceTracking: true,
  };
}

describe('planGroupMove', () => {
  it('same-parent block reorder: no reparents, finalOrder has the block at insertIndex', () => {
    const scanned = [el('el-A', null), el('el-B', null), el('el-C', null), el('el-D', null)];
    const plan = planGroupMove({
      groupKeys: ['el-A', 'el-C'],
      target: { parentKey: null, insertIndex: 3 }, // before D
      scannedElements: scanned,
    });
    expect(plan.reparents).toEqual([]);
    expect(plan.finalOrder).toEqual({
      parentKey: null,
      orderedKeys: ['el-B', 'el-A', 'el-C', 'el-D'],
    });
    expect(plan.skipped).toEqual([]);
  });

  it('cross-parent: foreign members get reparent ops with incrementing indices + finalOrder', () => {
    const scanned = [
      el('el-A', null),
      el('el-P', null),
      el('el-P:div-0', 'el-P'),
      el('el-P:div-1', 'el-P'),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-A'],
      target: { parentKey: 'el-P', insertIndex: 1 },
      scannedElements: scanned,
    });
    expect(plan.reparents).toEqual([
      {
        key: 'el-A',
        newParentKey: 'el-P',
        insertIndex: 1,
        currentParentKey: null,
        currentSiblingKeys: ['el-A', 'el-P'],
      },
    ]);
    expect(plan.finalOrder).toEqual({
      parentKey: 'el-P',
      orderedKeys: ['el-P:div-0', 'el-A', 'el-P:div-1'],
    });
    expect(plan.skipped).toEqual([]);
  });

  it('mixed group: members already in target ride finalOrder; foreigners reparent', () => {
    const scanned = [
      el('el-A', null),
      el('el-P', null),
      el('el-P:div-0', 'el-P'),
      el('el-P:div-1', 'el-P'),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-A', 'el-P:div-1'],
      target: { parentKey: 'el-P', insertIndex: 0 },
      scannedElements: scanned,
    });
    // Only the foreigner reparents; the native member just reorders.
    expect(plan.reparents.map((r) => r.key)).toEqual(['el-A']);
    expect(plan.finalOrder).toEqual({
      parentKey: 'el-P',
      orderedKeys: ['el-A', 'el-P:div-1', 'el-P:div-0'],
    });
    expect(plan.skipped).toEqual([]);
  });

  it('group order follows scan order regardless of click order', () => {
    const scanned = [el('el-A', null), el('el-B', null), el('el-C', null), el('el-D', null)];
    const plan = planGroupMove({
      groupKeys: ['el-C', 'el-A'], // click order reversed
      target: { parentKey: null, insertIndex: 3 },
      scannedElements: scanned,
    });
    expect(plan.finalOrder?.orderedKeys).toEqual(['el-B', 'el-A', 'el-C', 'el-D']);
  });

  it('instance child moving within its own instance: allowed via finalOrder', () => {
    const scanned = [
      el('el-x:section-0', null),
      el('el-x:div-1', 'el-x:section-0'),
      el('el-x:div-2', 'el-x:section-0'),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-x:div-2'],
      target: { parentKey: 'el-x:section-0', insertIndex: 0 },
      scannedElements: scanned,
    });
    expect(plan.reparents).toEqual([]);
    expect(plan.finalOrder).toEqual({
      parentKey: 'el-x:section-0',
      orderedKeys: ['el-x:div-2', 'el-x:div-1'],
    });
    expect(plan.skipped).toEqual([]);
  });

  it('instance child leaving its instance: skipped, the rest planned normally', () => {
    const scanned = [
      el('el-x:section-0', null),
      el('el-x:div-1', 'el-x:section-0'),
      el('el-x:div-2', 'el-x:section-0'),
      el('el-y', null),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-x:div-2', 'el-y'],
      target: { parentKey: null, insertIndex: 0 },
      scannedElements: scanned,
    });
    expect(plan.skipped).toEqual(['el-x:div-2']);
    expect(plan.reparents).toEqual([]);
    expect(plan.finalOrder).toEqual({
      parentKey: null,
      orderedKeys: ['el-y', 'el-x:section-0'],
    });
  });

  it('descendant of another member is pruned, not planned twice', () => {
    const scanned = [
      el('el-p:section-0', null),
      el('el-p:div-1', 'el-p:section-0'),
      el('el-q', null),
      el('el-q:div-0', 'el-q'),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-p:section-0', 'el-p:div-1'],
      target: { parentKey: 'el-q', insertIndex: 1 },
      scannedElements: scanned,
    });
    expect(plan.reparents.map((r) => r.key)).toEqual(['el-p:section-0']);
    expect(plan.finalOrder?.orderedKeys).toEqual(['el-q:div-0', 'el-p:section-0']);
    expect(plan.skipped).toEqual([]);
  });

  it('insertIndex past the end clamps to append', () => {
    const scanned = [el('el-A', null), el('el-B', null), el('el-C', null)];
    const plan = planGroupMove({
      groupKeys: ['el-A'],
      target: { parentKey: null, insertIndex: 99 },
      scannedElements: scanned,
    });
    expect(plan.finalOrder?.orderedKeys).toEqual(['el-B', 'el-C', 'el-A']);
  });

  it('wrapper-as-root: roots scanned under the wrapper key, target.parentKey = wrapper key', () => {
    const WRAPPER = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
    const scanned = [
      el(WRAPPER, null),
      el('el-A', WRAPPER),
      el('el-B', WRAPPER),
      el('el-C', WRAPPER),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-A'],
      target: { parentKey: WRAPPER, insertIndex: 3 },
      scannedElements: scanned,
    });
    expect(plan.reparents).toEqual([]);
    expect(plan.finalOrder).toEqual({
      parentKey: WRAPPER,
      orderedKeys: ['el-B', 'el-C', 'el-A'],
    });
  });

  it('all members skipped → empty plan, null finalOrder', () => {
    const scanned = [
      el('el-x:section-0', null),
      el('el-x:div-1', 'el-x:section-0'),
      el('el-x:div-2', 'el-x:section-0'),
      el('el-y', null),
    ];
    const plan = planGroupMove({
      groupKeys: ['el-x:div-2'],
      target: { parentKey: null, insertIndex: 0 },
      scannedElements: scanned,
    });
    expect(plan.skipped).toEqual(['el-x:div-2']);
    expect(plan.reparents).toEqual([]);
    expect(plan.finalOrder).toBeNull();
  });
});

describe('executeGroupMove', () => {
  const deps = () => ({
    takeSnapshot: vi.fn(),
    reparentOne: vi.fn(),
    applyFinalOrder: vi.fn(),
    onSkipped: vi.fn(),
  });

  it('snapshot exactly once, BEFORE any primitive; reparents before finalOrder', async () => {
    const d = deps();
    const plan: GroupMovePlan = {
      reparents: [{
        key: 'el-A', newParentKey: 'el-P', insertIndex: 1,
        currentParentKey: null, currentSiblingKeys: ['el-A', 'el-P'],
      }],
      finalOrder: { parentKey: 'el-P', orderedKeys: ['el-P:div-0', 'el-A'] },
      skipped: [],
    };
    await executeGroupMove(plan, d);

    expect(d.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(d.reparentOne).toHaveBeenCalledWith('el-A', 'el-P', 1, null, ['el-A', 'el-P']);
    expect(d.applyFinalOrder).toHaveBeenCalledWith('el-P', ['el-P:div-0', 'el-A']);
    const snapOrder = d.takeSnapshot.mock.invocationCallOrder[0];
    const repOrder = d.reparentOne.mock.invocationCallOrder[0];
    const orderOrder = d.applyFinalOrder.mock.invocationCallOrder[0];
    expect(snapOrder).toBeLessThan(repOrder);
    expect(repOrder).toBeLessThan(orderOrder);
    expect(d.onSkipped).not.toHaveBeenCalled();
  });

  it('skipped-only plan: no snapshot, no primitives, onSkipped(n) fires', async () => {
    const d = deps();
    await executeGroupMove({ reparents: [], finalOrder: null, skipped: ['el-x:div-2'] }, d);
    expect(d.takeSnapshot).not.toHaveBeenCalled();
    expect(d.reparentOne).not.toHaveBeenCalled();
    expect(d.applyFinalOrder).not.toHaveBeenCalled();
    expect(d.onSkipped).toHaveBeenCalledWith(1);
  });

  it('empty plan: nothing called', async () => {
    const d = deps();
    await executeGroupMove({ reparents: [], finalOrder: null, skipped: [] }, d);
    expect(d.takeSnapshot).not.toHaveBeenCalled();
    expect(d.reparentOne).not.toHaveBeenCalled();
    expect(d.applyFinalOrder).not.toHaveBeenCalled();
    expect(d.onSkipped).not.toHaveBeenCalled();
  });

  it('finalOrder-only plan still snapshots once', async () => {
    const d = deps();
    await executeGroupMove({
      reparents: [],
      finalOrder: { parentKey: null, orderedKeys: ['el-B', 'el-A'] },
      skipped: [],
    }, d);
    expect(d.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(d.applyFinalOrder).toHaveBeenCalledWith(null, ['el-B', 'el-A']);
  });
});
