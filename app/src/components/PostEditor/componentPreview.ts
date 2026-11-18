/**
 * Component previews for the post body editor: the REAL Astro render of this
 * post (SqPostView route on the local instance), sliced into per-block chunks.
 *
 * A chunk is NOT addressed by its ordinal. sq-source-plugin wraps every
 * TOP-LEVEL `mdxJsxFlowElement` in a stamped `<div data-sq-block="component">`
 * with no uppercase filter, so a raw `<div class="note">…</div>` in the body
 * produces a chunk too — while the editor models that block as a `passthrough`,
 * not as a component chip. Ordinal pairing therefore shifted every chip after
 * such a block onto its neighbour's HTML, and the last chip onto nothing; an
 * absent preview is what made the editor paint empty upload tiles over
 * components that had rendered their images perfectly well (owner, 2026-08-11:
 * "I upload a photo and nothing happens, I keep seeing a placeholder").
 *
 * Both sides carry `data-sq-body-line` — the body-relative line the block
 * starts on — so that is the join key. A chip with no matching chunk falls back
 * ALONE; it can never shift its neighbours.
 */
import { postViewUrl } from './loadPostViewHtml';
import { MEDIA_PATH_ATTR, MEDIA_SRCSET_ATTR, POSTER_PATH_ATTR } from './mediaResolver';

/**
 * Root-relative URLs in the rendered HTML (/@fs/…, /_image…) resolve against
 * the EDITOR origin unless rewritten to the instance origin.
 *
 * The MODEL-SPACE path is stamped beside the rewritten URL, because an instance
 * origin is not always loadable as a subresource of the editor page; byte mode
 * re-points these elements at `blob:` URLs built from file bytes at paint
 * time (`mediaResolver.retargetMedia`). It needs the path, not the URL — and
 * the path also survives an origin that changed between this fetch and that
 * paint (an instance restart).
 */
function absolutize(el: Element, origin: string): void {
  for (const target of el.querySelectorAll('img, video, source, iframe')) {
    for (const [attr, stamp] of [
      ['src', MEDIA_PATH_ATTR],
      ['poster', POSTER_PATH_ATTR],
    ] as const) {
      const value = target.getAttribute(attr);
      if (value && value.startsWith('/')) {
        target.setAttribute(stamp, value);
        target.setAttribute(attr, origin + value);
      }
    }
    const srcset = target.getAttribute('srcset');
    if (srcset) {
      const rewritten = srcset.replace(
        /(^|,\s*)(\/[^\s,]+)/g,
        (_m, sep: string, url: string) => sep + origin + url,
      );
      if (rewritten !== srcset) target.setAttribute(MEDIA_SRCSET_ATTR, srcset);
      target.setAttribute('srcset', rewritten);
    }
  }
}

/**
 * A chunk is assigned to innerHTML in the EDITOR document (tiptap/schema.ts),
 * which holds window.sqDesktop, every project and the stored tokens — and
 * imported templates render through here. Drop everything that can run there
 * while the HTML is still in this inert DOMParser doc.
 */
const ACTIVE = 'script, iframe, object, embed, base, meta';
function stripActive(el: Element): void {
  el.querySelectorAll(ACTIVE).forEach(node => node.remove());
  for (const node of [el, ...el.querySelectorAll('*')]) {
    for (const { name, value } of Array.from(node.attributes)) {
      // Browsers ignore control chars and whitespace inside a URL scheme.
      if (/^on/i.test(name) || /javascript:/i.test(value.replace(/[\u0000-\u0020]/g, ''))) node.removeAttribute(name);
    }
  }
}

/** One stamped top-level block of the render. `bodyLine` is the join key; null
 *  when the stamp is missing (an older instance) — such a chunk can only ever
 *  be dropped, never guessed onto a chip. */
export interface ComponentChunk {
  bodyLine: number | null;
  html: string;
}

export function extractComponentHtml(html: string, origin: string): ComponentChunk[] {
  return extractHtmlFromDoc(new DOMParser().parseFromString(html, 'text/html'), origin);
}

const COMPONENT_SELECTOR = '[data-sq-block="component"]';

/**
 * ONE entry per stamped BODY LINE. sq-source-plugin stamps a component
 * invocation TWICE: it wraps the mdxJsxFlowElement in a stamped <div>, AND puts
 * data-sq-block/data-sq-body-line on the invocation as JSX props — which reach
 * the DOM only for components that spread rest props onto their root
 * (preview-template Media.astro does; a user's DoubleImage.astro that
 * destructures named props does not). Both carry the SAME line, so the first
 * (outermost) element per line wins and the double-stamp collapses.
 *
 * Nested stamps are kept: a Media inside a layout (Stack slot) is a chip of its
 * own at its own line. Keeping only the outermost block dropped every one of
 * them, so a post built from layouts reported "5 of 5 block(s) couldn't be
 * matched" on every open while the images rendered fine (2026-09-30).
 */
