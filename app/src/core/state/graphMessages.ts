/**
 * Graph Store Message Protocol
 *
 * Messages between extension host (store owner) and webview (UI).
 */

import type {
  GraphMutationCommand,
  CanonicalGraphState,
  TransactOptions
} from './types';

// ============================================================================
// Webview → Host (Commands)
// ============================================================================

export interface GraphTransactMessage {
  type: 'GRAPH_TRANSACT';
  payload: {
    description: string;
    commands: GraphMutationCommand | GraphMutationCommand[];
    options?: TransactOptions;
  };
}

export interface GraphUndoMessage {
  type: 'GRAPH_UNDO';
}

export interface GraphRedoMessage {
  type: 'GRAPH_REDO';
}

export interface GraphRequestStateMessage {
  type: 'GRAPH_REQUEST_STATE';
}

export type GraphCommandMessage =
  | GraphTransactMessage
  | GraphUndoMessage
  | GraphRedoMessage
  | GraphRequestStateMessage;

// ============================================================================
// Host → Webview (State Updates)
// ============================================================================

export interface GraphStateUpdateMessage {
  type: 'GRAPH_STATE_UPDATE';
  payload: {
    state: CanonicalGraphState;
    canUndo: boolean;
    canRedo: boolean;
  };
}

export type GraphStateMessage = GraphStateUpdateMessage;

// ============================================================================
// Type Guards
// ============================================================================

export function isGraphCommandMessage(msg: unknown): msg is GraphCommandMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: string };
  return m.type === 'GRAPH_TRANSACT'
    || m.type === 'GRAPH_UNDO'
    || m.type === 'GRAPH_REDO'
    || m.type === 'GRAPH_REQUEST_STATE';
}
