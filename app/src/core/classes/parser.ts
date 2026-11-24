/**
 * Unified Class System - Parser
 *
 * Single parser that handles both breakpoint AND state prefixes in one pass.
 */

import type { Breakpoint, State, Theme, ClassStorage, ParsedToken } from './types';
import { BREAKPOINTS, STATES, THEMES } from './types';
import { BREAKPOINT_PREFIXES, STATE_PREFIXES, THEME_PREFIXES } from './constants';

/**
 * Create an empty ClassStorage with all slots initialized.
 */
function createEmptyStorage(): ClassStorage {
  const storage = {} as ClassStorage;
  for (const bp of BREAKPOINTS) {
    storage[bp] = {} as ClassStorage[Breakpoint];
    for (const theme of THEMES) {
      storage[bp][theme] = {} as ClassStorage[Breakpoint][Theme];
      for (const state of STATES) {
        storage[bp][theme][state] = [];
      }
    }
  }
  return storage;
}

/**
 * Parse a single class token into breakpoint, theme, state, and className.
 *
 * @example
 * parseToken('bg-red-500')           // { breakpoint: 'xs', theme: 'light', state: 'default', className: 'bg-red-500' }
 * parseToken('md:bg-blue-500')       // { breakpoint: 'md', theme: 'light', state: 'default', className: 'bg-blue-500' }
 * parseToken('dark:bg-gray-800')     // { breakpoint: 'xs', theme: 'dark', state: 'default', className: 'bg-gray-800' }
 * parseToken('hover:bg-green-500')   // { breakpoint: 'xs', theme: 'light', state: 'hover', className: 'bg-green-500' }
 * parseToken('md:dark:hover:bg-purple-500') // { breakpoint: 'md', theme: 'dark', state: 'hover', className: 'bg-purple-500' }
 */
function parseToken(token: string): ParsedToken {
  let breakpoint: Breakpoint = 'xs';
  let theme: Theme = 'light';
  let state: State = 'default';
  let rest = token;

  // Known variants in any order (hover:md:bg-x is md:hover:bg-x), one per axis; any other prefix ends the chain.
  for (let m; (m = rest.match(/^([\w-]+):/));) {
    const v = m[1];
    if (breakpoint === 'xs' && (BREAKPOINT_PREFIXES as readonly string[]).includes(v)) breakpoint = v as Breakpoint;
    else if (theme === 'light' && (THEME_PREFIXES as readonly string[]).includes(v)) theme = v as Theme;
    else if (state === 'default' && (STATE_PREFIXES as readonly string[]).includes(v)) state = v as State;
    else break;
    rest = rest.slice(m[0].length);
  }

  return { breakpoint, theme, state, className: rest };
}

/**
 * Parse a full class string into hierarchical storage.
 *
 * @example
 * parseClasses('p-4 md:pr-8 hover:bg-blue-500 lg:focus:ring-2 dark:bg-gray-800')
 * // Returns storage with:
 * // xs.light.default: ['p-4']
 * // xs.light.hover: ['bg-blue-500']
 * // xs.dark.default: ['bg-gray-800']
 * // md.light.default: ['pr-8']
 * // lg.light.focus: ['ring-2']
 */
export function parseClasses(classString: string): ClassStorage {
  const storage = createEmptyStorage();

  if (!classString?.trim()) return storage;

  const tokens = classString.trim().split(/\s+/);

  for (const token of tokens) {
    if (!token) continue;
    const { breakpoint, theme, state, className } = parseToken(token);
    storage[breakpoint][theme][state].push(className);
  }

  return storage;
}

/**
 * Serialize ClassStorage back to a class string.
 * Order: xs first (no prefix), then breakpoints in mobile-first order.
 * Within each breakpoint: light theme first, then dark.
 * Within each theme: default state first, then states.
 */
export function serializeClasses(storage: ClassStorage): string {
  const tokens: string[] = [];

  for (const bp of BREAKPOINTS) {
    for (const theme of THEMES) {
      for (const state of STATES) {
        const classes = storage[bp][theme][state];
        for (const cls of classes) {
          // xs breakpoint has no prefix
          const bpPrefix = bp === 'xs' ? '' : `${bp}:`;
          // light theme has no prefix, dark gets 'dark:'
          const themePrefix = theme === 'light' ? '' : `${theme}:`;
          // default state has no prefix
          const statePrefix = state === 'default' ? '' : `${state}:`;
          tokens.push(`${bpPrefix}${themePrefix}${statePrefix}${cls}`);
        }
      }
    }
  }

  return tokens.join(' ');
}

/**
 * Deep clone a ClassStorage object.
 */
export function cloneStorage(storage: ClassStorage): ClassStorage {
  const clone = {} as ClassStorage;
  for (const bp of BREAKPOINTS) {
    clone[bp] = {} as ClassStorage[Breakpoint];
    for (const theme of THEMES) {
      clone[bp][theme] = {} as ClassStorage[Breakpoint][Theme];
      for (const state of STATES) {
        clone[bp][theme][state] = [...storage[bp][theme][state]];
      }
    }
  }
  return clone;
}
