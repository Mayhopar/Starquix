/**
 * Unified Class System - Merge Utilities
 *
 * Provides slot-based class merging for combining base classes with overrides.
 * Used by ClassStoreContext, generateAstro, and selectors for consistent behavior.
 */

import { getPropertyGroup } from './properties';

/**
 * Slots that conflict with each other beyond exact-slot match. When an
 * override names any slot on the right-hand side, the shorthand slot on the
 * left-hand side must be cleared from the base — otherwise a push that
 * refines `p-5` into `px-0 py-10` leaves `p-5` in the source, which Tailwind
 * quietly still applies first and clutters the file.
 */
const SHORTHAND_FAMILIES: Record<string, readonly string[]> = {
  'p-': ['px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-'],
  'px-': ['pl-', 'pr-'],
  'py-': ['pt-', 'pb-'],
  'm-': ['mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-'],
  'mx-': ['ml-', 'mr-'],
  'my-': ['mt-', 'mb-'],
};

/**
 * Given a slot, return the set of base slots it should clear in addition to
 * its own. Modifier prefixes (`md:`, `hover:`, …) are preserved: `md:px-` only
 * clears `md:pl-` / `md:pr-`, not their unprefixed counterparts.
 */
function slotsClearedBy(slot: string): string[] {
  const colonIndex = slot.lastIndexOf(':');
  const prefix = colonIndex >= 0 ? slot.slice(0, colonIndex + 1) : '';
  const base = colonIndex >= 0 ? slot.slice(colonIndex + 1) : slot;
  const conflicts = SHORTHAND_FAMILIES[base];
  return conflicts ? conflicts.map(c => prefix + c) : [];
}

/**
 * Find the last modifier colon in a Tailwind class name.
 * Colons inside square brackets (arbitrary values) are not modifier separators.
 *
 * @example
 * findLastModifierColon('bg-red-500')           // -1
 * findLastModifierColon('xl:bg-red-500')        // 2
 * findLastModifierColon('bg-[url(data:image)]') // -1 (colon is inside brackets)
 * findLastModifierColon('md:bg-[url(data:image)]') // 2
 */
function findLastModifierColon(className: string): number {
  let bracketDepth = 0;
  let lastColonOutsideBrackets = -1;

  for (let i = 0; i < className.length; i++) {
    const char = className[i];
    if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === ':' && bracketDepth === 0) {
      lastColonOutsideBrackets = i;
    }
  }

  return lastColonOutsideBrackets;
}

/**
 * Get the property slot for a class, including responsive/modifier prefix handling.
 * Wraps getPropertyGroup with modifier prefix extraction.
 *
 * @example
 * getPropertySlot('bg-red-500')           // 'bg-'
 * getPropertySlot('xl:bg-red-500')        // 'xl:bg-'
 * getPropertySlot('xl:dark:hover:bg-red-500') // 'xl:dark:hover:bg-'
 * getPropertySlot('font-sans')            // 'standalone:fontFamily'
 * getPropertySlot('md:font-bold')         // 'md:standalone:fontWeight'
 * getPropertySlot('bg-[url(data:image)]') // 'bg-' (colon in arbitrary value ignored)
 */
export function getPropertySlot(className: string): string {
  // Extract modifier prefix and base class
  // e.g., 'xl:dark:hover:bg-red-500' → modifierPrefix='xl:dark:hover:', baseClass='bg-red-500'
  // Note: colons inside brackets are part of arbitrary values, not modifiers
  const colonIndex = findLastModifierColon(className);
  const modifierPrefix = colonIndex >= 0 ? className.slice(0, colonIndex + 1) : '';
  const baseClass = colonIndex >= 0 ? className.slice(colonIndex + 1) : className;

  // Use getPropertyGroup from core classes system - it handles standalone groups
  // (fontFamily, fontWeight, textSize, etc.) that share prefixes but are different slots
  const group = getPropertyGroup(baseClass);

  return modifierPrefix + group;
}

/**
 * Merge classes using slot-based replacement.
 * Override classes replace base classes with the same property slot; every override token of a slot is kept
 * (ring-2 ring-blue-500 share a slot and both stay — audit #2).
 *
 * @example
 * mergeClasses('bg-red-500 text-white', 'bg-blue-500')
 * // → 'bg-blue-500 text-white'
 *
 * mergeClasses('font-sans text-red-500', 'font-serif')
 * // → 'font-serif text-red-500' (font family doesn't clobber text color)
 *
 * mergeClasses('p-4 m-2', 'p-8 rounded-lg')
 * // → 'p-8 m-2 rounded-lg'
 *
 * mergeClasses(null, 'bg-red-500')
 * // → 'bg-red-500' (handles null/undefined gracefully)
 */
export function mergeClasses(
  baseClasses: string | string[] | null | undefined,
  overrideClasses: string | string[] | null | undefined
): string {
  // Handle null/undefined inputs
  const baseArr = !baseClasses
    ? []
    : typeof baseClasses === 'string'
      ? baseClasses.split(/\s+/).filter(Boolean)
      : baseClasses.filter(Boolean);
  const overrideArr = !overrideClasses
    ? []
    : typeof overrideClasses === 'string'
      ? overrideClasses.split(/\s+/).filter(Boolean)
      : overrideClasses.filter(Boolean);

  if (overrideArr.length === 0) return baseArr.join(' ');

  // Build map of override slots
  const overrideBySlot = new Map<string, string[]>();
  for (const cls of overrideArr) {
    const slot = getPropertySlot(cls);
    overrideBySlot.set(slot, [...overrideBySlot.get(slot) ?? [], cls]);
  }

  // Slots cleared transitively by overrides (e.g. `px-0` clears existing
  // `p-*` and `pl-*`/`pr-*` in base). A base class in one of these slots is
  // dropped without being replaced.
  const clearedSlots = new Set<string>();
  for (const slot of overrideBySlot.keys()) {
    for (const cleared of slotsClearedBy(slot)) clearedSlots.add(cleared);
  }

  const result: string[] = [];
  const usedSlots = new Set<string>();

  // Replace base classes where slots match; drop base classes in cleared slots
  for (const cls of baseArr) {
    const slot = getPropertySlot(cls);
    if (overrideBySlot.has(slot)) {
      if (!usedSlots.has(slot)) {
        result.push(...overrideBySlot.get(slot)!);
        usedSlots.add(slot);
      }
    } else if (clearedSlots.has(slot)) {
      // Shorthand/axis superseded by a more specific override — drop it.
    } else {
      result.push(cls);
    }
  }

  // Add override classes that didn't replace existing slots
  for (const [slot, classes] of overrideBySlot) {
    if (!usedSlots.has(slot)) {
      result.push(...classes);
    }
  }

  return result.join(' ');
}

/**
 * Token-SET equality between a token list and a class string — order- and
 * duplicate-insensitive. THE no-op-override predicate (task-102): the
 * asterisk/divergence read side and the write-side override dedup must agree
 * on this exact comparison or phantom indicators reappear.
 */
export function sameTokenSet(tokens: string[], classString: string): boolean {
  const a = new Set(tokens);
  const b = new Set(classString.split(/\s+/).filter(Boolean));
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}
