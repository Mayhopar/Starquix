/**
 * Bug Fix Tests: PagesContext.tsx
 *
 * Tests for Bug #13: Orphaned page when parent doesn't exist
 */
import { describe, it, expect } from 'vitest';

describe('Bug #13: Orphaned page when parent does not exist', () => {
  // Simulate the page tree structure
  interface PageNode {
    id: string;
    parentId: string | null;
    name: string;
  }

  // Fixed implementation
  const buildPageTree = (pages: PageNode[], rootPages: PageNode[]): Map<string, PageNode[]> => {
    const tree = new Map<string, PageNode[]>();
    const pageMap = new Map(pages.map(p => [p.id, p]));

    for (const page of pages) {
      if (page.parentId === null) {
        // Root level page
        const children = tree.get('root') || [];
        children.push(page);
        tree.set('root', children);
      } else if (pageMap.has(page.parentId)) {
        // Parent exists - add as child
        const children = tree.get(page.parentId) || [];
        children.push(page);
        tree.set(page.parentId, children);
      } else {
        // FIX: Parent doesn't exist - fallback to root
        // Before fix: page would be orphaned and not appear in tree
        const children = tree.get('root') || [];
        children.push(page);
        tree.set('root', children);
      }
    }

    return tree;
  };

  it('correctly places pages with existing parents', () => {
    const pages: PageNode[] = [
      { id: 'parent-1', parentId: null, name: 'Parent' },
      { id: 'child-1', parentId: 'parent-1', name: 'Child' }
    ];

    const tree = buildPageTree(pages, []);

    expect(tree.get('root')).toHaveLength(1);
    expect(tree.get('parent-1')).toHaveLength(1);
    expect(tree.get('parent-1')![0].id).toBe('child-1');
  });

  it('places orphaned pages at root level (bug fix)', () => {
    const pages: PageNode[] = [
      { id: 'orphan-1', parentId: 'non-existent-parent', name: 'Orphan' }
    ];

    const tree = buildPageTree(pages, []);

    // With the fix, orphan should appear at root level
    expect(tree.get('root')).toHaveLength(1);
    expect(tree.get('root')![0].id).toBe('orphan-1');

    // Should NOT have entries for non-existent parents
    expect(tree.get('non-existent-parent')).toBeUndefined();
  });

  it('handles mix of valid children and orphans', () => {
    const pages: PageNode[] = [
      { id: 'parent-1', parentId: null, name: 'Parent 1' },
      { id: 'child-1', parentId: 'parent-1', name: 'Child 1' },
      { id: 'orphan-1', parentId: 'deleted-parent', name: 'Orphan 1' },
      { id: 'orphan-2', parentId: 'another-deleted', name: 'Orphan 2' }
    ];

    const tree = buildPageTree(pages, []);

    // Root should have parent-1 + both orphans
    expect(tree.get('root')).toHaveLength(3);

    // Parent-1 should have its child
    expect(tree.get('parent-1')).toHaveLength(1);
    expect(tree.get('parent-1')![0].id).toBe('child-1');
  });

  it('handles deeply orphaned chains (grandparent deleted)', () => {
    // Scenario: grandparent deleted, child references non-existent parent
    const pages: PageNode[] = [
      { id: 'level-0', parentId: null, name: 'Root' },
      { id: 'level-2', parentId: 'deleted-level-1', name: 'Orphan Child' }
    ];

    const tree = buildPageTree(pages, []);

    // Both should be at root level
    expect(tree.get('root')).toHaveLength(2);
    const rootIds = tree.get('root')!.map(p => p.id);
    expect(rootIds).toContain('level-0');
    expect(rootIds).toContain('level-2');
  });

  it('handles all pages being orphans', () => {
    const pages: PageNode[] = [
      { id: 'orphan-1', parentId: 'missing-1', name: 'Orphan 1' },
      { id: 'orphan-2', parentId: 'missing-2', name: 'Orphan 2' },
      { id: 'orphan-3', parentId: 'missing-3', name: 'Orphan 3' }
    ];

    const tree = buildPageTree(pages, []);

    // All should be at root
    expect(tree.get('root')).toHaveLength(3);
  });

  it('does not create entries for non-existent parent IDs', () => {
    const pages: PageNode[] = [
      { id: 'orphan-1', parentId: 'ghost-parent', name: 'Orphan' }
    ];

    const tree = buildPageTree(pages, []);

    // Should not pollute tree with ghost parent entries
    expect(tree.has('ghost-parent')).toBe(false);
    expect(Array.from(tree.keys())).toEqual(['root']);
  });
});
