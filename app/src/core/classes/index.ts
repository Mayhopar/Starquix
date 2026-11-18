/**
 * Unified Class System
 *
 * Single system to handle ALL Tailwind class operations:
 * - Responsive breakpoints (xs, sm, md, lg, xl, 2xl)
 * - Interaction states (default, hover, focus, active, disabled)
 * - Property-aware replacement (same property group replaces, different groups accumulate)
 *
 * @example
 * import { parseClasses, serializeClasses, getEffectiveClasses } from '@/core/classes';
 *
 * // Parse a class string into hierarchical storage
 * const storage = parseClasses('p-4 md:pr-8 hover:bg-blue-500 lg:focus:ring-2');
 *
 * // Get effective classes for a viewport/state
 * const effective = getEffectiveClasses(storage, 'lg', 'hover');
 *
 * // Serialize back to string
 * const classString = serializeClasses(storage);
 */

// Types
export type { Breakpoint, State, Theme, ClassStorage } from './types';

// Parser
export { parseClasses, serializeClasses, cloneStorage } from './parser';

// Properties
export { getPropertyGroup } from './properties';

// Cascade Resolution
export { getEffectiveClasses, computeSlotContent } from './cascade';
export { mergeMemberTokens, changedGroups, applyGroupEdit, applyOwnedEdit, editMemberAtSlot, type MergedTokens, type ClassSlot } from './multiEdit';

// Merge Utilities
export { mergeClasses, sameTokenSet } from './merge';
