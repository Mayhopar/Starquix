/**
 * State Context
 *
 * Manages the active editing state (default, hover, active, focus, disabled)
 * for the DesignBar. When a non-default state is selected, the DesignBar
 * filters classes to show that state's values and adds the appropriate
 * prefix when saving changes.
 */

import React, {
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';
import type { StateName } from '@/core/state/utils';
import { stableContext } from '@/utils/stableContext';

// ============================================================================
// Types
// ============================================================================

export interface StateContextValue {
  /** Currently active state for editing */
  activeState: StateName;
  /** Set the active editing state */
  setActiveState: (state: StateName) => void;
  /** Whether we're editing a non-default state */
  isEditingState: boolean;
  /** Reset to default state */
  resetToDefault: () => void;
}

const StateContext = stableContext<StateContextValue | null>('StateContext', null);

// ============================================================================
// Provider
// ============================================================================

interface StateProviderProps {
  children: React.ReactNode;
  /** Callback when active state changes (for syncing to iframe) */
  onStateChange?: (state: StateName) => void;
}

export const StateProvider: React.FC<StateProviderProps> = ({
  children,
  onStateChange
}) => {
  const [activeState, setActiveStateInternal] = useState<StateName>('default');

  const setActiveState = useCallback((state: StateName) => {
    setActiveStateInternal(state);
    onStateChange?.(state);
  }, [onStateChange]);

  const resetToDefault = useCallback(() => {
    setActiveStateInternal('default');
    onStateChange?.('default');
  }, [onStateChange]);

  const value = useMemo<StateContextValue>(() => ({
    activeState,
    setActiveState,
    isEditingState: activeState !== 'default',
    resetToDefault
  }), [activeState, setActiveState, resetToDefault]);

  return (
    <StateContext.Provider value={value}>
      {children}
    </StateContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

export const useActiveState = (): StateContextValue => {
  const context = useContext(StateContext);
  if (!context) {
    throw new Error('useActiveState must be used within a StateProvider');
  }
  return context;
};

export default StateContext;
