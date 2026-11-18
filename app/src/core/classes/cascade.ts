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
  const result = new Map<string, string>(); // group -> class

  // Get breakpoint index for cascade
  const bpIndex = BREAKPOINTS.indexOf(breakpoint);

  // Apply cascade: smaller breakpoints first, then current
  for (let i = 0; i <= bpIndex; i++) {
    const bp = BREAKPOINTS[i];

    // First apply light theme default state
    for (const cls of storage[bp].light.default) {
      result.set(getPropertyGroup(cls), cls);
    }

    // Then apply light theme target state (if not default)
    if (state !== 'default') {
      for (const cls of storage[bp].light[state]) {
        result.set(getPropertyGroup(cls), cls);
      }
    }

    // If dark theme, apply dark overrides
    if (theme === 'dark') {
      // Apply dark theme default state
      for (const cls of storage[bp].dark.default) {
        result.set(getPropertyGroup(cls), cls);
      }

      // Then apply dark theme target state (if not default)
      if (state !== 'default') {
        for (const cls of storage[bp].dark[state]) {
          result.set(getPropertyGroup(cls), cls);
        }
      }
    }
  }

  return Array.from(result.values());
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

  // Build map of inherited property groups
  const inheritedByGroup = new Map<string, string>();
  inherited.forEach(cls => {
    inheritedByGroup.set(getPropertyGroup(cls), cls);
  });

  // Only store classes that differ from inherited
  const toStore: string[] = [];
  newEffectiveClasses.forEach(cls => {
    const group = getPropertyGroup(cls);
    const inheritedCls = inheritedByGroup.get(group);
    if (inheritedCls !== cls) {
      // Different from inherited, or not inherited at all - store it
      toStore.push(cls);
    }
    // If same as inherited, don't store (let inheritance work)
  });

  return toStore;
}
