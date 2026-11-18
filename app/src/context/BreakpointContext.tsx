/**
 * Breakpoint Context
 *
 * Manages the editing target for responsive styles.
 * Reads the viewport breakpoint from Yjs (single source of truth).
 *
 * - viewportBreakpoint: The breakpoint corresponding to current preview width (from Yjs)
 * - activeBreakpoint: What we're editing - either 'xs' (base) or the viewport breakpoint
 * - isEditingBreakpoint: True when editing viewport-specific overrides (not base)
 */

import React, {
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';
import { useYjsValue } from '@/store/hooks';
import { selectCurrentBreakpoint } from '@/store/selectors';
import type { Breakpoint as StoreBreakpoint } from '@/store/types';
import type { Breakpoint as BreakpointName } from '@/core/classes/types';
import { stableContext } from '@/utils/stableContext';

// ============================================================================
// Types
// ============================================================================

export { BREAKPOINTS as BREAKPOINT_ORDER } from '@/core/classes/types';
export type { Breakpoint as BreakpointName } from '@/core/classes/types';

export const PRIMARY_BREAKPOINT: BreakpointName = 'xs';

export interface BreakpointContextValue {
  /** The breakpoint for the current viewport size (from Yjs store) */
  viewportBreakpoint: BreakpointName;
  /** Currently active breakpoint for editing (base 'xs' or viewport breakpoint) */
  activeBreakpoint: BreakpointName;
  /** Set the active editing breakpoint */
  setActiveBreakpoint: (breakpoint: BreakpointName) => void;
  /** Whether we're editing a non-primary breakpoint */
  isEditingBreakpoint: boolean;
  /** Reset to primary breakpoint */
  resetToPrimary: () => void;
  /** Get prefix for current breakpoint (empty for xs) */
  getPrefix: () => string;
}

const BreakpointContext = stableContext<BreakpointContextValue | null>('BreakpointContext', null);

// ============================================================================
// Provider
// ============================================================================

interface BreakpointProviderProps {
  children: React.ReactNode;
  /** Callback when active breakpoint changes */
  onBreakpointChange?: (breakpoint: BreakpointName) => void;
}

// Map store breakpoint ('base') to context breakpoint ('xs')
function mapStoreToContext(storeBreakpoint: StoreBreakpoint): BreakpointName {
  return storeBreakpoint === 'base' ? 'xs' : storeBreakpoint;
}

export const BreakpointProvider: React.FC<BreakpointProviderProps> = ({
  children,
  onBreakpointChange
}) => {
  // Read viewport breakpoint from Yjs (single source of truth)
  const storeBreakpoint = useYjsValue(selectCurrentBreakpoint);
  const viewportBreakpoint = mapStoreToContext(storeBreakpoint);

  // What we're editing: 'xs' for base, or an EXPLICITLY chosen breakpoint.
  // User call 2026-07-03 (reverses task-094 B3 auto-follow): the editing
  // layer never follows the viewport/frame breakpoint — not at mount (the
  // restored frame at 'lg' kept resurrecting an lg chip on every reload) and
  // not on later frame switches. Overrides are opt-in via the + chip / a tag
  // click (setActiveBreakpoint). Canvas grid writes stamp the FRAME breakpoint
  // (a drag on an lg frame writes lg: tokens), so the panel's grid Start/Span
  // fields read and write that same layer, whatever the editing layer is
  // (2026-11-12: base edits beside lg: placement changed nothing on canvas).
  const [activeBreakpoint, setActiveBreakpointInternal] = useState<BreakpointName>(PRIMARY_BREAKPOINT);

  const setActiveBreakpoint = useCallback((breakpoint: BreakpointName) => {
    setActiveBreakpointInternal(breakpoint);
    onBreakpointChange?.(breakpoint);
  }, [onBreakpointChange]);

  const resetToPrimary = useCallback(() => {
    setActiveBreakpoint(PRIMARY_BREAKPOINT);
  }, [setActiveBreakpoint]);

  const getPrefix = useCallback(() => {
    return activeBreakpoint === PRIMARY_BREAKPOINT ? '' : `${activeBreakpoint}:`;
  }, [activeBreakpoint]);

  const value = useMemo<BreakpointContextValue>(() => ({
    viewportBreakpoint,
    activeBreakpoint,
    setActiveBreakpoint,
    isEditingBreakpoint: activeBreakpoint !== PRIMARY_BREAKPOINT,
    resetToPrimary,
    getPrefix
  }), [viewportBreakpoint, activeBreakpoint, setActiveBreakpoint, resetToPrimary, getPrefix]);

  return (
    <BreakpointContext.Provider value={value}>
      {children}
    </BreakpointContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

export const useActiveBreakpoint = (): BreakpointContextValue => {
  const context = useContext(BreakpointContext);
  if (!context) {
    throw new Error('useActiveBreakpoint must be used within a BreakpointProvider');
  }
  return context;
};

export default BreakpointContext;
