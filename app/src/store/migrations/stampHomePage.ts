import * as Y from 'yjs';
import { selectHomePageId } from '../selectors';

/**
 * One-time, idempotent migration: give every existing project an explicit
 * home page. Pre-flag, the exported root route was name-magic
 * (pageId === 'default' || name.toLowerCase() === 'home'); selectHomePageId
 * encodes that same legacy resolution as its fallback chain, so stamping its
 * result preserves each project's current root route exactly.
 *
 * If flags already exist: dedupe to the first in rootPages order and return.
 * Runs during hydration (not persisted until that page next saves) — re-runs
 * deterministically each load until then, same as the layout migrations.
 */
export function stampHomePage(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  if (pages.size === 0) return;

  doc.transact(() => {
    const homeId = selectHomePageId(doc);
    if (!homeId) return;
    pages.forEach((value, id) => {
      const page = value as Y.Map<unknown>;
      if (id === homeId) {
        if (page.get('isHome') !== true) page.set('isHome', true);
      } else if (page.get('isHome') !== undefined) {
        page.delete('isHome');
      }
    });
  }, 'migration');
}
