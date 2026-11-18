import { describe, it, expect } from 'vitest';
import { planLayersDrop, zoneFromRelY, type LayersDropInput } from '../planLayersDrop';
import type { TreeNode } from '@/utils/treeUtils';

function node(key: string, tagName: string, children: TreeNode[] = []): TreeNode {
  return { key, displayName: tagName, tagName, elementId: key.split(':')[0], children } as TreeNode;
}

/** Minimal input with sensible defaults; override per test. */
function input(over: Partial<LayersDropInput>): LayersDropInput {
  return {
    activeKey: 'a',
    overKey: 'b',
    activeNode: node('a', 'div'),
    overNode: node('b', 'div'),
    activeParentKey: null,
    activeSiblingKeys: undefined,
    overParentKey: null,
    overSiblingKeys: undefined,
    rootKeys: ['a', 'b'],
    ...over,
  };
}

describe('zoneFromRelY', () => {
  it('outer thirds → before / after, middle band → inside', () => {
    expect(zoneFromRelY(0)).toBe('before');
    expect(zoneFromRelY(0.1)).toBe('before');
    expect(zoneFromRelY(0.5)).toBe('inside');
    expect(zoneFromRelY(0.9)).toBe('after');
    expect(zoneFromRelY(1)).toBe('after');
  });
  it('boundary values favor nesting (inside)', () => {
    expect(zoneFromRelY(0.30)).toBe('inside');
    expect(zoneFromRelY(0.70)).toBe('inside');
  });
});

