import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Enforces the Yjs access boundary for `blogSlotBindings`. The Zod-
 * parsing accessors in src/core/collections/yjsAccessors.ts are the
 * only legitimate READ path; writes go through src/store/collectionCommands.ts.
 * A handful of files need raw map access (cleanup paths, presence checks,
 * the defaults-patching writer) — those are allowlisted below with a
 * one-line justification. Anything else is a boundary violation: it
 * bypasses Zod validation and the canonical write codec.
 *
 * (sourceClasses is a cross-cutting class-storage map, not blog-specific,
 * so it's not boundary-policed here — see ClassStorage docs.)
 *
 * This runs in the regular `vitest` suite; there's no ESLint in the
 * project so a grep-based boundary test is the pragmatic equivalent.
 */

const SRC_ROOT = path.resolve(__dirname, '../../..');

const ALLOWLIST = new Set([
  // Canonical reader (Zod-parsing)
  'core/collections/yjsAccessors.ts',
  // Canonical writer (command dispatcher)
  'store/collectionCommands.ts',
  // Selector impl delegated to by accessors
  'store/collectionSelectors.ts',
  // Selectors.ts reads blog slot data for rendering integration
  'store/selectors.ts',
  // Element-delete path cleans up orphaned blog bindings
  'store/commands.ts',
  // Doc bootstrap: `getMap` here just initialises the top-level Y.Map
  'store/createEditorDoc.ts',
  // Persistence mirror serializes whole Yjs state for localStorage
  // Canvas presence check: "is this slot already filled?" via `.has(key)`
  'components/Canvas/ViewportFrame.tsx',
  // Defaults-patching writer needs existence check + Y.Map mutation
  // Runtime WC-FS sync observes the raw map for observeDeep()
  // Binding lifecycle owner: portDanglingBinding re-keys entries (clone-then-
  // delete needs raw Y.Map), childOverrides seed/mirror read+write the binding
  // entry, and the effect observeDeep()s the raw map (restoreCollections lands
  // bindings after the last boot elements change)
  // Undo snapshots capture/restore blogSlotBindings raw (task-037/038: undo of
  // unbind/re-bind) — snapshot iteration is cross-domain by design
  'context/UndoContext.tsx',
]);

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /doc\.getMap\(['"]blogSlotBindings['"]\)/, label: "doc.getMap('blogSlotBindings')" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === '__fixtures__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('Yjs access boundary', () => {
  const files = walk(SRC_ROOT);

  it.each(FORBIDDEN_PATTERNS)('no unauthorized calls to $label', ({ pattern, label }) => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const source = readFileSync(file, 'utf-8');
      if (pattern.test(source)) {
        violations.push(rel);
      }
    }
    if (violations.length > 0) {
      const msg =
        `Boundary violation: ${violations.length} file(s) call \`${label}\` outside the allowlist.\n` +
        `Blog-domain Yjs reads must go through src/core/collections/yjsAccessors.ts.\n` +
        `Writes must go through src/store/collectionCommands.ts.\n` +
        `If this file legitimately needs direct Yjs access, add it to ALLOWLIST in\n` +
        `src/core/collections/__tests__/yjs-boundary.test.ts with a comment explaining why.\n\n` +
        `Violating files:\n${violations.map((f) => `  - ${f}`).join('\n')}`;
      throw new Error(msg);
    }
    expect(violations).toEqual([]);
  });

  it('allowlist entries all exist on disk', () => {
    const missing: string[] = [];
    for (const rel of ALLOWLIST) {
      try {
        statSync(path.join(SRC_ROOT, rel));
      } catch {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });
});
