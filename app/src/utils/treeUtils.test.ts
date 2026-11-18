// app/src/utils/treeUtils.test.ts
import { describe, it, expect } from 'vitest';
import { buildTreeFromScannedElements, flattenVisibleKeys } from './treeUtils';
import type { TreeNode } from './treeUtils';
import type { ScannedElement } from '@/context/SelectionContext';

describe('buildTreeFromScannedElements', () => {
  it('builds tree from flat elements with parent relationships', () => {
    const elements: ScannedElement[] = [
      {
        key: 'parent:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'div',
        classes: '',
        rect: { top: 0, left: 0, width: 100, height: 200 },
      },
      {
        key: 'child:2:1',
        parentKey: 'parent:1:1',
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 0, left: 0, width: 100, height: 100 },
      },
    ];

    const tree = buildTreeFromScannedElements(elements);

    expect(tree).toHaveLength(1);
    expect(tree[0].tagName).toBe('div');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].tagName).toBe('section');
  });

  it('auto-unwraps when single root is Astro page container', () => {
    // Simulate the #sq-components div that Astro adds source tracking to
    const elements: ScannedElement[] = [
      {
        key: 'src/pages/preview/[projectId]/[pageId].astro:7:27',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'div',
        classes: '',
        rect: { top: 0, left: 0, width: 800, height: 1000 },
      },
      {
        key: 'el-section-1:1:1',
        parentKey: 'src/pages/preview/[projectId]/[pageId].astro:7:27',
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 0, left: 0, width: 800, height: 400 },
      },
      {
        key: 'el-section-2:1:1',
        parentKey: 'src/pages/preview/[projectId]/[pageId].astro:7:27',
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 400, left: 0, width: 800, height: 400 },
      },
    ];

    const tree = buildTreeFromScannedElements(elements);

    // Should return the sections as root nodes, not the container div
    expect(tree).toHaveLength(2);
    expect(tree[0].tagName).toBe('section');
    expect(tree[1].tagName).toBe('section');
  });

  it('does not unwrap when there are multiple root elements', () => {
    const elements: ScannedElement[] = [
      {
        key: 'section-1:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 0, left: 0, width: 100, height: 100 },
      },
      {
        key: 'section-2:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 100, left: 0, width: 100, height: 100 },
      },
    ];

    const tree = buildTreeFromScannedElements(elements);

    expect(tree).toHaveLength(2);
    expect(tree[0].tagName).toBe('section');
    expect(tree[1].tagName).toBe('section');
  });
});

describe('flattenVisibleKeys (task-076)', () => {
  const node = (key: string, children: TreeNode[] = [], depth = 0): TreeNode => ({
    key,
    displayName: key,
    tagName: 'div',
    elementId: key.split(':')[0],
    children,
    depth,
  });
  // tree: A (expandable) -> [A1, A2 (expandable) -> [A2a]], B
  const nodes = [
    node('A', [node('A1', [], 1), node('A2', [node('A2a', [], 2)], 1)]),
    node('B'),
  ];

  it('returns pre-order visible rows, skipping collapsed subtrees', () => {
    expect(flattenVisibleKeys(nodes, new Set(['A']))).toEqual(['A', 'A1', 'A2', 'B']);
  });

  it('expanded child exposes its subtree', () => {
    expect(flattenVisibleKeys(nodes, new Set(['A', 'A2']))).toEqual(['A', 'A1', 'A2', 'A2a', 'B']);
  });

  it('nothing expanded → only roots', () => {
    expect(flattenVisibleKeys(nodes, new Set())).toEqual(['A', 'B']);
  });
});
