// app/src/utils/projectId.ts

/**
 * Project ID prefix for browser projects. (The old cloud prefix was removed
 * with its runtime; ids carrying it fall through to the browser default.)
 * (A `local_` prefix named the host-folder disk — removed for good on
 * 2026-09-10, docs/plans/2026-09-10-remove-open-local-folder-design.md. A
 * stale `local_` id falls through to the browser default here and the editor
 * route redirects to / because no Dexie row exists for it.)
 */
export const PROJECT_ID_PREFIX = {
  BROWSER: 'browser_',
} as const;

/**
 * Create a namespaced project ID.
 *
 * Behavior:
 * - If rawId is empty, throws an error.
 * - If rawId already has the CORRECT prefix for the mode, returns unchanged.
 * - If rawId has the WRONG prefix, strips it and applies the correct one.
 * - Otherwise, adds the appropriate prefix.
 *
 * @example
 * createProjectId('browser', 'abc') // => 'browser_abc'
 * createProjectId('browser', 'browser_abc') // => 'browser_abc' (no double-prefix)
 * createProjectId('browser', '') // throws Error
 */
export type ProjectMode = 'browser';

export function createProjectId(mode: ProjectMode, rawId: string): string {
  if (rawId === '') {
    throw new Error('rawId cannot be empty');
  }

  const prefixMap: Record<ProjectMode, string> = {
    browser: PROJECT_ID_PREFIX.BROWSER,
  };

  const prefix = prefixMap[mode];

  // Already has correct prefix - don't double-prefix
  if (rawId.startsWith(prefix)) {
    return rawId;
  }

  // Strip any existing prefix
  for (const p of Object.values(PROJECT_ID_PREFIX)) {
    if (rawId.startsWith(p)) {
      return `${prefix}${rawId.slice(p.length)}`;
    }
  }

  return `${prefix}${rawId}`;
}

/**
 * Parse a project ID to extract mode and raw ID.
 * Legacy unprefixed IDs default to browser mode.
 */
export function parseProjectId(projectId: string): { mode: ProjectMode; rawId: string } {
  if (projectId.startsWith(PROJECT_ID_PREFIX.BROWSER)) {
    return { mode: 'browser', rawId: projectId.slice(PROJECT_ID_PREFIX.BROWSER.length) };
  }
  // Legacy unprefixed (and a stale local_ from the removed host-folder disk) —
  // treat as browser mode; hydration fails soft to the ProjectsPage redirect.
  return { mode: 'browser', rawId: projectId };
}

/**
 * Detect mode from project ID prefix.
 * Shorthand for parseProjectId(id).mode
 */
export function detectModeFromProjectId(projectId: string): ProjectMode {
  return parseProjectId(projectId).mode;
}