describe('planLayersDrop', () => {
  it('drop on self → noop', () => {
    expect(planLayersDrop(input({ activeKey: 'a', overKey: 'a' }))).toEqual({ kind: 'noop', reason: 'self' });
  });

  it('drop into a descendant of the dragged element → noop (cycle refused), any zone', () => {
    const child = node('child', 'div');
    const active = node('a', 'section', [child]);
    for (const position of ['before', 'inside', 'after'] as const) {
      const plan = planLayersDrop(input({
        activeKey: 'a', overKey: 'child', activeNode: active, overNode: child, position,
      }));
      expect(plan).toEqual({ kind: 'noop', reason: 'cycle' });
    }
  });

  // --- inside (nest) ---
  it('inside a container → reparent at the end of its children', () => {
    const target = node('b', 'div', [node('c1', 'p'), node('c2', 'p')]);
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'b', activeNode: node('a', 'span'), overNode: target,
      activeParentKey: 'root-1', position: 'inside',
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: 'b', insertIndex: 2 });
  });

  it('inside an empty container tag → reparent at index 0', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'b', activeNode: node('a', 'span'),
      overNode: node('b', 'section'), activeParentKey: 'root-1', position: 'inside',
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: 'b', insertIndex: 0 });
  });

  it('default position (no zone) behaves as inside a container (back-compat)', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'b', activeNode: node('a', 'span'),
      overNode: node('b', 'section'), activeParentKey: 'root-1',
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: 'b', insertIndex: 0 });
  });

  it('inside a NON-container leaf → demotes to "after" (sibling under leaf parent)', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'leaf', activeNode: node('a', 'span'),
      overNode: node('leaf', 'img'), position: 'inside',
      activeParentKey: 'parentA', overParentKey: 'parentB',
      overSiblingKeys: ['x', 'leaf', 'z'],
    }));
    // after 'leaf' (index 1) under parentB → insertIndex 2
    expect(plan).toEqual({ kind: 'reparent', newParentKey: 'parentB', insertIndex: 2 });
  });

  it('inside the dragged element’s CURRENT parent → noop (already a child)', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'P', activeNode: node('a', 'span'),
      overNode: node('P', 'div', [node('a', 'span')]), activeParentKey: 'P', position: 'inside',
    }));
    expect(plan).toEqual({ kind: 'noop', reason: 'self' });
  });

  // --- before / after sibling placement (cross-parent reparent) ---
  it('before a row in another parent → reparent at that index under the over parent', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'mid', activeNode: node('a', 'span'),
      overNode: node('mid', 'div'), position: 'before',
      activeParentKey: 'parentA', overParentKey: 'parentB',
      overSiblingKeys: ['top', 'mid', 'bot'],
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: 'parentB', insertIndex: 1 });
  });

  it('after a row in another parent → reparent at index+1 under the over parent', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'mid', activeNode: node('a', 'span'),
      overNode: node('mid', 'div'), position: 'after',
      activeParentKey: 'parentA', overParentKey: 'parentB',
      overSiblingKeys: ['top', 'mid', 'bot'],
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: 'parentB', insertIndex: 2 });
  });

  // --- ROOT placement via before/after a root row (replaces RootDropZone) ---
  it('before a ROOT row → reparent to root (newParentKey=null) at that index', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'r2', activeNode: node('a', 'span'),
      overNode: node('r2', 'section'), position: 'before',
      activeParentKey: 'someParent', overParentKey: null,
      rootKeys: ['r1', 'r2', 'r3'],
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: null, insertIndex: 1 });
  });

  it('after the last ROOT row → reparent to root at the end', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'r3', activeNode: node('a', 'span'),
      overNode: node('r3', 'section'), position: 'after',
      activeParentKey: 'someParent', overParentKey: null,
      rootKeys: ['r1', 'r2', 'r3'],
    }));
    expect(plan).toEqual({ kind: 'reparent', newParentKey: null, insertIndex: 3 });
  });

  // --- same-parent reorder (unified 'reorder' kind) ---
  it('same-parent before → reorder with active spliced before the over row', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'c', activeNode: node('a', 'p'),
      overNode: node('c', 'p'), position: 'before',
      activeParentKey: 'P', overParentKey: 'P',
      activeSiblingKeys: ['a', 'b', 'c'],
    }));
    expect(plan).toEqual({ kind: 'reorder', parentKey: 'P', orderedKeys: ['b', 'a', 'c'] });
  });

  it('same-parent after → reorder with active spliced after the over row', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'b', activeNode: node('a', 'p'),
      overNode: node('b', 'p'), position: 'after',
      activeParentKey: 'P', overParentKey: 'P',
      activeSiblingKeys: ['a', 'b', 'c'],
    }));
    expect(plan).toEqual({ kind: 'reorder', parentKey: 'P', orderedKeys: ['b', 'a', 'c'] });
  });

  it('ROOT same-parent reorder → reorder with parentKey null over rootKeys', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'b', activeNode: node('a', 'img'),
      overNode: node('b', 'img'), position: 'after',
      activeParentKey: null, overParentKey: null,
      rootKeys: ['a', 'b', 'c'],
    }));
    expect(plan).toEqual({ kind: 'reorder', parentKey: null, orderedKeys: ['b', 'a', 'c'] });
  });

  it('same-parent reorder that does not move anything → noop', () => {
    const plan = planLayersDrop(input({
      activeKey: 'a', overKey: 'b', activeNode: node('a', 'p'),
      overNode: node('b', 'p'), position: 'before',
      activeParentKey: 'P', overParentKey: 'P',
      activeSiblingKeys: ['a', 'b', 'c'],
    }));
    // 'a' before 'b' is already the order → no change
    expect(plan).toEqual({ kind: 'noop', reason: 'no-target' });
  });

  it('root-level rows missing from rootKeys still reorder via their sibling list (master rows have no source tracking)', () => {
    // A 2-row layout master ([Header, slot]) scans its rows as parentKey-null,
    // but rootKeys (useReorderElements) filters by hasSourceTracking and holds
    // OTHER keys — the drop silently nooped ('no-target') and the slot could
    // never be moved. Proven live 2026-08-27 on layouts/Layout.astro.
    const plan = planLayersDrop(input({
      activeKey: 'el-b:slot-0', overKey: 'el-a:header-0',
      activeNode: node('el-b:slot-0', 'slot'), overNode: node('el-a:header-0', 'header'),
      position: 'before',
      activeParentKey: null, overParentKey: null,
      activeSiblingKeys: ['el-a:header-0', 'el-b:slot-0'],
      rootKeys: ['wrapper-x', 'sqhmr-y'],
    }));
    expect(plan).toEqual({ kind: 'reorder', parentKey: null, orderedKeys: ['el-b:slot-0', 'el-a:header-0'] });
  });
});
