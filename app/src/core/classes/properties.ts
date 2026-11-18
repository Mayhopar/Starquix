/**
 * Unified Class System - Property Groups
 *
 * Identifies what property a class controls for replacement logic.
 */

import { PROPERTY_PREFIXES, STANDALONE_GROUPS, ARBITRARY_PATTERNS } from './constants';

/**
 * Get the property group for a class name (WITHOUT prefixes).
 *
 * @example
 * getPropertyGroup('bg-red-500')     // 'bg-'
 * getPropertyGroup('p-4')            // 'p-'
 * getPropertyGroup('min-w-full')     // 'min-w-'
 * getPropertyGroup('relative')       // 'standalone:position'
 * getPropertyGroup('flex')           // 'standalone:display'
 * getPropertyGroup('border-[3px]')   // 'standalone:borderWidth'
 * getPropertyGroup('my-custom-class') // 'unique:my-custom-class'
 */
export function getPropertyGroup(className: string): string {
  // Check standalone classes first (exact matches)
  for (const [group, classes] of Object.entries(STANDALONE_GROUPS)) {
    if (classes.includes(className)) {
      return `standalone:${group}`;
    }
  }

  // Check arbitrary patterns (for classes like border-[3px])
  for (const [group, pattern] of Object.entries(ARBITRARY_PATTERNS)) {
    if (pattern.test(className)) {
      return group;
    }
  }

  // Check prefixes (already sorted by length, longest first)
  for (const prefix of PROPERTY_PREFIXES) {
    if (className.startsWith(prefix)) {
      return prefix;
    }
  }

  // Unknown class - use full class as its own group (won't replace anything else)
  return `unique:${className}`;
}

/**
 * Check if two classes belong to the same property group.
 */
export function samePropertyGroup(class1: string, class2: string): boolean {
  return getPropertyGroup(class1) === getPropertyGroup(class2);
}

/**
 * Get all classes in a list that have a specific property group.
 */
export function getClassesByGroup(classes: string[], group: string): string[] {
  return classes.filter(cls => getPropertyGroup(cls) === group);
}

/**
 * Remove all classes with a specific property group from a list.
 */
export function removeClassesByGroup(classes: string[], group: string): string[] {
  return classes.filter(cls => getPropertyGroup(cls) !== group);
}
