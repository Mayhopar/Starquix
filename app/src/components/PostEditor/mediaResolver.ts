/**
 * THE answer to "what URL can the EDITOR PAGE actually load for this media
 * path?" — one resolver, one place the runtimes differ.
 *
 * Two modes, and the difference between them is exactly one thing — where
 * the bytes come from — so it lives HERE, not in the node views:
 *
 *   - URL mode (`read === null`): the render's instance URLs are loadable
 *     as-is. This is what the editor uses (PostBodyEditor configures
 *     `configure(origin, null)`).
 *   - Byte mode: for an origin the editor page CANNOT use as a subresource
 *     (measured 2026-08-12: every `fetch()` failed and every `<img>` settled
 *     `naturalWidth === 0` even though the files held correct bytes), read the
 *     bytes through a reader and mint `blob:` URLs. Kept and tested; no
 *     production caller enables it today.
 */
import { previewUrlFor } from './componentMedia';

/** Read a file out of the preview runtime's own filesystem. */
export type MediaByteReader = (path: string) => Promise<Uint8Array | null>;

/**
 * What the node views ask. Sync ON PURPOSE: a ProseMirror node view renders
 * synchronously, so an unresolved path answers `null` (the caller draws its
 * neutral pending frame) and the bytes arrive later through `onResolved`.
 */
export interface MediaSource {
  /** A URL this page can load for `src`, or null — pending, or unresolvable. */
  urlFor(src: string | null | undefined): string | null;
  /**
   * True when URLs are minted from BYTES rather than from the preview origin.
   * The render HTML the editor paints was absolutized against that origin, so
   * in this mode those URLs are unloadable and must be re-pointed at paint time
   * (`retargetMedia`).
   */
  readsBytes: boolean;
}

/**
 * Resolution BY URL — what local and server mode do, and what they keep doing.
 * Stateless: nothing to cache, nothing to revoke.
 */
export function urlMediaSource(origin: string | null): MediaSource {
  return { urlFor: src => previewUrlFor(src, origin), readsBytes: false };
}

/** Before a preview origin exists: absolute URLs load, root-relative ones don't. */
export const NO_PREVIEW_MEDIA: MediaSource = urlMediaSource(null);

/**
 * The attributes `componentPreview.absolutize` stamps beside the URL it writes:
 * the MODEL-SPACE path (`/uploads/x.jpg`), which is what a byte reader needs.
 * Deliberately NOT named `data-sq-src` — that substring reads as `src="/…` to
 * anything grepping the serialized HTML for a root-relative src.
 */
export const MEDIA_PATH_ATTR = 'data-sq-media-path';
export const POSTER_PATH_ATTR = 'data-sq-poster-path';
/** Carries the ORIGINAL srcset of an element that had root-relative candidates.
 *  Only a marker: `retargetMedia` drops srcset rather than resolving it. */
export const MEDIA_SRCSET_ATTR = 'data-sq-media-srcset';
/** Marks an element whose bytes are not here yet — see `retargetMedia`. */
export const MEDIA_PENDING_ATTR = 'data-sq-media-pending';

/**
 * The neutral frame an unresolved media element wears. Byte-identical to the
 * artwork `Media.astro` paints into an EMPTY slot, so the editor never invents a
 * second "nothing to see here" look — and inline, so it needs no network of its
 * own (the whole problem being that this page has no network to the preview).
 */
export const PENDING_MEDIA_SRC =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201200%20800%22%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22%23e2e8f0%22%2F%3E%3Ccircle%20cx%3D%22880%22%20cy%3D%22235%22%20r%3D%2272%22%20fill%3D%22%2394a3b8%22%2F%3E%3Cpath%20d%3D%22M96%20640%20L478%20288%20L780%20640%20Z%22%20fill%3D%22%23cbd5e1%22%2F%3E%3Cpath%20d%3D%22M570%20640%20L834%20394%20L1104%20640%20Z%22%20fill%3D%22%2394a3b8%22%2F%3E%3C%2Fsvg%3E';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

/** Empty when unknown — a typed Blob is required for `<video>`, and an honest
 *  blank lets the browser sniff rather than mislabel. */
