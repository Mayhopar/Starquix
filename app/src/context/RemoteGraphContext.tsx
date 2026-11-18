/**
 * Remote Graph Context
 *
 * Provides access to the graph store that lives in the extension host.
 * Sends commands via postMessage, receives state updates back.
 */

import React, {
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode
} from 'react';
import type {
  CanonicalGraphState,
  CanonicalNode,
  GraphMutationCommand,
  TransactOptions
} from '@/core/state/index';
import { stableContext } from '@/utils/stableContext';

// ============================================================================
// Types
// ============================================================================

export interface RemoteGraphApi {
  /** Current state snapshot (updated via messages) */
  state: CanonicalGraphState;
  /** Send a transact command to the host */
  transact: (
    description: string,
    commands: GraphMutationCommand | GraphMutationCommand[],
    options?: TransactOptions
  ) => void;
  /** Get a node from current state */
  getNode: (id: string) => CanonicalNode | null;
  /** Trigger undo on host */
  undo: () => void;
  /** Trigger redo on host */
  redo: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Check if currently in an undo/redo operation (for ClassStoreContext compatibility) */
  isUndoingOrRedoing: () => boolean;
}

const EMPTY_STATE: CanonicalGraphState = {
  nodes: {},
  rootIds: [],
  version: 0,
  lastTransactionId: null
};

const RemoteGraphContext = stableContext<RemoteGraphApi | null>('RemoteGraphContext', null);

// Context for subscriber storage - each provider has its own subscribers
interface SubscriberStore {
  subscribers: Set<(state: CanonicalGraphState) => void>;
  lastNotifiedState: CanonicalGraphState | null;
}
const SubscriberContext = stableContext<React.MutableRefObject<SubscriberStore> | null>('SubscriberContext', null);

// ============================================================================
// Provider
// ============================================================================

interface RemoteGraphProviderProps {
  children: ReactNode;
  postMessage: (message: unknown) => void;
}

export const RemoteGraphProvider: React.FC<RemoteGraphProviderProps> = ({
  children,
  postMessage
}) => {
  const [state, setState] = useState<CanonicalGraphState>(EMPTY_STATE);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const isUndoingOrRedoingRef = useRef(false);

  // Per-provider subscriber storage (not module-level to avoid cross-talk between instances)
  const subscriberStoreRef = useRef<SubscriberStore>({
    subscribers: new Set(),
    lastNotifiedState: null
  });

  // Listen for state updates from host
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'GRAPH_STATE_UPDATE') return;

      const { state: newState, canUndo: newCanUndo, canRedo: newCanRedo } = data.payload;
      setState(newState);
      setCanUndo(newCanUndo);
      setCanRedo(newCanRedo);

      // Reset undo/redo flag after state update arrives
      isUndoingOrRedoingRef.current = false;
    };

    window.addEventListener('message', handleMessage);

    // Request initial state
    postMessage({ type: 'GRAPH_REQUEST_STATE' });

    return () => window.removeEventListener('message', handleMessage);
  }, [postMessage]);

  const transact = useCallback((
    description: string,
    commands: GraphMutationCommand | GraphMutationCommand[],
    options?: TransactOptions
  ) => {
    postMessage({
      type: 'GRAPH_TRANSACT',
      payload: { description, commands, options }
    });
  }, [postMessage]);

  const getNode = useCallback((id: string): CanonicalNode | null => {
    return state.nodes[id] || null;
  }, [state]);

  const undo = useCallback(() => {
    isUndoingOrRedoingRef.current = true;
    postMessage({ type: 'GRAPH_UNDO' });
  }, [postMessage]);

  const redo = useCallback(() => {
    isUndoingOrRedoingRef.current = true;
    postMessage({ type: 'GRAPH_REDO' });
  }, [postMessage]);

  const isUndoingOrRedoing = useCallback(() => {
    return isUndoingOrRedoingRef.current;
  }, []);

  const api = useMemo<RemoteGraphApi>(() => ({
    state,
    transact,
    getNode,
    undo,
    redo,
    canUndo,
    canRedo,
    isUndoingOrRedoing
  }), [state, transact, getNode, undo, redo, canUndo, canRedo, isUndoingOrRedoing]);

  return (
    <RemoteGraphContext.Provider value={api}>
      <SubscriberContext.Provider value={subscriberStoreRef}>
        {children}
      </SubscriberContext.Provider>
    </RemoteGraphContext.Provider>
  );
};

// ============================================================================
// Hooks
// ============================================================================

export const useRemoteGraph = (): RemoteGraphApi => {
  const context = useContext(RemoteGraphContext);
  if (!context) {
    throw new Error('useRemoteGraph must be used within RemoteGraphProvider');
  }
  return context;
};

// Re-export types for convenience
export type { CanonicalGraphState, CanonicalNode, GraphMutationCommand };
