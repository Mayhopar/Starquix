/**
 * Yjs-based Graph Store
 *
 * CRDT-based implementation providing:
 * - Built-in undo/redo support
 * - Conflict-free merging for multiplayer
 * - Stable references for React integration
 */

import * as Y from 'yjs';
import type {
  CanonicalNode,
  CanonicalNodeMetadata,
  CanonicalGraphState,
  GraphMutationCommand,
  ResponsiveTokenMap,
  TransactOptions,
  UndoableGraphStore
} from './types';
import { createId } from './utils';

// Yjs node structure (nested Y.Map)
type YNode = Y.Map<unknown>;

/**
 * Convert a plain CanonicalNode to a Y.Map structure
 */
const nodeToYMap = (node: CanonicalNode): YNode => {
  const yNode = new Y.Map();

  yNode.set('id', node.id);
  yNode.set('parentId', node.parentId);
  yNode.set('index', node.index);
  yNode.set('kind', node.kind);
  yNode.set('version', node.version);
  yNode.set('lastMutationId', node.lastMutationId);

  // Canonical tokens as Y.Array for proper CRDT handling
  const yCanonicalTokens = Y.Array.from(node.canonicalTokens);
  yNode.set('canonicalTokens', yCanonicalTokens);

  // Responsive tokens as nested Y.Map<Y.Array>
  const yResponsiveTokens = new Y.Map();
  Object.entries(node.responsiveTokens).forEach(([breakpoint, tokens]) => {
    yResponsiveTokens.set(breakpoint, Y.Array.from(tokens));
  });
  yNode.set('responsiveTokens', yResponsiveTokens);

  // Metadata as Y.Map
  const yMetadata = new Y.Map();
  Object.entries(node.metadata).forEach(([key, value]) => {
    if (value !== undefined) {
      yMetadata.set(key, value);
    }
  });
  yNode.set('metadata', yMetadata);

  return yNode;
};

/**
 * Convert a Y.Map node back to plain CanonicalNode
 */
const yMapToNode = (yNode: YNode): CanonicalNode => {
  const yCanonicalTokens = yNode.get('canonicalTokens') as Y.Array<string>;
  const yResponsiveTokens = yNode.get('responsiveTokens') as Y.Map<Y.Array<string>>;
  const yMetadata = yNode.get('metadata') as Y.Map<unknown>;

  const responsiveTokens: ResponsiveTokenMap = {};
  yResponsiveTokens.forEach((tokens, breakpoint) => {
    responsiveTokens[breakpoint] = tokens.toArray();
  });

  const metadata: CanonicalNodeMetadata = {};
  yMetadata.forEach((value, key) => {
    (metadata as Record<string, unknown>)[key] = value;
  });

  return {
    id: yNode.get('id') as string,
    parentId: yNode.get('parentId') as string | null,
    index: yNode.get('index') as number,
    kind: yNode.get('kind') as CanonicalNode['kind'],
    canonicalTokens: yCanonicalTokens.toArray(),
    responsiveTokens,
    metadata,
    version: yNode.get('version') as number,
    lastMutationId: yNode.get('lastMutationId') as string | null
  };
};

/**
 * Yjs-based graph store with undo/redo support.
 */
export class YjsGraphStore implements UndoableGraphStore {
  private doc: Y.Doc;
  private nodes: Y.Map<YNode>;
  private rootIds: Y.Array<string>;
  private meta: Y.Map<unknown>;
  private listeners: Set<(state: CanonicalGraphState) => void>;
  private undoManager: Y.UndoManager;
  private cachedState: CanonicalGraphState | null = null;

  constructor(initialState?: CanonicalGraphState) {
    this.doc = new Y.Doc();
    this.nodes = this.doc.getMap('nodes');
    this.rootIds = this.doc.getArray('rootIds');
    this.meta = this.doc.getMap('meta');
    this.listeners = new Set();

    // Initialize metadata
    this.meta.set('version', 0);
    this.meta.set('lastTransactionId', null);

    // Set up undo manager tracking all changes
    // captureTimeout: 0 ensures each transaction is a separate undo entry
    // (default 500ms batches rapid changes together)
    this.undoManager = new Y.UndoManager([this.nodes, this.rootIds], {
      trackedOrigins: new Set(['local']),
      captureTimeout: 0
    });

    // Subscribe to Yjs changes to invalidate cache and notify listeners
    this.doc.on('update', () => {
      this.cachedState = null;
      this.notifyListeners();
    });

    // Import initial state if provided
    if (initialState) {
      this.importSnapshot(initialState, 'init');
    }
  }

