/**
 * Unified Class System - Types
 *
 * Single system to handle ALL Tailwind class operations:
 * responsive breakpoints, interaction states, and property replacement.
 */

export const BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
export const STATES = ['default', 'hover', 'focus', 'active', 'disabled'] as const;
export const THEMES = ['light', 'dark'] as const;

export type Breakpoint = typeof BREAKPOINTS[number];
export type State = typeof STATES[number];
export type Theme = typeof THEMES[number];

/**
 * Hierarchical storage structure for classes.
 * Classes are stored WITHOUT prefixes - prefixes are added on serialization.
 *
 * Structure: breakpoint -> theme -> state -> classes[]
 */
export type ClassStorage = {
  [bp in Breakpoint]: {
    [theme in Theme]: {
      [state in State]: string[]
    }
  }
};

/**
 * Result of parsing a single token.
 */
export interface ParsedToken {
  breakpoint: Breakpoint;
  theme: Theme;
  state: State;
  className: string;
}
