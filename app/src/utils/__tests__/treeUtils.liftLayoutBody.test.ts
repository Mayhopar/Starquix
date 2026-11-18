/**
 * Local component view of a layout: the scanned <body> root wore the layout's
 * name and nested a phantom "Layout inside Layout" under the Assets row (owner
 * report 2026-08-27, local twin of the WC master-tree fix cc00224d). The body
 * row is lifted only when the VIEWED file is the body's own file — page trees
 * keep it (there it IS the Layout node).
 */
import { describe, it, expect } from 'vitest';
import { liftLayoutBodyForComponentView, type TreeNode } from '../treeUtils';

const node = (key: string, depth: number, children: TreeNode[] = []): TreeNode =>
  ({ key, displayName: key, tagName: 'div', elementId: key, children, depth }) as TreeNode;

describe('liftLayoutBodyForComponentView', () => {
  it('lifts the body children flat in the layout own component view', () => {
    const header = node('L.astro:6:5', 1);
    const footer = node('L.astro:8:5', 1);
    const body = node('L.astro:5:3', 0, [header, footer]);
    const out = liftLayoutBodyForComponentView([body], 'L.astro:5:3', 'src/layouts/L.astro', 'src/layouts/L.astro');
    expect(out?.map((n) => n.key)).toEqual(['L.astro:6:5', 'L.astro:8:5']);
    expect(out?.[0].depth).toBe(0);
  });

  it('keeps the body row on page trees (no viewed file) and for other files', () => {
    const body = node('L.astro:5:3', 0, [node('L.astro:6:5', 1)]);
    expect(liftLayoutBodyForComponentView([body], 'L.astro:5:3', 'src/layouts/L.astro', null)).toBeNull();
    expect(liftLayoutBodyForComponentView([body], 'L.astro:5:3', 'src/layouts/L.astro', 'src/components/X.astro')).toBeNull();
  });
});
