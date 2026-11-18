/**
 * Bug Fix Tests: yjsStore.ts
 *
 * Tests for Bug #8: Double listener notification on undo/redo
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YjsGraphStore } from '../yjsStore';
import type { CanonicalNode } from '../types';

describe('Bug #8: Double listener notification on undo/redo', () => {
  let store: YjsGraphStore;
  let listenerCallCount: number;
  let unsubscribe: () => void;

  const createTestNode = (id: string, index: number = 0): CanonicalNode => ({
    id,
    parentId: null,
    index,
    kind: 'element',
    canonicalTokens: [],
    responsiveTokens: {},
    metadata: { locked: false, selectable: true, sourceEditable: true },
    version: 0,
    lastMutationId: null
  });

  beforeEach(() => {
    store = new YjsGraphStore();
    listenerCallCount = 0;
    unsubscribe = store.subscribe(() => {
      listenerCallCount++;
    });
  });

  afterEach(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  it('should notify listeners only once per undo operation', () => {
    // Make a change to create undo history
    store.transact('Add test node', { type: 'register-node', node: createTestNode('test-1') });

    // Reset counter after the add operation
    listenerCallCount = 0;

    // Perform undo - should only notify once
    const undoResult = store.undo();
    expect(undoResult).toBe(true);

    // With the fix, listener should be called exactly once
    // Before fix: would be called twice (once by doc.on('update'), once manually)
    expect(listenerCallCount).toBe(1);
  });

  it('should notify listeners only once per redo operation', () => {
    // Make a change
    store.transact('Add test node', { type: 'register-node', node: createTestNode('test-2') });

    // Undo the change
    store.undo();

    // Reset counter
    listenerCallCount = 0;

    // Perform redo - should only notify once
    const redoResult = store.redo();
    expect(redoResult).toBe(true);

    // With the fix, listener should be called exactly once
    expect(listenerCallCount).toBe(1);
  });

  it('should not notify when undo/redo is not possible', () => {
    listenerCallCount = 0;

    // No history, undo should return false and not notify
    const undoResult = store.undo();
    expect(undoResult).toBe(false);
    expect(listenerCallCount).toBe(0);

    // No future, redo should return false and not notify
    const redoResult = store.redo();
    expect(redoResult).toBe(false);
    expect(listenerCallCount).toBe(0);
  });

  it('should maintain consistent state after multiple undo/redo cycles', () => {
    // Add multiple nodes
    for (let i = 0; i < 3; i++) {
      store.transact(`Add node ${i}`, { type: 'register-node', node: createTestNode(`node-${i}`, i) });
    }

    listenerCallCount = 0;

    // Undo all 3 operations
    store.undo();
    store.undo();
    store.undo();

    // Should have notified 3 times (once per undo)
    expect(listenerCallCount).toBe(3);

    listenerCallCount = 0;

    // Redo all 3 operations
    store.redo();
    store.redo();
    store.redo();

    // Should have notified 3 times (once per redo)
    expect(listenerCallCount).toBe(3);
  });
});