function extractHtmlFromDoc(doc: Document, origin: string): ComponentChunk[] {
  const seen = new Set<string>();
  return Array.from(doc.querySelectorAll(COMPONENT_SELECTOR))
    .map(el => ({ el, line: el.getAttribute('data-sq-body-line') }))
    .filter(({ el, line }) => {
      if (line === null) return el.parentElement?.closest(COMPONENT_SELECTOR) == null;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .map(({ el, line }) => {
      absolutize(el, origin); // idempotent: a rewritten URL no longer starts with '/'
      stripActive(el);
      const bodyLine = line !== null && /^\d+$/.test(line.trim()) ? Number(line) : null;
      return { bodyLine, html: el.matches(ACTIVE) ? '' : el.outerHTML };
    });
}

export interface PreviewPairing {
  /** html for the i-th chip, or undefined when this render has none for it. */
  html: (string | undefined)[];
  /** Diagnostic only — the pairing above is already correct without it. */
  mismatch: string | null;
}

/**
 * Pair chunks to chips BY BODY LINE.
 *
 * `chipLines[i]` is the body line the i-th astroComponent node starts on. A
 * chunk whose line matches none of them is dropped (it is a raw HTML block, or
 * a component the editor models differently); a chip that matches no chunk gets
 * `undefined` and falls back on its own.
 *
 * Duplicate lines cannot happen in a well-formed body (two top-level blocks
 * cannot start on the same line), but a stale render CAN repeat one, so the
 * first unconsumed chunk for a line wins and is then spent — never one chunk
 * painted onto two chips.
 *
 * The mismatch string is for the retry ladder and the notice, NOT for
 * correctness: it reports chips this render could not cover, which is exactly
 * the "keep retrying, the instance has not caught up" signal. Chunks matching
 * no chip are normal (raw HTML blocks) and are not reported.
 */
export function pairPreviewsToChips(
  chunks: ComponentChunk[],
  chipLines: number[],
): PreviewPairing {
  const byLine = new Map<number, string[]>();
  for (const chunk of chunks) {
    if (chunk.bodyLine === null) continue;
    const bucket = byLine.get(chunk.bodyLine);
    if (bucket) bucket.push(chunk.html);
    else byLine.set(chunk.bodyLine, [chunk.html]);
  }
  const html = chipLines.map(line => byLine.get(line)?.shift());
  const missing = html.filter(entry => entry === undefined).length;
  return {
    html,
    // Shown to the user verbatim when the ladder gives up, so it is a sentence,
    // not a log line — with the numbers still in it.
    mismatch:
      missing === 0
        ? null
        : `${missing} of ${chipLines.length} block(s) below couldn't be matched to the ` +
          `site preview, so they may be out of date.`,
  };
}

/**
 * Astro hoists a component's scoped <style> out of its markup, so the
 * extracted wrapper HTML alone loses its layout (a two-image <Media/> rendered
 * STACKED instead of in a row — owner, 2026-08-10). Collect the page's
 * astro-cid-scoped styles so the editor can inject them next to the previews.
 * Imported global CSS (data-vite-dev-id, e.g. tailwind base) is deliberately
 * excluded — injecting a global reset would restyle the editor itself.
 */
export function extractComponentCss(html: string): string {
  return extractCssFromDoc(new DOMParser().parseFromString(html, 'text/html'));
}

/**
 * The CSS the chips need, once: Astro's scoped component styles, plus a
 * component's own `<style is:inline>` — it renders as the NEXT SIBLING of the
 * component root (Media's grid lives there), so a component nested in a layout
 * lost it and a row of three images stacked (owner screenshot 2026-09-30).
 * Deduplicated: every Media invocation repeats the same block.
 */
function extractCssFromDoc(doc: Document): string {
  const inline = Array.from(doc.querySelectorAll(`${COMPONENT_SELECTOR} + style`));
  const scoped = Array.from(doc.querySelectorAll('style'))
    .filter(s => !s.hasAttribute('data-vite-dev-id') && (s.textContent ?? '').includes('astro-cid'));
  return [...new Set([...scoped, ...inline].map(s => s.textContent ?? ''))].join('\n');
}

export interface ComponentPreviews {
  chunks: ComponentChunk[];
  css: string;
}

/**
 * How the page HTML is obtained — always `loadPostViewHtml`, which tries a
 * direct fetch and falls back to a hidden frame reading the HTML the route
 * posts up. A fetch round-tripped through the preview iframe was MEASURED not
 * to work (2026-08-12).
 */
export type PageHtmlFetcher = (url: string) => Promise<string | null>;



export async function fetchComponentPreviews(
  origin: string,
  collection: string,
  slug: string,
  fetchHtml: PageHtmlFetcher,
): Promise<ComponentPreviews | null> {
  try {
    const html = await fetchHtml(postViewUrl(origin, collection, slug));
    if (html === null) return null;
    // One parse feeds both extractors — this runs up to 4× per save (ladder).
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { chunks: extractHtmlFromDoc(doc, origin), css: extractCssFromDoc(doc) };
  } catch {
    return null;
  }
}
