/**
 * Core State Types
 *
 * Defines the canonical data model for the editor's state management.
 * Used by the Yjs store for CRDT-based collaborative editing.
 */

// ============================================================================
// Responsive Tokens
// ============================================================================

/**
 * Map of breakpoint name to array of Tailwind class tokens.
 * Example: { sm: ['p-2', 'text-sm'], md: ['p-4', 'text-base'] }
 */
export type ResponsiveTokenMap = Record<string, string[]>;

/**
 * Breakpoint order for cascade logic.
 * Classes cascade upward: base has no prefix, sm inherits base, etc.
 */
export { BREAKPOINTS as BREAKPOINT_ORDER } from '@/core/classes/types';
export type { Breakpoint as BreakpointName } from '@/core/classes/types';

// ============================================================================
// Node Types
// ============================================================================

import type { SourceLocation } from '@/bridge/types';
export type { SourceLocation };

/**
 * Metadata associated with a graph node.
 */
export interface CanonicalNodeMetadata {
  /** Display name shown in ElementsTree */
  displayName?: string;
  /** Dataset attributes from the element */
  dataset?: Record<string, string>;
  /** Whether this node is locked from editing */
  locked?: boolean;
  /** Whether this node can be selected */
  selectable?: boolean;
  /** Source file location for persisting changes */
  sourceLocation?: SourceLocation;
  /** Whether this node's classes can be edited in source */
  sourceEditable?: boolean;
  /** Tag name of the element (div, span, etc.) */
  tagName?: string;
}

/**
 * A node in the canonical graph.
 * Represents a single element in the editor's state.
 */
export interface CanonicalNode {
  /** Unique identifier (matches data-key) */
  id: string;
  /** Parent node ID, null for root nodes */
  parentId: string | null;
  /** Position among siblings */
  index: number;
  /** Node kind for categorization */
  kind: 'element' | 'component' | 'slot' | 'text';
  /** Base Tailwind class tokens (no responsive prefix) */
  canonicalTokens: string[];
  /** Responsive class tokens by breakpoint */
  responsiveTokens: ResponsiveTokenMap;
  /** Additional metadata */
  metadata: CanonicalNodeMetadata;
  /** Version number for conflict detection */
  version: number;
  /** ID of the last mutation that modified this node */
  lastMutationId: string | null;
}

// ============================================================================
// Graph State
// ============================================================================

/**
 * Complete graph state snapshot.
 * Can be serialized/deserialized for persistence.
 */
export interface CanonicalGraphState {
  /** Map of node ID to node */
  nodes: Record<string, CanonicalNode>;
  /** Ordered list of root node IDs */
  rootIds: string[];
  /** Global version counter */
  version: number;
  /** ID of the last transaction */
  lastTransactionId: string | null;
}

/**
 * Transaction metadata for debugging/history.
 */
export interface CanonicalGraphTransaction {
  id: string;
  timestamp: number;
  description?: string;
}

// ============================================================================
// Mutation Commands
// ============================================================================

/**
 * Commands that can mutate the graph state.
 * Processed atomically within a transaction.
 */
export type GraphMutationCommand =
  | {
      type: 'register-node';
      node: CanonicalNode;
    }
  | {
      type: 'update-node';
      nodeId: string;
      canonicalTokens?: string[];
      responsiveTokens?: ResponsiveTokenMap;
      metadata?: Partial<CanonicalNodeMetadata>;
      index?: number;
      parentId?: string | null;
    }
  | {
      type: 'remove-node';
      nodeId: string;
    }
  | {
      type: 'move-node';
      nodeId: string;
      parentId: string | null;
      index: number;
    }
  | {
      type: 'batch';
      commands: GraphMutationCommand[];
    };

// ============================================================================
// Store Interfaces
// ============================================================================

/**
 * Minimal store interface for read-only consumers.
 */
export interface ReadableGraphStore {
  getState: () => CanonicalGraphState;
  subscribe: (listener: (state: CanonicalGraphState) => void) => () => void;
}

/**
 * Options for transact method.
 */
export interface TransactOptions {
  /** Whether to track this transaction in undo history. Defaults to true. */
  trackUndo?: boolean;
}

/**
 * Full store interface with mutation capabilities.
 */
export interface GraphStore extends ReadableGraphStore {
  transact: (
    description: string,
    commands: GraphMutationCommand | GraphMutationCommand[],
    options?: TransactOptions
  ) => CanonicalGraphState;
  getNode: (nodeId: string) => CanonicalNode | null;
  listChildren: (parentId: string | null) => CanonicalNode[];
}

/**
 * Extended store interface with undo/redo support.
 */
export interface UndoableGraphStore extends GraphStore {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

export const INITIAL_STATE: CanonicalGraphState = {
  nodes: {},
  rootIds: [],
  version: 0,
  lastTransactionId: null
};

// ============================================================================
// Type Guards
// ============================================================================

export function isCanonicalNode(obj: unknown): obj is CanonicalNode {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'canonicalTokens' in obj &&
    Array.isArray((obj as CanonicalNode).canonicalTokens)
  );
}
