/**
 * The URL a page answers on — ONE derivation, every runtime.
 *
 * Blind review 2026-08-04 item 5: the Pages panel listed routes in local
 * (`/`, `/about`) and names in WC/server (`index`, `Page 2`). Ruled ROUTES,
 * because a route is the only identity BOTH runtimes genuinely have:
 *
 *   - local — files are truth, and the page's identity IS its route
 *     (`utils/localMode.localPageId` derives the doc id FROM the route). It has
 *     never had a name, so "names in both" would mean inventing one per
 *     session.
 *   - WC / server — a route is already derived from the page's name for
 *     exported filenames and for internal editor links, by `pageHref` in
 *     `utils/slugify` (the module comment there records the bug that made it
 *     the single source: two copies once minted `/qa` and `/q-a`). This reuses
 *     it rather than growing a third copy.
 *
 * The branch below is on the DATA — "does this page already carry a route?" —
 * not on the runtime. Nothing here reads a project id, a `sq:server-mode` key
 * or any other mode signal, so the UI stays blind to which runtime it is in.
 */
import { pageHref } from '@/utils/slugify';

export interface RoutablePage {
  id: string;
  name: string;
  isHome?: boolean;
}

/**
 * A files-truth page stores its real route as its name (`useProjectSync`'s
 * local seeding, `store/localPages.createLocalDocPage`). Slugifying it would be
 * actively wrong: `slugify('/')` is `'untitled'`, and `/blog/first` would
 * flatten to `/blog-first`.
 */
export function pageRoute(page: RoutablePage): string {
  if (page.name.startsWith('/')) return page.name;
  return pageHref(page.id, page.name, page.isHome);
}
