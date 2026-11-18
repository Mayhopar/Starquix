/**
 * task-206: the ONE place that decides what a Media selection is (D4).
 *
 * A selection is a Media unit when the bridge stamped `mediaUnit` on it
 * (element inside a rendered .sq-media) AND/OR its source is the system
 * Media component (`sq/Media.astro`, or the template's `src/components/Media.astro`).
 * It is WRITABLE only when the rehype body-line stamps are present and
 * 1-based — without them there is no invocation range to splice, so
 * MediaBlock renders read-only.
 *
 * task-207 let arbitrary promoted components into sq/ — a selection sourced
 * from any OTHER system component is NOT a media unit: it must fall through
 * to resolveComponentUnit → SystemComponentBlock (block-routing fix).
 *
 * Finding 27: the Media check is PROJECT-SCOPED, not name-scoped. With a
 * project open, `src/components/Media.astro` passes isSystemComponentPath (it
 * names the template's system Media) but is the USER's own file; a project's
 * system components live ONLY under sq/.
 */
import { componentPathOf, componentNameOf } from './componentUnit';
import { MEDIA_SYSTEM_COMPONENT, SQ_SYSTEM_DIR } from '@/utils/systemComponents';

/** True only for the system Media component's own file (suffix-tolerant).
 *  `localRuntime` = a project is open (files-truth): there the template
 *  shapes name the USER's file, never ours. */
export function isMediaComponentPath(
  source: string | null | undefined,
  localRuntime = false,
): boolean {
  const path = componentPathOf(source ?? null);
  if (path === null || componentNameOf(path) !== 'Media') return false;
  // The materialized system Media (sq/Media.astro) — every runtime.
  if (path === MEDIA_SYSTEM_COMPONENT.path) return true;
  // Remaining system shapes (`src/components/Media.astro`, bare `Media.astro`)
  // are the template-path Media (D6) — user files once a project is open.
  return !localRuntime;
}

/**
 * DesignBar's unit-routing gate for a resolved component-unit path: should it
 * render SystemComponentBlock? False for the Media system path (MediaBlock's)
 * and — project open — for template shapes, which name the user's own
 * files there and must keep their normal component chrome.
 */
export function isComponentUnitPath(path: string, localRuntime = false): boolean {
  if (isMediaComponentPath(path, localRuntime)) return false;
  return !localRuntime || path.startsWith(SQ_SYSTEM_DIR);
}

export interface MediaSelection {
  /** Invocation body range in the post .mdx, or null = read-only. */
  write: { bodyLine: number; bodyEnd: number } | null;
}

export function resolveMediaUnit(
  selected: {
    mediaUnit?: { bodyLine: number; bodyEnd: number };
    astroSource?: string | null;
  } | null,
  localRuntime = false,
): MediaSelection | null {
  if (!selected) return null;
  const path = componentPathOf(selected.astroSource ?? null);
  // A promoted (non-Media) sq/ component — or a shape that is the USER's own
  // Media file once a project is open (finding 27) — is a COMPONENT (or plain)
  // selection even when the rehype stamp is present: MediaBlock's knobs would
  // corrupt its invocation.
  if (path && !isMediaComponentPath(path, localRuntime)) return null;
  const stamps = selected.mediaUnit;
  if (!stamps && !path) return null;
  if (stamps && stamps.bodyLine >= 1 && stamps.bodyEnd >= stamps.bodyLine) {
    return { write: { bodyLine: stamps.bodyLine, bodyEnd: stamps.bodyEnd } };
  }
  return { write: null };
}
