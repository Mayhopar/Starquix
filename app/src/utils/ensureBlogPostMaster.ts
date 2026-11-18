import * as Y from 'yjs';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { applyCommand } from '@/store/commands';
import { selectMasterMarkup, MASTERS_MAP } from '@/store/masters';
import { resolveComponentEditorOpen, resolveCanvasHtmlWithPlacements } from './canvasHtml';
import { readComponentSource } from './componentSourceReader';
import { SQ_CHILD_RE, attrOf } from './componentPlaceholders';
import { findBlogPostComponent } from './blogPostConstants';

/**
 * Seed a missing child master for every placement path: pages expand a parent
 * master's `<sq-child>` via expandLeftoverPlaceholders, which reads the
 * MASTERS overlay only (selectors pass [] as library by design) — a missing
 * entry silently drops the child from every page. Library html is the same
 * base a fresh placement would freeze, so seeding is a visual no-op. Shared
 * by the master-editor open (seedComponentEditorPage) and the post-page open
 * (ensureBlogPostMasterSeeded). Missing-only: never touches an existing entry.
 * Returns how many entries were seeded.
 */
export function seedMissingChildMasters(doc: Y.Doc, paths: string[], library: ScannedComponent[]): number {
  const masters = doc.getMap(MASTERS_MAP);
  let seeded = 0;
  for (const path of paths) {
    if (masters.has(path)) continue;
    const child = library.find((c) => c.path === path);
    if (child?.html) {
      applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: path, markup: child.html });
      seeded++;
    }
  }
  return seeded;
}

/** ONE transaction for markup + child seeds — the masters persistence saver
 *  snapshots per observer batch, so the pair must land atomically ('sync'
 *  origin keeps observer toasts quiet, task-118). */
function writeMasterWithChildren(
  doc: Y.Doc,
  astroSource: string,
  html: string,
  placementPaths: string[],
  library: ScannedComponent[],
): void {
  doc.transact(() => {
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource, markup: html });
    seedMissingChildMasters(doc, placementPaths, library);
  }, 'sync');
}

/**
 * LEAVE-time mirror of the open-time refresh (seedComponentEditorPage): after
 * the editor-leave flush has made the source durable (layout appends +
 * override write-back, both awaited), re-resolve the source and refresh this
 * master so pages pick up ADDED components immediately — without this, an add
 * only reached `masters` at the NEXT master open, and post pages lagged until
 * the user did the Assets round-trip (live-caught 2026-07-24).
 *
 * Reads the FILE via readComponentSource (WC → host raw read), NEVER the scan
 * cache — the library refetch lags the append flush, and re-resolving the
 * stale scan html would rebase the master to pre-append content.
 */
export async function refreshMasterFromSource(
  doc: Y.Doc,
  astroSource: string,
  library: ScannedComponent[],
): Promise<boolean> {
  let source: string;
  try {
    source = await readComponentSource(astroSource);
  } catch {
    return false; // both reads failed — keep the baked master, next open heals
  }
  const { html, placements } = resolveCanvasHtmlWithPlacements(source, library);
  if (!html) return false;
  writeMasterWithChildren(doc, astroSource, html, placements.map((p) => p.path), library);
  return true;
}

// Six ViewportFrame instances (one per breakpoint) fire the post-page effect
// concurrently — share one in-flight seed per doc so the cold path resolves
// the source ONCE instead of six times.
const inFlightSeed = new WeakMap<Y.Doc, Promise<boolean>>();

/**
 * ESTABLISH the BlogPost master overlay at post-page open — missing-only,
 * never a refresh. Post pages render their wrapper via baseMarkup: masters
 * overlay first, frozen first-wrap staticMarkup as the fallback. The overlay
 * is only ever written at master-editor open (seedComponentEditorPage) and
 * bake-on-leave, so a doc whose masters were never seeded — or purged —
 * rendered the stale first-wrap freeze on every post page until the user
 * happened to open the BlogPost master in Assets (live-caught 2026-07-24).
 *
 * Missing-only is deliberate: an unconditional refresh from source would race
 * the deferred .astro write-back after a master edit (bake lands in masters
 * immediately; the source flush lands at a navigation boundary) and clobber
 * the fresh bake with a stale file read. When the entry already exists we
 * still seed missing CHILD masters, enumerated straight from the stored
 * markup's `<sq-child data-sq-astro-source>` wire format — a present parent
 * with an absent child drops the child (e.g. GlobalNav) just as silently.
 *
 * Returns false when BlogPost isn't in the library (cold scan) or there was
 * nothing to seed.
 */
export function ensureBlogPostMasterSeeded(doc: Y.Doc, library: ScannedComponent[]): Promise<boolean> {
  const inFlight = inFlightSeed.get(doc);
  if (inFlight) return inFlight;
  const run = doEnsure(doc, library).finally(() => inFlightSeed.delete(doc));
  inFlightSeed.set(doc, run);
  return run;
}

async function doEnsure(doc: Y.Doc, library: ScannedComponent[]): Promise<boolean> {
  const blogPost = findBlogPostComponent(library);
  if (!blogPost) return false;

  const existing = selectMasterMarkup(doc, blogPost.path);
  if (existing !== undefined) {
    const childPaths: string[] = [];
    for (const m of existing.matchAll(SQ_CHILD_RE)) {
      const src = attrOf(m[1] ?? m[2] ?? '', 'data-sq-astro-source');
      if (src) childPaths.push(src);
    }
    let seeded = 0;
    if (childPaths.length > 0) {
      doc.transact(() => { seeded = seedMissingChildMasters(doc, childPaths, library); }, 'sync');
    }
    return seeded > 0;
  }

  const { html, placements } = await resolveComponentEditorOpen(blogPost, library);
  if (!html) return false;
  // Re-check after the await: a master-editor open (or another session) may
  // have seeded the entry meanwhile — missing-only means the first write wins.
  if (selectMasterMarkup(doc, blogPost.path) !== undefined) return false;
  writeMasterWithChildren(doc, blogPost.path, html, placements.map((p) => p.path), library);
  return true;
}