  /**
   * Get the Yjs document (for syncing)
   */
  getDoc(): Y.Doc {
    return this.doc;
  }

  /**
   * Get current state as plain object.
   * Returns cached state to ensure stable references for React.
   */
  getState(): CanonicalGraphState {
    if (this.cachedState !== null) {
      return this.cachedState;
    }

    const nodes: Record<string, CanonicalNode> = {};

    this.nodes.forEach((yNode, id) => {
      nodes[id] = yMapToNode(yNode);
    });

    this.cachedState = {
      nodes,
      rootIds: this.rootIds.toArray(),
      version: (this.meta.get('version') as number) || 0,
      lastTransactionId: (this.meta.get('lastTransactionId') as string) || null
    };

    return this.cachedState;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: CanonicalGraphState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  /**
   * Apply mutations within a transaction
   */
  transact(
    _description: string,
    commands: GraphMutationCommand | GraphMutationCommand[],
    options?: TransactOptions
  ): CanonicalGraphState {
    const commandArray = Array.isArray(commands) ? commands : [commands];
    const txId = createId();
    const trackUndo = options?.trackUndo !== false;

    // Use 'local' origin for undo-tracked changes, 'sync' for non-tracked
    const origin = trackUndo ? 'local' : 'sync';

    this.doc.transact(() => {
      commandArray.forEach(command => this.applyCommand(command));

      // Update metadata
      const currentVersion = (this.meta.get('version') as number) || 0;
      this.meta.set('version', currentVersion + 1);
      this.meta.set('lastTransactionId', txId);
    }, origin);

    return this.getState();
  }

  private applyCommand(command: GraphMutationCommand): void {
    switch (command.type) {
      case 'register-node': {
        if (this.nodes.has(command.node.id)) {
          return;
        }

        const yNode = nodeToYMap(command.node);
        this.nodes.set(command.node.id, yNode);

        if (command.node.parentId === null) {
          const index = Math.max(0, Math.min(command.node.index, this.rootIds.length));
          this.rootIds.insert(index, [command.node.id]);
        }
        break;
      }

      case 'update-node': {
        const yNode = this.nodes.get(command.nodeId);
        if (!yNode) return;

        if (command.canonicalTokens !== undefined) {
          const yTokens = yNode.get('canonicalTokens') as Y.Array<string>;
          yTokens.delete(0, yTokens.length);
          yTokens.push(command.canonicalTokens);
        }

        if (command.responsiveTokens !== undefined) {
          const yResponsiveTokens = yNode.get('responsiveTokens') as Y.Map<Y.Array<string>>;
          yResponsiveTokens.forEach((_, key) => yResponsiveTokens.delete(key));
          Object.entries(command.responsiveTokens).forEach(([breakpoint, tokens]) => {
            yResponsiveTokens.set(breakpoint, Y.Array.from(tokens));
          });
        }

        if (command.metadata !== undefined) {
          const yMetadata = yNode.get('metadata') as Y.Map<unknown>;
          Object.entries(command.metadata).forEach(([key, value]) => {
            if (value !== undefined) {
              yMetadata.set(key, value);
            }
          });
        }

        if (command.index !== undefined) {
          yNode.set('index', command.index);
        }

        if (command.parentId !== undefined) {
          const oldParentId = yNode.get('parentId') as string | null;
          yNode.set('parentId', command.parentId);

          // Update rootIds if needed
          if (oldParentId === null && command.parentId !== null) {
            const idx = this.rootIds.toArray().indexOf(command.nodeId);
            if (idx !== -1) this.rootIds.delete(idx, 1);
          } else if (oldParentId !== null && command.parentId === null) {
            const index = command.index ?? this.rootIds.length;
            this.rootIds.insert(Math.min(index, this.rootIds.length), [command.nodeId]);
          }
        }

        // Increment version
        const currentVersion = (yNode.get('version') as number) || 0;
        yNode.set('version', currentVersion + 1);
        yNode.set('lastMutationId', createId());
        break;
      }

      case 'remove-node': {
        if (!this.nodes.has(command.nodeId)) return;

        // Remove node and all children recursively
        const toRemove = [command.nodeId];
        while (toRemove.length) {
          const id = toRemove.pop()!;

          // Find children
          this.nodes.forEach((yNode, nodeId) => {
            if (yNode.get('parentId') === id) {
              toRemove.push(nodeId);
            }
          });

          // Remove from nodes
          this.nodes.delete(id);

          // Remove from rootIds if present
          const rootIdx = this.rootIds.toArray().indexOf(id);
          if (rootIdx !== -1) {
            this.rootIds.delete(rootIdx, 1);
          }
        }
        break;
      }

      case 'move-node': {
        const yNode = this.nodes.get(command.nodeId);
        if (!yNode) return;

        const oldParentId = yNode.get('parentId') as string | null;

        yNode.set('parentId', command.parentId);
        yNode.set('index', command.index);
        yNode.set('version', ((yNode.get('version') as number) || 0) + 1);
        yNode.set('lastMutationId', createId());

        // Update rootIds
        if (oldParentId === null) {
          const idx = this.rootIds.toArray().indexOf(command.nodeId);
          if (idx !== -1) this.rootIds.delete(idx, 1);
        }

        if (command.parentId === null) {
          const index = Math.min(command.index, this.rootIds.length);
          this.rootIds.insert(index, [command.nodeId]);
        }
        break;
      }

      case 'batch': {
        command.commands.forEach(cmd => this.applyCommand(cmd));
        break;
      }
    }
  }

  /**
   * Import a full state snapshot
   */
  importSnapshot(snapshot: CanonicalGraphState, _description = 'hydrate'): void {
    this.doc.transact(() => {
      // Clear existing data
      this.nodes.forEach((_, key) => this.nodes.delete(key));
      this.rootIds.delete(0, this.rootIds.length);

      // Import nodes
      Object.values(snapshot.nodes).forEach(node => {
        const yNode = nodeToYMap(node);
        this.nodes.set(node.id, yNode);
      });

      // Import rootIds
      this.rootIds.push(snapshot.rootIds);

      // Update metadata
      this.meta.set('version', snapshot.version);
      this.meta.set('lastTransactionId', snapshot.lastTransactionId);
    }, 'local');
  }

  /**
   * Get a single node by ID
   */
  getNode(nodeId: string): CanonicalNode | null {
    const yNode = this.nodes.get(nodeId);
    if (!yNode) return null;
    return yMapToNode(yNode);
  }

  /**
   * List children of a parent (sorted by index)
   */
  listChildren(parentId: string | null): CanonicalNode[] {
    const children: CanonicalNode[] = [];

    this.nodes.forEach(yNode => {
      if (yNode.get('parentId') === parentId) {
        children.push(yMapToNode(yNode));
      }
    });

    return children.sort((a, b) => a.index - b.index);
  }

  // ============ Undo/Redo ============

  undo(): boolean {
    if (this.undoManager.canUndo()) {
      this.undoManager.undo();
      // Note: doc.on('update') handler already invalidates cache and notifies listeners
      return true;
    }
    return false;
  }

  redo(): boolean {
    if (this.undoManager.canRedo()) {
      this.undoManager.redo();
      // Note: doc.on('update') handler already invalidates cache and notifies listeners
      return true;
    }
    return false;
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  clearHistory(): void {
    this.undoManager.clear();
  }

  // ============ Sync Utilities ============

  /**
   * Get the raw Yjs update for syncing to other clients
   */
  getUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Apply an update from another client
   */
  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
  }
}

/**
 * Factory function for creating Yjs graph stores
 */
export const createYjsGraphStore = (initialState?: CanonicalGraphState) =>
  new YjsGraphStore(initialState);
