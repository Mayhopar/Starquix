/**
 * Get the HTML of `/__sq_post_view/{collection}/{slug}` from the running
 * preview, in EVERY runtime, with one ordered pair of strategies.
 *
 * Why not just fetch it: a direct fetch of the instance origin from the
 * editor page can fail (cross-origin), and `fetch()` from INSIDE the preview
 * iframe was measured failing too (2026-08-12) — the post page's real render
 * never arrived and the body fell back to a Markdown parser, which printed the
 * .mdx source as page copy (owner report). Document loads DO work: a hidden
 * iframe pointed at the route fires `load`.
 *
 * So the route posts its own HTML up to the parent (the inline script in
 * preview-template/src/pages/__sq_post_view/[...path].astro) and we read it
 * from a hidden iframe. A plain fetch is still tried first (the fast path when
 * it succeeds), so nothing forks on runtime.
 */

const DIRECT_TIMEOUT_MS = 4000;
const FRAME_TIMEOUT_MS = 12000; // a cold route compiles on first hit

/** `SQ_POST_VIEW_HTML` — posted by the route itself. Keep in sync with the
 *  inline script in SqPostView.astro; it is the whole contract. */
const POST_VIEW_MESSAGE = 'SQ_POST_VIEW_HTML';

/**
 * THE post-view route prefix. It was a bare literal in five places
 * (this file, componentPreview, ViewportFrame, and both injectRoute configs)
 * and commit b42db6fd exists because one of the five was missing.
 */
export const POST_VIEW_ROUTE = '/__sq_post_view';

export const postViewUrl = (origin: string, collection: string, slug: string) =>
  `${origin}${POST_VIEW_ROUTE}/${collection}/${slug}`;

/** Plain fetch — cheap when the origin allows it. */
async function directFetch(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Accept: 'text/html' }, signal: controller.signal });
      return res.ok ? await res.text() : null;
    } finally {
      // The catch below used to skip this, leaving a live 4s timer per failed
      // attempt — up to 7 per write when every attempt fails.
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Load the URL in a hidden iframe and take the HTML the page posts up.
 * Matched on the route's own `path` so two in-flight loads cannot cross.
 */
export function loadViaHiddenFrame(
  url: string,
  timeoutMs = FRAME_TIMEOUT_MS,
): Promise<string | null> {
  let path: string;
  try {
    const raw = new URL(url, window.location.href).pathname.replace(`${POST_VIEW_ROUTE}/`, '');
    path = decodeURIComponent(raw);
  } catch {
    return Promise.resolve(null);
  }

  return new Promise<string | null>(resolve => {
    const frame = document.createElement('iframe');
    // Off-screen rather than display:none — a display:none iframe is allowed to
    // skip layout, and Astro pages that measure on load then post junk.
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1024px;height:800px;border:0;visibility:hidden';
    frame.src = url;

    let done = false;
    const finish = (html: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(html);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: string; payload?: { path?: string; html?: string } };
      if (data?.type !== POST_VIEW_MESSAGE) return;
      if (data.payload?.path !== path) return;
      finish(data.payload.html ?? null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
}

/**
 * THE loader both consumers use (the post-page body render and the post
 * editor's component chips). Direct fetch first, hidden frame second.
 */
export async function loadPostViewHtml(url: string): Promise<string | null> {
  const direct = await directFetch(url);
  if (direct !== null) return direct;
  return loadViaHiddenFrame(url);
}
