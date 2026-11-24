/**
 * Unified Class System - Cascade Resolution
 *
 * Resolves effective classes using Tailwind's mobile-first inheritance.
 */

import type { Breakpoint, State, Theme, ClassStorage } from './types';
import { BREAKPOINTS } from './types';
import { getPropertyGroup } from './properties';
import { cloneStorage } from './parser';

/**
 * Get the effective classes for a specific breakpoint, theme, and state,
 * applying mobile-first cascade inheritance with theme layering.
 *
 * Cascade order (later overrides earlier):
 * 1. xs.light.default (base styles)
 * 2. xs.light.[state] (state-specific base)
 * 3. [breakpoint].light.default (breakpoint base)
 * 4. [breakpoint].light.[state] (breakpoint + state specific)
 * 5. If theme === 'dark': apply dark overrides at each breakpoint
 *
 * @example
 * // storage has: xs.light.default: ['p-4', 'bg-white'], xs.dark.default: ['bg-gray-800'], md.light.default: ['pr-8']
 * getEffectiveClasses(storage, 'md', 'dark', 'hover')
 * // Returns: ['p-4', 'bg-gray-800', 'pr-8']
 * // - p-4 from xs.light.default (no dark override)
 * // - bg-gray-800 from xs.dark.default (overrides bg-white)
 * // - pr-8 from md.light.default (cascades up)
 */
export function getEffectiveClasses(
  storage: ClassStorage,
  breakpoint: Breakpoint,
  theme: Theme,
  state: State
): string[] {
  let result: string[] = [];
  // A slot overrides the property groups it sets in the slots before it and keeps every token of its own: two tokens
  // of one slot (ring-2 ring-blue-500, flex … hidden) are Tailwind's to order, never the editor's to drop (audit #2, #7).
  const apply = (slot: string[]) => {
    const groups = new Set(slot.map(getPropertyGroup));
    result = [...result.filter(cls => !groups.has(getPropertyGroup(cls))), ...slot];
  };

  // Apply cascade: smaller breakpoints first, then current
  for (const bp of BREAKPOINTS.slice(0, BREAKPOINTS.indexOf(breakpoint) + 1)) {
    apply(storage[bp].light.default);
    if (state !== 'default') apply(storage[bp].light[state]);
    // If dark theme, apply dark overrides
    if (theme === 'dark') {
      apply(storage[bp].dark.default);
      if (state !== 'default') apply(storage[bp].dark[state]);
    }
  }

  return result;
}

/**
 * Compute what classes should be stored at a slot, given new effective classes.
 * For base slot (xs.light.default), stores everything.
 * For override slots, only stores classes that differ from inherited.
 */
export function computeSlotContent(
  storage: ClassStorage,
  breakpoint: Breakpoint,
  theme: Theme,
  state: State,
  newEffectiveClasses: string[]
): string[] {
  if (breakpoint === 'xs' && theme === 'light' && state === 'default') {
    // Base slot - store everything
    return newEffectiveClasses;
  }

  // Get inherited classes by temporarily clearing current slot
  const tempStorage = cloneStorage(storage);
  tempStorage[breakpoint][theme][state] = [];
  const inherited = getEffectiveClasses(tempStorage, breakpoint, theme, state);

  // The slot stores a property group only when its tokens differ from the inherited ones (it then overrides them all).
  const groupTokens = (tokens: string[], group: string) => tokens.filter(t => getPropertyGroup(t) === group).sort().join(' ');
  return newEffectiveClasses.filter(cls => {
    const group = getPropertyGroup(cls);
    return groupTokens(newEffectiveClasses, group) !== groupTokens(inherited, group);
  });
}