export function mimeForPath(path: string): string {
  const ext = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? '';
}

const decodePath = (path: string): string => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path; // a stray `%` is not a reason to refuse a file that exists
  }
};

/**
 * The file in the preview runtime's FS that a root-relative URL is served from,
 * or null when no file backs it.
 *
 * - `/uploads/x.jpg`, `/assets/logos/Halden.svg` → `public/…` (Astro serves
 *   `public/` at the site root — this is the uploaded-media case AND the
 *   shipped-snapshot case, which is why one mapping covers both).
 * - `/@fs/home/projects/x/src/a.png` → `/home/projects/x/src/a.png` (Vite's dev
 *   FS route names an absolute path inside the container).
 * - `/_image?href=…` → whatever `href` names. Astro's dev image endpoint is a
 *   SERVER route with no file of its own, but the file it optimizes is right
 *   there in the query, so the unoptimized original is served instead of
 *   nothing. Best effort by design: an unreadable path yields the pending
 *   frame, never a broken `<img>`.
 * - `/@vite/client`, `/_actions/…` and friends → null (runtime routes).
 */
export function containerPathFor(src: string): string | null {
  if (!src.startsWith('/')) return null;
  if (src.startsWith('/_image')) {
    const query = src.indexOf('?');
    if (query < 0) return null;
    const href = new URLSearchParams(src.slice(query + 1)).get('href');
    return href && href !== src ? containerPathFor(href) : null;
  }
  const path = decodePath(src.split(/[?#]/)[0]);
  // `..` would climb out of the project; a resolver is not a file browser.
  if (path.split('/').includes('..')) return null;
  if (path.startsWith('/@fs/')) return path.slice('/@fs'.length);
  if (path.startsWith('/@') || path.startsWith('/_')) return null;
  if (path === '/') return null;
  return `public${path}`;
}

/**
 * Resolves media for ONE post editor session: URL-mode or byte-mode, with a
 * cache that is the leak guard — a chip re-renders on
 * every attribute change, so minting a fresh object URL per render would grow
 * one per keystroke. One URL per path, revoked on `dispose`.
 */
export class PostMediaResolver implements MediaSource {
  private origin: string | null = null;
  private read: MediaByteReader | null = null;
  /** model src → object URL, or null = tried and there is nothing to show. */
  private readonly urls = new Map<string, string | null>();
  private readonly inflight = new Set<string>();
  private notifyScheduled = false;
  /** Bumped by `release`; a read that started in an earlier one is orphaned. */
  private generation = 0;

  /** `onResolved` re-renders the node views — bytes always arrive after paint. */
  constructor(private readonly onResolved: () => void) {}

  get readsBytes(): boolean {
    return this.read !== null;
  }

  /**
   * Point the resolver at the current preview. `read` non-null = this runtime's
   * origin cannot be loaded as a subresource, so bytes come from its FS.
   *
   * Also THE retry signal: failures are cached so a re-render does not re-request
   * a file that is not there, but a new configure (the preview ladder's tick, an
   * origin change, a container that has finished booting) forgets them — a read
   * that failed while the FS was still materializing gets another chance without
   * any timer of its own.
   */
  configure(origin: string | null, read: MediaByteReader | null): void {
    this.origin = origin;
    this.read = read;
    for (const [src, url] of this.urls) if (url === null) this.urls.delete(src);
  }

  urlFor(src: string | null | undefined): string | null {
    if (!src) return null;
    // Absolute / data: / blob: are loadable as written in every runtime.
    if (!src.startsWith('/') || src.startsWith('//')) return previewUrlFor(src, this.origin);
    if (this.read === null) return previewUrlFor(src, this.origin);
    const known = this.urls.get(src);
    if (known !== undefined) return known;
    this.load(src, this.read);
    return null; // pending — the caller draws its neutral frame, never a broken img
  }

  private load(src: string, read: MediaByteReader): void {
    if (this.inflight.has(src)) return;
    const path = containerPathFor(src);
    if (path === null) {
      this.urls.set(src, null);
      return;
    }
    this.inflight.add(src);
    const gen = this.generation;
    void read(path)
      .then(bytes => {
        // Copied into a plain-ArrayBuffer view: a Blob cannot be built over a
        // SharedArrayBuffer, and this page IS cross-origin isolated, so the
        // reader's buffer type is not ours to assume. Once per file per session.
        const url =
          bytes && bytes.byteLength > 0
            ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeForPath(path) }))
            : null;
        // Released while this read was in flight: the cache it was for is gone,
        // so the URL is neither kept nor leaked.
        if (gen !== this.generation) {
          if (url !== null) URL.revokeObjectURL(url);
          return;
        }
        this.urls.set(src, url);
      })
      .catch(() => {
        if (gen === this.generation) this.urls.set(src, null);
      })
      .finally(() => {
        this.inflight.delete(src);
        if (gen === this.generation) this.scheduleNotify();
      });
  }

  /** One re-render per batch of arrivals, not one per file. */
  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.onResolved();
    });
  }

  /**
   * Revoke every URL and forget every entry — the teardown call.
   *
   * NOT terminal, and that is the point: `main.tsx` runs the app inside
   * `<React.StrictMode>`, whose dev double-mount fires the owning component's
   * mount cleanup once BEFORE the real run. A resolver that could not come back
   * from that would leave every byte-mode chip on its neutral frame forever in
   * dev, while every test, none of which
   * mount under StrictMode, stayed green.
   */
  release(): void {
    this.generation += 1;
    this.inflight.clear();
    for (const url of this.urls.values()) if (url !== null) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

/**
 * Re-point a painted render's media at URLs THIS page can load. Byte-mode only:
 * in URL mode the render already carries the instance URLs and is correct.
 *
 * Works off the stamped model-space paths, not off the absolutized URL, so it
 * survives an origin that changed between fetch and paint (an instance restart
 * can mint a new origin).
 *
 * `srcset`/`sizes` are DROPPED rather than resolved: every candidate is a
 * separate `/_image?w=…` server route with no file behind it, so resolving them
 * would mean N failed reads per image and, worse, a `srcset` the browser
 * prefers over the `src` that did resolve. Dropping them is safe because the
 * shapes that carry one always keep a resolvable fallback — Astro's `<Image>`
 * emits `src` beside its `srcset`, and a `<picture>`'s `<source>`s sit in front
 * of a plain `<img src>`.
 */
export function retargetMedia(root: ParentNode, media: MediaSource): void {
  const stamped = `[${MEDIA_PATH_ATTR}], [${POSTER_PATH_ATTR}], [${MEDIA_SRCSET_ATTR}]`;
  for (const el of root.querySelectorAll(stamped)) {
    // An <iframe> is a document, not a media slot: we have no bytes to hand it
    // and painting image artwork over a working embed is worse than leaving it
    // be. Its src keeps whatever absolutize() resolved.
    if (el.tagName === 'IFRAME') continue;
    el.removeAttribute('srcset');
    el.removeAttribute('sizes');
    for (const [attr, stamp] of [
      ['src', MEDIA_PATH_ATTR],
      ['poster', POSTER_PATH_ATTR],
    ] as const) {
      const path = el.getAttribute(stamp);
      if (path === null) continue;
      const url = media.urlFor(path);
      if (url !== null) {
        el.setAttribute(attr, url);
        continue;
      }
      // Nothing to show yet. An <img> pointed at an unloadable URL is the bug
      // being fixed, and an <img> with NO src collapses the layout, so it wears
      // the same neutral artwork an empty media slot does. A <video> has a
      // purpose-built slot for exactly that: its poster.
      el.setAttribute(MEDIA_PENDING_ATTR, '');
      if (attr === 'src' && el.tagName === 'VIDEO') {
        el.removeAttribute('src');
        el.setAttribute('poster', PENDING_MEDIA_SRC);
      } else if (el.tagName === 'SOURCE') {
        // A <source> handing the browser image artwork would be PREFERRED over
        // a sibling the parent could still resolve. Drop the candidate instead.
        el.remove();
      } else {
        el.setAttribute(attr, PENDING_MEDIA_SRC);
      }
    }
  }
}
