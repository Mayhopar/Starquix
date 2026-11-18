/**
 * task-207 Task 9: the ONE place that decides what a SYSTEM-COMPONENT
 * selection is. Generalizes task-206's `resolveMediaUnit` from "is this a
 * .sq-media?" to "which sq/ component invocation encloses this element, and
 * what is its write target?".
 *
 * The write target is the rehype wrapper's body-line stamp — NOT a PostDoc
 * block index. The ledger's D8 proposed the index because it assumed a
 * component that doesn't spread `...rest` carries no stamp; the probe
 * (docs/plans/2026-08-11-task-207-variant-system-design.md, D8) disproved that:
 * the rehype pass emits its own wrapper around EVERY component invocation, so
 * a promoted `Credit.astro` is writable through the same stamp Media uses. The
 * index would also have double-counted components that DO spread, since their
 * root inherits `data-sq-block="component"` from the wrapper.
 */
import { isSystemComponentPath } from '@/utils/systemComponents';

export interface ComponentUnit {
  /** `src/components/sq/Foo.astro` — the manifest's key. */
  path: string | null;
  /** `Foo` — the settings block's title. */
  name: string | null;
  /** Invocation body range in the post .mdx, or null = read-only (B9). */
  write: { bodyLine: number; bodyEnd: number } | null;
}

export interface UnitSelection {
  mediaUnit?: { bodyLine: number; bodyEnd: number };
  astroSource?: string | null;
}

/** `src/components/sq/Credit.astro:4:1` → `src/components/sq/Credit.astro`. */
export function componentPathOf(astroSource: string | null | undefined): string | null {
  if (!astroSource) return null;
  const path = astroSource.replace(/:\d+:\d+$/, '');
  return isSystemComponentPath(path) ? path : null;
}

export function componentNameOf(path: string | null): string | null {
  return path ? (path.split('/').pop() ?? '').replace(/\.astro$/, '') || null : null;
}

export function resolveComponentUnit(selected: UnitSelection | null): ComponentUnit | null {
  if (!selected) return null;
  const path = componentPathOf(selected.astroSource);
  const stamps = selected.mediaUnit;
  // A stamp without an sq/ source can still be Media in older payloads; a
  // source without a stamp is a system component with no write target (WC).
  if (!stamps && !path) return null;
  const writable = !!stamps && stamps.bodyLine >= 1 && stamps.bodyEnd >= stamps.bodyLine;
  return {
    path,
    name: componentNameOf(path),
    write: writable ? { bodyLine: stamps!.bodyLine, bodyEnd: stamps!.bodyEnd } : null,
  };
}
