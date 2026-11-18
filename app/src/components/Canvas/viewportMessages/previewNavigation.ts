/**
 * Shared preview route adoption. Local runtime callers first authenticate a
 * fresh current-document route reply in ViewportFrame. Legacy callers use
 * PREVIEW_NAVIGATE (task-116).
 *
 * Internal links carry the PUBLISHED href ('/about'), but the iframe is served
 * at /preview/{projectId}/{pageId} and that route does not exist. The bridge
 * blocks the navigation and sends the href up; we resolve it to a page and
 * drive the ordinary page switch, so the existing RENDER pipeline repaints the
 * iframe exactly as it does when a page is clicked in the sidebar. No new
 * render path.
 *
 * The bridge only forwards same-origin http(s) links — target=_blank,
 * cross-origin, mailto:/tel: and #anchors never reach here.
 */
import { findPageByHref } from '@/store/findPageByHref';
import { readBlogSlotBinding } from '@/core/collections/yjsAccessors';
import { UNBOUND_COLLECTION_ID } from '@/core/collections/types';
import { isLocalProjectId, localPageId } from '@/utils/localMode';
import { localNativeRoute, normalizeLocalRoute } from '../previewSrc';
import type { ViewportMessageContext } from './context';

export function handlePreviewNavigate(ctx: ViewportMessageContext, payload: unknown, _event?: MessageEvent, beforeLocalAdoption?: (route: string) => void): void {
  const p = payload as { href?: string; postSlug?: string; slotKey?: string } | null;

  // Parity gap 25/58 — LOCAL runtime: the iframe has ALREADY navigated
  // natively (files-truth; the bridge never prevents the click there) and this
  // payload is its confirmed current route. Map it to the doc page id with
  // localPageId — THE derivation the doc seeding used (useProjectSync), so no
  // second matcher — and drive the SAME setActivePage path the sidebar uses:
  // Editor then re-arms expectedRoute/currentPageFile and the task-133
  // wrong-file guard un-wedges. Loop guard: a programmatic page switch never
  // emits PREVIEW_NAVIGATE (no click in the iframe), and a self-link is
  // dropped by the currentPageId check, so no SET_PAGE cycle can start.
  if (ctx.env.projectId && isLocalProjectId(ctx.env.projectId)) {
    if (!p?.href) return; // local bridges never send the postSlug shape
    const route = normalizeLocalRoute(p.href);
    // The frame is ALREADY at `route` (native navigation) — record it BEFORE
    // driving the page switch, so ViewportFrame's src render can skip the
    // attribute re-set for this route (a re-set would load the page a SECOND
    // time). Recorded even for self-links and routes the page list can't
    // map: it is a statement about the frame's location, and the skip only
    // ever consults it when the editor's own page path reaches that route.
    localNativeRoute.current = route;
    const pageId = localPageId(route);
    if (!ctx.env.pages.some((page) => page.id === pageId)) {
      // A route the session's page list doesn't know (undiscovered dynamic
      // slug, non-.astro page). The iframe shows it; the editor honestly
      // stays put — same inert-warn semantics as the WC miss below.
      console.warn(`[preview] No local page matches route "${p.href}" — editor stays on the current page.`);
      return;
    }
    beforeLocalAdoption?.(route);
    if (pageId === ctx.refs.currentPageId.current) return; // already there
    ctx.actions.setActivePage(pageId);
    return;
  }

  // Blog-card click: the card's <a> href is the PUBLISHED post route
  // ('/blog/posts/slug'), which findPageByHref cannot match (posts are
  // slug-driven). The bridge sends the post slug + slot key instead; resolve
  // the slot's collection and drive the same go-to-post path the sidebar uses
  // (creates the post page on demand, activates it, primes the previewer).
  if (p?.postSlug && p?.slotKey) {
    const binding = readBlogSlotBinding(ctx.env.doc, p.slotKey);
    const collectionId = binding?.collectionId;
    if (!collectionId || collectionId === UNBOUND_COLLECTION_ID) {
      console.warn(`[preview] Blog slot "${p.slotKey}" has no bound collection — card link is inert.`);
      return;
    }
    ctx.actions.goToPost(collectionId, p.postSlug);
    return;
  }

  const href = p?.href;
  if (!href) return;

  const page = findPageByHref(ctx.env.pages, href);
  if (!page) {
    // A typo, an unbuilt page, or a blog post-detail link (slug-driven, so
    // findPageByHref cannot match it — its own task). Inert is the honest
    // preview of a link that goes nowhere: no 404, no toast.
    console.warn(`[preview] No page matches href "${href}" — link is inert.`);
    return;
  }

  ctx.actions.setActivePage(page.id);
}
