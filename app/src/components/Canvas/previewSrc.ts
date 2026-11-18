import type * as Y from 'yjs';
import type { LocalInstanceLite } from '@/hooks/useLocalInstance';
import { forEachEditedSourceClassEntry } from '@/store/sourceOverrideEntries';

/**
 * LOCAL MODE ONLY — the edited source-class overrides as a URL fragment.
 *
 * A local page frame is a real navigation that paints raw file bytes, and the
 * post-ELEMENTS_SCANNED re-apply is bounded below by the frame's own first
 * paint — so the override must already be IN-FRAME when the parser runs. The
 * frame is cross-origin and cannot read the parent's doc; the fragment is the
 * channel that beats first paint (readable by the bridge's synchronous <head>
 * execution, never sent to the server, no cache-key impact). Consumed by
 * `preApplyLocalOverrides` (bridge/parts/scanning.ts).
 *
 * Exactly the entries the parent's post-scan re-apply would send
 * (forEachEditedSourceClassEntry — same iterator as viewportMessages/
 * scanning.ts), so the pre-paint apply can never paint something the settle
 * wouldn't. '' when there is nothing to carry (src byte-identical to today)
 * or when the payload is absurdly large (fail-open: the post-scan re-apply
 * still covers it, at the cost of the old small repaint).
 */
export function localOverridesFragment(doc: Y.Doc): string {
  const overrides: Record<string, string> = {};
  let count = 0;
  forEachEditedSourceClassEntry(doc, ({ key, classes }) => {
    overrides[key] = classes;
    count++;
  });
  if (count === 0) return '';
  const encoded = encodeURIComponent(JSON.stringify(overrides));
  if (encoded.length > 60000) return '';
  return `#sq-ov=${encoded}`;
}

/** Same semantics as localPageSync's route normalization: no query/hash,
 *  '/index.html' = '/', no trailing slash, '' = '/'. Shared by the
 *  PREVIEW_NAVIGATE announce handler (viewportMessages/previewNavigation.ts)
 *  and ViewportFrame's src decision below, so the two can never disagree on
 *  what counts as "the same route". */
export function normalizeLocalRoute(href: string): string {
  let r = href.split('#')[0].split('?')[0];
  r = r.replace(/\/index\.html?$/i, '/');
  if (r.length > 1) r = r.replace(/\/+$/, '');
  return r === '' ? '/' : r;
}

/**
 * LOCAL MODE ONLY — the route the preview iframe last reached by its OWN
 * native navigation (an internal link click; the bridge never prevents it,
 * files-truth). Written after ViewportFrame authenticates a correlated
 * current-document route reply, BEFORE the shared navigation handler
 * drives setActivePage. ViewportFrame retains this marker for the imperative
 * sidebar return to a parked attribute; authenticated document identity
 * separately controls native parking. Cleared by
 * ViewportFrame on mount/unmount and whenever a programmatic navigation
 * leaves the recorded route.
 *
 * Module-level (not React state) because the writer and the reader live in
 * different modules but describe the ONE mounted local preview frame — the
 * same singleton shape reloadPreview.ts uses for its URL provider.
 */
export const localNativeRoute: { current: string | null } = { current: null };

export interface LocalIframeSrcDecision {
  /** The string to render as the iframe's src attribute. */
  src: string;
  /** Normalized route embedded in `src` (null for about:blank). */
  route: string | null;
  /** True when the attribute stays unchanged (native echo or override-only change). */
  skipped: boolean;
}

/**
 * Local double-navigation guard: decide the local iframe's rendered src.
 *
 * A link click inside a LOCAL iframe navigates NATIVELY. A correlated reply
 * from the loaded document adopts its route (setActivePage → currentPagePath → a new
 * desired src). Re-setting the src attribute at that point would load the
 * page a SECOND time: an attribute mutation always navigates, and the URL
 * equals the frame's current location, so it is a full reload — two document
 * loads, two IFRAME_READY sweeps, two scans per click.
 *
 * A confirmed full current-document URL keeps the attribute untouched, even
 * when its canonical editor route differs in query/trailing slash. The legacy
 * route-only guard remains available to callers without this confirmation. Everything else — sidebar page
 * switches and boot/error transitions to about:blank — renders the desired
 * src. Hash-only override changes also keep the attribute untouched: setting
 * iframe.src can reload the document even if only the hash changed.
 * The authenticated bridge updates the current document hash in place instead.
 */
export function resolveLocalIframeSrc(opts: {
  desiredSrc: string;
  /** normalizeLocalRoute(currentPagePath) while running, null otherwise. */
  desiredRoute: string | null;
  nativeRoute: string | null;
  /** Full URL authenticated for this current frame and editor intent. */
  confirmedDocumentSrc?: string | null;
  /** Current native load request is awaiting its authenticated document reply. */
  awaitingNativeDocument?: boolean;
  /** What the previous render put in the attribute (null on first render). */
  lastRendered: { src: string; route: string | null } | null;
}): LocalIframeSrcDecision {
  const { desiredSrc, desiredRoute, nativeRoute, lastRendered } = opts;
  const previousUrl = lastRendered?.route !== null && lastRendered
    ? new URL(lastRendered.src) : null;
  const desiredUrl = desiredRoute !== null ? new URL(desiredSrc) : null;
  if (opts.awaitingNativeDocument && lastRendered && previousUrl?.origin === desiredUrl?.origin) {
    return { src: lastRendered.src, route: lastRendered.route, skipped: true };
  }
  if (lastRendered && previousUrl && desiredUrl && opts.confirmedDocumentSrc &&
      previousUrl.origin === desiredUrl.origin &&
      new URL(opts.confirmedDocumentSrc).href.split('#')[0] === desiredUrl.href.split('#')[0]) {
    return { src: lastRendered.src, route: lastRendered.route, skipped: true };
  }
  if ((nativeRoute === null || nativeRoute === desiredRoute) &&
      previousUrl && desiredUrl && lastRendered && desiredSrc !== lastRendered.src &&
      previousUrl.href.split('#')[0] === desiredUrl.href.split('#')[0]) {
    return { src: lastRendered.src, route: lastRendered.route, skipped: true };
  }
  if (
    lastRendered !== null &&
    desiredRoute !== null &&
    nativeRoute === desiredRoute &&
    lastRendered.route !== desiredRoute &&
    previousUrl?.origin === desiredUrl?.origin &&
    previousUrl?.search === desiredUrl?.search
  ) {
    return { src: lastRendered.src, route: lastRendered.route, skipped: true };
  }
  return { src: desiredSrc, route: desiredRoute, skipped: false };
}

/**
 * Iframe src for the preview frame — Phase 6: ONE runtime. The iframe IS the
 * user's site (real routes); page switches are navigations. No bare shell.
 */
export function buildPreviewSrc(opts: {
  /** The instance serving the user's REAL routes. */
  localInstanceState?: LocalInstanceLite;
  currentPagePath?: string | null;
  /** `localOverridesFragment(doc)` — pre-paint override channel. */
  localOverridesHash?: string;
}): string {
  const { localInstanceState, currentPagePath, localOverridesHash } = opts;
  if (localInstanceState?.status === 'running' && localInstanceState.url) {
    return `${localInstanceState.url}${currentPagePath || '/'}${localOverridesHash || ''}`;
  }
  return 'about:blank'; // boot/error overlay owns the surface
}
