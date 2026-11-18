/**
 * DesignBar Context
 *
 * Provides breakpoint override information and the selection descriptor to
 * block components. Blocks use the overrides to show override pills, and the
 * descriptor to know what kind of entity is selected without prop drilling.
 */

import React, { useContext } from 'react';
import type { SelectionDescriptor } from './selectionDescriptor';
import { stableContext } from '@/utils/stableContext';

export interface DesignBarContextValue {
  /** Which utility prefixes have overrides at the current breakpoint */
  breakpointOverrides: Record<string, boolean>;
  /** Current active breakpoint */
  activeBreakpoint: string;
  /** Whether editing a non-primary breakpoint */
  isEditingBreakpoint: boolean;
  /** Callback to remove a breakpoint override for a utility prefix */
  onRemoveBreakpointOverride: (utilityPrefix: string) => void;
  /** What is selected and what kind of thing it is (deriveSelectionDescriptor).
   *  Sub-panels switch on this instead of receiving kind booleans as props. */
  descriptor: SelectionDescriptor;
  /** Set while ≥2 elements are selected (multi/MultiDesignPanel): each live member's effective classes at
   *  the current breakpoint/theme/state. Controls compare their own parsed value to read "Mixed" (C6). */
  multi?: { memberClasses: readonly string[] };
}

const DesignBarContext = stableContext<DesignBarContextValue | null>('DesignBarContext', null);

export const DesignBarProvider = DesignBarContext.Provider;

/**
 * Hook to access breakpoint override info in blocks.
 * Returns null if not within a DesignBarProvider.
 */
export const useDesignBarContext = (): DesignBarContextValue | null => {
  return useContext(DesignBarContext);
};

export default DesignBarContext;
