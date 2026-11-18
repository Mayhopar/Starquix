/**
 * Core State Utilities
 *
 * Functions for working with canonical graph state,
 * including breakpoint merging and class prefix detection.
 */

import type { CanonicalNode } from './types';
import { BREAKPOINT_ORDER } from './types';

// ============================================================================
// ID Generation
// ============================================================================

export const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fallback below
    }
  }
  return `node_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
};

// ============================================================================
// Class Prefix Detection
// ============================================================================

/**
 * Extract the utility prefix from a Tailwind class for conflict resolution.
 * Classes with the same prefix will override each other when merging breakpoints.
 */
export const getClassPrefix = (className: string): string | null => {
  // Text alignment
  if (/^text-(left|center|right|justify)$/.test(className)) {
    return 'text-align';
  }

  // Text size
  if (/^text-(xs|sm|base|lg|xl|[2-9]xl)$/.test(className)) {
    return 'text-size';
  }

  // Text color
  if (/^text-[\w\[\]-]+$/.test(className) &&
      !/^text-(left|center|right|justify|xs|sm|base|lg|xl|[2-9]xl)$/.test(className)) {
    return 'text-color';
  }

  // Font weight
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/.test(className)) {
    return 'font-weight';
  }

  // Font family
  if (/^font-(sans|serif|mono|[\w-]+)$/.test(className) &&
      !/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/.test(className)) {
    return 'font-family';
  }

  // Divide utilities - must be before other patterns
  // divide-x and divide-y are separate properties (can coexist)
  if (/^divide-x($|-\d+$|-\[.+\]$|-reverse$)/.test(className)) {
    return 'divide-x';
  }
  if (/^divide-y($|-\d+$|-\[.+\]$|-reverse$)/.test(className)) {
    return 'divide-y';
  }
  // divide-{color} classes for color
  if (/^divide-(transparent|current|inherit|white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)/.test(className) ||
      /^divide-\[#/.test(className)) {
    return 'divide-color';
  }

  // Handle other prefixes with standard patterns
  const prefixPatterns = [
    /^(leading-)[\w\[\]]+$/,
    /^(tracking-)[\w\[\]]+$/,
    /^(bg-)[\w\[\]]+$/,
    /^(border-)[\w\[\]]+$/,
    /^([pmwh](?:[trblxy])?)-.+$/,
    /^(gap(?:-[xy])?)-.+$/,
    /^(items-)[\w\[\]]+$/,
    /^(justify-)[\w\[\]]+$/,
    /^(flex-)[\w\[\]]+$/,
    /^(grid-)[\w\[\]]+$/,
    /^(col-span-)[\w\[\]]+$/,
    /^(row-span-)[\w\[\]]+$/,
    /^(rounded)(?:-[\w\[\]]+)?$/,
    /^(shadow)(?:-[\w\[\]]+)?$/,
    /^(opacity-)[\w\[\]]+$/,
    /^(z-)[\w\[\]]+$/,
    /^(overflow-)[\w\[\]]+$/,
  ];

  for (const pattern of prefixPatterns) {
    const match = className.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Display utilities
  const standaloneClasses = ['block', 'inline', 'inline-block', 'flex', 'grid', 'hidden', 'contents', 'table'];
  if (standaloneClasses.includes(className)) {
    return 'display';
  }

  return null;
};

// ============================================================================
// State Prefix Utilities (hover, active, focus, disabled)
// ============================================================================

export const STATE_PREFIXES = ['hover', 'active', 'focus', 'disabled'] as const;
export type StateName = typeof STATE_PREFIXES[number] | 'default';

/**
 * Parse a class string into state-separated token groups.
 * Example: "bg-blue-500 hover:bg-red-500" -> { default: ["bg-blue-500"], hover: ["bg-red-500"], ... }
 */
export const parseStateClasses = (classString: string): Record<StateName, string[]> => {
  const tokens = classString.trim().split(/\s+/).filter(Boolean);
  const states: Record<StateName, string[]> = {
    default: [],
    hover: [],
    active: [],
    focus: [],
    disabled: []
  };

  for (const token of tokens) {
    const match = token.match(/^(hover|active|focus|disabled):(.+)$/);
    if (match) {
      const [, state, className] = match;
      states[state as StateName].push(className);
    } else {
      states.default.push(token);
    }
  }

  return states;
};

/**
 * Serialize state-separated tokens back to a full class string.
 * Order: default classes first, then hover:, active:, focus:, disabled:
 */
export const serializeStateClasses = (states: Record<StateName, string[]>): string => {
  const parts: string[] = [...states.default];

  for (const state of STATE_PREFIXES) {
    const tokens = states[state];
    if (tokens && tokens.length > 0) {
      parts.push(...tokens.map(t => `${state}:${t}`));
    }
  }

  return parts.join(' ');
};

/**
 * Get effective classes for a state with inheritance from default.
 * For non-default states, merges default classes with state overrides.
 * Returns both the merged classes and a map of which prefixes have overrides.
 */
export const getEffectiveClassesForState = (
  classString: string,
  state: StateName
): { classes: string; hasOverride: Record<string, boolean> } => {
  const parsed = parseStateClasses(classString);

  if (state === 'default') {
    return { classes: parsed.default.join(' '), hasOverride: {} };
  }

  // Build a map of default classes by their utility prefix
  const classMap = new Map<string, string>();
  parsed.default.forEach(cls => {
    const prefix = getClassPrefix(cls);
    classMap.set(prefix || cls, cls);
  });

  // Track which prefixes have state overrides
  const hasOverride: Record<string, boolean> = {};

  // Apply state overrides - they replace classes with same prefix
  const stateTokens = parsed[state] || [];
  stateTokens.forEach(cls => {
    const prefix = getClassPrefix(cls);
    const key = prefix || cls;
    classMap.set(key, cls);
    if (prefix) hasOverride[prefix] = true;
  });

  return {
    classes: Array.from(classMap.values()).join(' '),
    hasOverride
  };
};

/**
 * Compute delta between default classes and new classes.
 * Returns only the classes that differ from default (for state storage).
 */
export const computeStateDelta = (
  defaultClasses: string[],
  newClasses: string[]
): string[] => {
  // Build map of default classes by prefix
  const defaultByPrefix = new Map<string, string>();
  defaultClasses.forEach(cls => {
    const prefix = getClassPrefix(cls);
    defaultByPrefix.set(prefix || cls, cls);
  });

  // Find classes in newClasses that differ from default
  const delta: string[] = [];
  newClasses.forEach(cls => {
    const prefix = getClassPrefix(cls);
    const key = prefix || cls;
    const defaultValue = defaultByPrefix.get(key);

    // Include if different from default or not in default
    if (defaultValue !== cls) {
      delta.push(cls);
    }
  });

  return delta;
};

// ============================================================================
// Class String Parsing
// ============================================================================

/**
 * Parse a class string into canonical and responsive tokens.
 * Example: "flex p-4 sm:p-2 md:p-6" -> { canonical: ["flex", "p-4"], responsive: { sm: ["p-2"], md: ["p-6"] } }
 */
export const parseClassString = (classString: string): {
  canonical: string[];
  responsive: Record<string, string[]>;
} => {
  const tokens = classString.trim().split(/\s+/).filter(Boolean);
  const canonical: string[] = [];
  const responsive: Record<string, string[]> = {};

  for (const token of tokens) {
    // Check for responsive prefix (e.g., sm:, md:, lg:)
    const match = token.match(/^(xs|sm|md|lg|xl|2xl):(.+)$/);
    if (match) {
      const [, breakpoint, className] = match;
      if (!responsive[breakpoint]) {
        responsive[breakpoint] = [];
      }
      responsive[breakpoint].push(className);
    } else {
      canonical.push(token);
    }
  }

  return { canonical, responsive };
};

/**
 * Serialize canonical and responsive tokens back to a class string.
 */
export const serializeTokens = (
  canonical: string[],
  responsive: Record<string, string[]>
): string => {
  const parts: string[] = [...canonical];

  // Add responsive tokens in breakpoint order
  for (const bp of BREAKPOINT_ORDER) {
    const tokens = responsive[bp];
    if (tokens && tokens.length > 0) {
      parts.push(...tokens.map(t => `${bp}:${t}`));
    }
  }

  return parts.join(' ');
};

// ============================================================================
// Breakpoint Class Utilities
// ============================================================================

export const PRIMARY_BREAKPOINT = 'xs';

/**
 * Parse a class string into base and breakpoint-specific tokens.
 * Base classes are those without any breakpoint prefix.
 * Example: "flex p-4 sm:p-2 md:p-6" -> { base: ["flex", "p-4"], breakpoints: { sm: ["p-2"], md: ["p-6"] } }
 */
export const parseBreakpointClasses = (classString: string): {
  base: string[];
  breakpoints: Record<string, string[]>;
} => {
  const { canonical, responsive } = parseClassString(classString);
  return { base: canonical, breakpoints: responsive };
};

/**
 * Serialize base and breakpoint tokens back to a full class string.
 */
export const serializeBreakpointClasses = (parsed: {
  base: string[];
  breakpoints: Record<string, string[]>;
}): string => {
  return serializeTokens(parsed.base, parsed.breakpoints);
};

/**
 * Get effective classes for a breakpoint with inheritance from base.
 * For non-primary breakpoints, merges base classes with breakpoint overrides.
 * Returns both the merged classes and a map of which prefixes have overrides.
 */
export const getEffectiveClassesForBreakpoint = (
  classString: string,
  breakpoint: string
): { classes: string; hasOverride: Record<string, boolean> } => {
  const { base, breakpoints } = parseBreakpointClasses(classString);

  // For primary breakpoint (xs), just return base classes
  if (breakpoint === PRIMARY_BREAKPOINT || breakpoint === 'xs') {
    return { classes: base.join(' '), hasOverride: {} };
  }

  // Build a map of base classes by their utility prefix
  const classMap = new Map<string, string>();
  base.forEach(cls => {
    const prefix = getClassPrefix(cls);
    classMap.set(prefix || cls, cls);
  });

  // Track which prefixes have breakpoint overrides
  const hasOverride: Record<string, boolean> = {};

  // Tailwind is mobile-first: apply ALL breakpoints up to and including current
  // e.g., at XL viewport, sm:, md:, lg:, and xl: classes all apply
  const breakpointOrder = ['sm', 'md', 'lg', 'xl', '2xl'];
  const currentIndex = breakpointOrder.indexOf(breakpoint);

  for (let i = 0; i <= currentIndex; i++) {
    const bp = breakpointOrder[i];
    const tokens = breakpoints[bp] || [];
    tokens.forEach(cls => {
      const prefix = getClassPrefix(cls);
      const key = prefix || cls;
      classMap.set(key, cls);
      if (prefix) hasOverride[prefix] = true;
    });
  }

  return {
    classes: Array.from(classMap.values()).join(' '),
    hasOverride
  };
};

/**
 * Compute delta between base classes and new classes.
 * Returns only the classes that differ from base (for breakpoint storage).
 */
export const computeBreakpointDelta = (
  baseClasses: string[],
  newClasses: string[]
): string[] => {
  // Build map of base classes by prefix
  const baseByPrefix = new Map<string, string>();
  baseClasses.forEach(cls => {
    const prefix = getClassPrefix(cls);
    baseByPrefix.set(prefix || cls, cls);
  });

  // Find classes in newClasses that differ from base
  const delta: string[] = [];
  newClasses.forEach(cls => {
    const prefix = getClassPrefix(cls);
    const key = prefix || cls;
    const baseValue = baseByPrefix.get(key);

    // Include if different from base or not in base
    if (baseValue !== cls) {
      delta.push(cls);
    }
  });

  return delta;
};

/**
 * Merge delta classes into existing breakpoint classes.
 * For each class in delta, replaces any class with the same prefix in existing.
 * Keeps existing classes that aren't affected by the delta.
 *
 * Example:
 *   existing: ["w-[640px]", "cursor-pointer"]
 *   delta: ["cursor-not-allowed"]
 *   result: ["w-[640px]", "cursor-not-allowed"]
 */
export const mergeClassesByPrefix = (
  existing: string[],
  delta: string[]
): string[] => {
  // Build a map of existing classes by prefix
  const classMap = new Map<string, string>();
  existing.forEach(cls => {
    const prefix = getClassPrefix(cls);
    classMap.set(prefix || cls, cls);
  });

  // Apply delta - replaces same-prefix classes
  delta.forEach(cls => {
    const prefix = getClassPrefix(cls);
    classMap.set(prefix || cls, cls);
  });

  return Array.from(classMap.values());
};

/**
 * Remove a specific breakpoint override for a utility prefix.
 * Returns the new class string with that override removed.
 */
export const removeBreakpointOverride = (
  classString: string,
  breakpoint: string,
  utilityPrefix: string
): string => {
  const { base, breakpoints } = parseBreakpointClasses(classString);

  if (breakpoints[breakpoint]) {
    breakpoints[breakpoint] = breakpoints[breakpoint].filter(cls => {
      const prefix = getClassPrefix(cls);
      return (prefix || cls) !== utilityPrefix;
    });
  }

  return serializeBreakpointClasses({ base, breakpoints });
};

/**
 * Check if a specific utility has an override at a breakpoint.
 */
export const hasBreakpointOverride = (
  classString: string,
  breakpoint: string,
  utilityPrefix: string
): boolean => {
  const { breakpoints } = parseBreakpointClasses(classString);
  const tokens = breakpoints[breakpoint] || [];

  return tokens.some(cls => {
    const prefix = getClassPrefix(cls);
    return (prefix || cls) === utilityPrefix;
  });
};

/**
 * Get the breakpoint-specific value for a utility prefix.
 * Returns null if no override exists.
 */
export const getBreakpointOverrideValue = (
  classString: string,
  breakpoint: string,
  utilityPrefix: string
): string | null => {
  const { breakpoints } = parseBreakpointClasses(classString);
  const tokens = breakpoints[breakpoint] || [];

  const found = tokens.find(cls => {
    const prefix = getClassPrefix(cls);
    return (prefix || cls) === utilityPrefix;
  });

  return found || null;
};

// ============================================================================
// Node Utilities
// ============================================================================

/**
 * Clone a node with deep copies of arrays and objects
 */
export const cloneNode = (node: CanonicalNode): CanonicalNode => ({
  ...node,
  canonicalTokens: [...node.canonicalTokens],
  responsiveTokens: Object.fromEntries(
    Object.entries(node.responsiveTokens).map(([breakpoint, tokens]) => [
      breakpoint,
      [...tokens]
    ])
  ),
  metadata: {
    ...node.metadata,
    // Deep clone dataset to prevent shared references
    dataset: node.metadata.dataset ? { ...node.metadata.dataset } : undefined
  }
});

/**
 * Create an empty graph node with defaults
 */
export const createEmptyGraphNode = (
  partial: Partial<CanonicalNode> & Pick<CanonicalNode, 'id'>
): CanonicalNode => ({
  id: partial.id,
  parentId: partial.parentId ?? null,
  index: partial.index ?? 0,
  kind: partial.kind ?? 'element',
  canonicalTokens: partial.canonicalTokens ? [...partial.canonicalTokens] : [],
  responsiveTokens: partial.responsiveTokens
    ? Object.fromEntries(
        Object.entries(partial.responsiveTokens).map(([breakpoint, tokens]) => [
          breakpoint,
          [...tokens]
        ])
      )
    : {},
  metadata: {
    displayName: partial.metadata?.displayName,
    dataset: partial.metadata?.dataset ? { ...partial.metadata.dataset } : undefined,
    locked: partial.metadata?.locked ?? false,
    selectable: partial.metadata?.selectable ?? true,
    sourceLocation: partial.metadata?.sourceLocation,
    sourceEditable: partial.metadata?.sourceEditable ?? true,
    tagName: partial.metadata?.tagName
  },
  version: partial.version ?? 0,
  lastMutationId: partial.lastMutationId ?? null
});
