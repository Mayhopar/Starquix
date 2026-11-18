import { describe, it, expect } from 'vitest';
import { YjsGraphStore } from './yjsStore';
import { createEmptyGraphNode } from './utils';

describe('YjsGraphStore undo/redo', () => {
  it('can undo class token updates', () => {
    const store = new YjsGraphStore();

    // Register a node (not tracked for undo - initial state)
    store.transact('register', {
      type: 'register-node',
      node: createEmptyGraphNode({
        id: 'test-node',
        canonicalTokens: ['bg-white'],
        responsiveTokens: {},
        metadata: {}
      })
    }, { trackUndo: false });

    const stateAfterRegister = store.getState();
    expect(stateAfterRegister.nodes['test-node'].canonicalTokens).toEqual(['bg-white']);
    expect(store.canUndo()).toBe(false); // Registration not tracked

    // Update classes (should be tracked for undo)
    store.transact('update-classes', {
      type: 'update-node',
      nodeId: 'test-node',
      canonicalTokens: ['bg-blue-500']
    });

    const stateAfterUpdate = store.getState();
    expect(stateAfterUpdate.nodes['test-node'].canonicalTokens).toEqual(['bg-blue-500']);
    expect(store.canUndo()).toBe(true); // Update should be tracked

    // Undo the class update
    store.undo();

    const stateAfterUndo = store.getState();
    expect(stateAfterUndo.nodes['test-node'].canonicalTokens).toEqual(['bg-white']);
  });

  it('can redo class token updates', () => {
    const store = new YjsGraphStore();

    // Register a node
    store.transact('register', {
      type: 'register-node',
      node: createEmptyGraphNode({
        id: 'test-node',
        canonicalTokens: ['bg-white'],
        responsiveTokens: {},
        metadata: {}
      })
    }, { trackUndo: false });

    // Update classes
    store.transact('update-classes', {
      type: 'update-node',
      nodeId: 'test-node',
      canonicalTokens: ['bg-blue-500']
    });

    // Undo
    store.undo();
    expect(store.getState().nodes['test-node'].canonicalTokens).toEqual(['bg-white']);

    // Redo
    store.redo();
    expect(store.getState().nodes['test-node'].canonicalTokens).toEqual(['bg-blue-500']);
  });
});
