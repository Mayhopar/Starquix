/**
 * "How widely is this component used, and how much of it is unpushed?"
 *
 * Two surfaces need the same answer (owner review 2026-08-03):
 *   - the Push / Reset confirmation, which must name its SCOPE instead of
 *     asking a generic "are you sure" (a Push rewrites a shared component for
 *     every page in the project);
 *   - the master/component view, which was a dead end — no list of instances,
 *     no "3 uses", no affordance leading back to a placement that diverged.
 *
 * Both units below are things BOTH runtimes can answer honestly, and they are
 * deliberately NOT conflated:
 *
 *   `pages`                pages that render the component — navigable, so the
 *                          master view has a route back.
 *   `overriddenPlacements` how many placements carry unpushed edits right now.
 *                          A page may place a component twice, so this is not a
 *                          page count and must never be printed as one.
 *
 * These functions are pure doc reads. The local page list arrives from the
 * host's `/__sq/local/component-usages` endpoint (task-143, reused rather than
 * reinvented) — see hooks/useComponentUsage.ts, which is the ONE place the two
 * sources are joined.
 */
import * as Y from 'yjs';
import { parseKey } from './types';
import { COMPONENT_EDITOR_PAGE_ID } from './constants';
import { collectInstanceDivergence } from './instanceLifecycle';
import { isEditedSourceClassEntry } from './sourceOverrideEntries';
import { pageRoute } from './pageRoute';

export interface ComponentUsagePage {
  /** Doc page id — dispatch SET_CURRENT_PAGE with it to navigate there. */
  pageId: string;
  label: string;
}

export interface ComponentUsage {
  pages: ComponentUsagePage[];
  overriddenPlacements: number;
}

export const EMPTY_COMPONENT_USAGE: ComponentUsage = { pages: [], overriddenPlacements: 0 };

/**
 * The ROUTE, not the name — blind review 2026-08-04 item 5. Local's usage list
 * showed routes (its pages come from the filesystem) and this one showed names,
 * so the same popover read differently per runtime. `pageRoute` is the one
 * derivation both sides now use; local's half lives in
 * `hooks/useComponentUsage`, where the host's reverse-import walk already
 * returns routes.
 */
function pageLabel(doc: Y.Doc, pageId: string): string {
  const page = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  const name = page?.get('name') as string | undefined;
  if (!name) return pageId;
  return pageRoute({ id: pageId, name, isHome: page?.get('isHome') as boolean | undefined });
}

/**
 * WC / server: placements are doc elements carrying `astroSource`. A page that
 * places the component twice contributes ONE page entry and up to two
 * overridden placements — the units stay separate on purpose.
 *
 * The COMPONENT EDITOR's own page is excluded (over-count found in the
 * 2026-08-04 recording: `3 uses` with a third row literally labelled `Feature`,
 * while only two pages rendered it). `seedComponentEditor` materialises the
 * master as a real doc page named after the component, whose root element
 * carries the same `astroSource` — so counting it told the user the component
 * was used on a "page" that is the master itself, i.e. the same class of lie
 * the `*` marker was telling. Local is unaffected: its page list comes from the
 * host's reverse-import walk, not from this function.
 */
export function selectDocComponentUsage(doc: Y.Doc, astroSource: string | null): ComponentUsage {
  if (!astroSource) return EMPTY_COMPONENT_USAGE;
  const pageIds: string[] = [];
  const seenPages = new Set<string>();
  let overriddenPlacements = 0;

  doc.getMap('elements').forEach((value, id) => {
    const yEl = value as Y.Map<unknown>;
    if (yEl.get('astroSource') !== astroSource) return;
    const pageId = yEl.get('pageId') as string | undefined;
    if (pageId === COMPONENT_EDITOR_PAGE_ID) return;
    if (pageId && !seenPages.has(pageId)) {
      seenPages.add(pageId);
      pageIds.push(pageId);
    }
    if (collectInstanceDivergence(doc, id, pageId ?? null, { firstOnly: true }).length > 0) {
      overriddenPlacements += 1;
    }
  });

  return {
    pages: pageIds.map((pageId) => ({ pageId, label: pageLabel(doc, pageId) })),
    overriddenPlacements,
  };
}

/**
 * Local: overrides live in the shared source tiers keyed `file:line:col~p<hash>`
 * (task-149 placement identity). Distinct placement segments on `file` = the
 * placements that currently diverge. A placement-free key (a page file's own
 * element, or a component invocation the tagger could not hash) counts as one
 * unscoped placement — matching how `localOverridesForPlacement` addresses it.
 *
 * `here` = the placement the caller is standing on, so the count can answer the
 * only question its consumers ask: how many placements will still be overriding
 * AFTER a Push from here (both the modal and the toast print `count - 1`).
 *
 * task-187 — the bare key is the master's OWN edit, and Push clears it along
 * with the placement it writes (`supersededMasterOverrides`, task-185). Counting
 * it made the confirmation promise edits that the same click destroys; measured
 * live on the owner's project as "1 other placement currently overrides it and
 * will keep the edits already made there" when the only other override was that
 * bare key. It stays counted when `here` is undefined — then it IS the placement
 * being acted on, the `- 1` is spending itself on it, and the real placements it
 * genuinely leaves alone must all still be reported.
 */
export function selectLocalOverriddenPlacements(
  doc: Y.Doc, file: string | null, here?: string,
): number {
  if (!file) return 0;
  const placements = new Set<string>();
  const consider = (key: string, edited: boolean) => {
    if (!edited) return;
    const parsed = parseKey(key);
    if (parsed?.type !== 'source' || parsed.file !== file) return;
    placements.add(parsed.placement ?? '');
  };

  doc.getMap('sourceClasses').forEach((v, k) =>
    consider(k, isEditedSourceClassEntry(v as Y.Map<unknown>, k)));
  doc.getMap('sourceText').forEach((_v, k) => consider(k, true));
  doc.getMap('sourceImageAttributes').forEach((v, k) =>
    consider(k, (v as Y.Map<unknown>).size > 0));

  if (here !== undefined) placements.delete('');
  return placements.size;
}
