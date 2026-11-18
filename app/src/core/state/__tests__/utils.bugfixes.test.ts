/**
 * Bug Fix Tests: utils.ts
 *
 * Tests for Bug #9: Shallow clone of metadata.dataset
 */
import { describe, it, expect } from 'vitest';
import { cloneNode, createEmptyGraphNode, type CanonicalNode } from '../utils';

describe('Bug #9: Shallow clone of metadata.dataset', () => {
  const createTestNode = (): CanonicalNode => ({
    id: 'test-node',
    parentId: null,
    index: 0,
    kind: 'element',
    canonicalTokens: ['p-4', 'bg-red-500'],
    responsiveTokens: {
      md: ['p-8'],
      lg: ['p-12']
    },
    metadata: {
      displayName: 'Test Element',
      dataset: {
        'data-testid': 'my-element',
        'data-custom': 'value'
      },
      locked: false,
      selectable: true,
      sourceEditable: true,
      tagName: 'div'
    },
    version: 1,
    lastMutationId: 'mutation-123'
  });

  describe('cloneNode', () => {
    it('creates independent copy of canonicalTokens', () => {
      const original = createTestNode();
      const cloned = cloneNode(original);

      // Modify cloned tokens
      cloned.canonicalTokens.push('new-class');

      // Original should be unchanged
      expect(original.canonicalTokens).not.toContain('new-class');
      expect(original.canonicalTokens).toHaveLength(2);
      expect(cloned.canonicalTokens).toHaveLength(3);
    });

    it('creates independent copy of responsiveTokens', () => {
      const original = createTestNode();
      const cloned = cloneNode(original);

      // Modify cloned responsive tokens
      cloned.responsiveTokens['md'].push('new-class');
      cloned.responsiveTokens['xl'] = ['xl-class'];

      // Original should be unchanged
      expect(original.responsiveTokens['md']).toHaveLength(1);
      expect(original.responsiveTokens['xl']).toBeUndefined();
    });

    // BUG FIX TEST: This test would fail before the fix
    it('creates independent copy of metadata.dataset (bug fix)', () => {
      const original = createTestNode();
      const cloned = cloneNode(original);

      // Modify cloned dataset
      cloned.metadata.dataset!['data-testid'] = 'modified-id';
      cloned.metadata.dataset!['data-new'] = 'new-value';

      // Original dataset should be unchanged
      expect(original.metadata.dataset!['data-testid']).toBe('my-element');
      expect(original.metadata.dataset!['data-new']).toBeUndefined();

      // Cloned should have modifications
      expect(cloned.metadata.dataset!['data-testid']).toBe('modified-id');
      expect(cloned.metadata.dataset!['data-new']).toBe('new-value');
    });

    it('handles undefined dataset correctly', () => {
      const original = createTestNode();
      original.metadata.dataset = undefined;

      const cloned = cloneNode(original);

      expect(cloned.metadata.dataset).toBeUndefined();
    });

    it('handles empty dataset correctly', () => {
      const original = createTestNode();
      original.metadata.dataset = {};

      const cloned = cloneNode(original);

      cloned.metadata.dataset!['new-key'] = 'value';
      expect(original.metadata.dataset).toEqual({});
    });
  });

  describe('createEmptyGraphNode', () => {
    it('creates independent copy of dataset from partial', () => {
      const sourceDataset = { 'data-key': 'value' };
      const node = createEmptyGraphNode({
        id: 'new-node',
        metadata: {
          dataset: sourceDataset
        }
      });

      // Modify the new node's dataset
      node.metadata.dataset!['data-key'] = 'modified';
      node.metadata.dataset!['data-new'] = 'new';

      // Original source dataset should be unchanged
      expect(sourceDataset['data-key']).toBe('value');
      expect((sourceDataset as any)['data-new']).toBeUndefined();
    });

    it('handles undefined dataset in partial', () => {
      const node = createEmptyGraphNode({
        id: 'new-node'
      });

      expect(node.metadata.dataset).toBeUndefined();
    });
  });
});
