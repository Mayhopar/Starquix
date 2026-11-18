/**
 * Push feedback copy — ONE builder for every runtime.
 *
 * Blind review 2026-08-04 called the Push toast "the loudest tell": local
 * reported `Feature.astro updated — 1 change written · 2 pages render it` while
 * WC/server reported the generic `Changes pushed to the master component.` The
 * specific report is the better one, so it is now the only one, and parity is
 * held by construction — there is one string table and both handlers read it.
 *
 * Honesty constraints baked into the copy:
 *
 *  - **Never claim a file write.** Local's push writes the user's real `.astro`;
 *    WC/server's writes the doc masters overlay and touches no file. "pushed"
 *    is true of both; "written" was true of only one.
 *  - **`name` is a DISPLAY name, never a path.** Callers pass
 *    `basenameFromAstroSource(...)` → `Header`. The `.astro` suffix leaking into
 *    one runtime's modal and toast was the same review's second finding, and the
 *    rest of the editor (layers rows, go-to-source labels, component library)
 *    has always shown the bare name.
 *  - **Agreement comes from utils/plural**, never a hardcoded `s`. `1 other
 *    placement keep` was shipped copy.
 *
 * Scope numbers come from `hooks/useComponentUsage` — the same source the
 * confirmation modal prints, so the promise and the report cannot disagree.
 * Every scope field is optional: a caller that cannot count omits it and the
 * sentence says less. The notice itself never disappears.
 */
import { plural, verb } from '@/utils/plural';

export interface PushResult {
  /** Changes that landed. */
  pushed: number;
  /** Changes that did not (writer timeout / rejection). Always 0 for a doc push. */
  failed: number;
  /**
   * WHY they did not, de-duplicated (task-166). A failure count on its own is
   * indistinguishable from a timeout and tells the user nothing they can act
   * on — and the commonest failure is not a timeout at all, it is the class
   * writer honestly refusing an edit it cannot express in the source
   * ("class:list has no editable leading literal — edit it in the source
   * file"). That sentence already reached the component-view route's toast;
   * Push threw it away. Omitted by a caller that has no reason to give.
   */
  reasons?: string[];
}

export interface PushScope {
  /** Pages that render this component. */
  pageCount?: number;
  /** Placements carrying unpushed edits BEFORE this push — including this one. */
  overriddenPlacements?: number;
}

export type PushNoticeLevel = 'success' | 'error' | 'info';
export interface PushNotice {
  level: PushNoticeLevel;
  message: string;
}

/**
 * Shown the instant Push starts. Local's writes are sequential and each can sit
 * on the writer's 10s timeout, so without this the user gets no signal at all
 * for the whole run. WC/server resolves synchronously and normally never shows
 * it, but the copy exists for both so neither runtime has a state the other
 * lacks.
 */
export function pushStartNotice(name: string, pending: number): string {
  return `Pushing ${plural(pending, 'change')} into ${name}…`;
}

/** The same toast, resolved. Specific by contract: component + counts + scope. */
export function pushNotice(
  name: string,
  { pushed, failed, reasons }: PushResult,
  scope: PushScope = {},
): PushNotice {
  if (failed > 0) {
    const head = pushed > 0
      ? `${name}: ${failed} of ${pushed + failed} changes could not be pushed — ${pushed} pushed`
      : `${name}: ${plural(failed, 'change')} could not be pushed`;
    // The reason is the actionable half. Several distinct ones are joined
    // rather than dropped: "1 could not be pushed" plus a cause the user can
    // fix is the whole point, and a second cause is not less true than the
    // first. They are already de-duplicated by the caller.
    const why = (reasons ?? []).filter(Boolean).join(' · ');
    return { level: 'error', message: why ? `${head}. ${why}` : head };
  }
  if (pushed === 0) {
    // Reachable in both runtimes: the confirm modal sits between the menu click
    // and the action, so the overrides can be gone by the time the user
    // confirms. Silence here is the bug, not the absence of work.
    return { level: 'info', message: `Nothing to push — ${name} has no unpushed changes.` };
  }
  const parts = [`${name} updated — ${plural(pushed, 'change')} pushed`];
  if (scope.pageCount != null) {
    parts.push(`${plural(scope.pageCount, 'page')} ${verb(scope.pageCount, 'render')} it`);
  }
  // This placement is now clean, so the remainder is what still diverges. A
  // count that included it would over-report the very thing Push just resolved.
  const others = (scope.overriddenPlacements ?? 0) - 1;
  if (others > 0) {
    parts.push(`${plural(others, 'other placement')} still ${verb(others, 'override')} it`);
  }
  return { level: 'success', message: parts.join(' · ') };
}
