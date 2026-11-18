import { desktopDriver, isDesktop } from '@/services/desktopDriver';

/**
 * "Discard what is on screen and re-render from source" — the one action behind
 * the `sq:reload-preview` event (local mode's Reset to master, DesignBar).
 *
 * Re-navigating the iframe is only HALF of it, and the missing half is what made
 * Reset non-deterministic (round-5 recording): the doc, localStorage and the
 * DesignBar header all agreed the override was gone, and the canvas repainted
 * the discarded value anyway — until a second reload, which was clean.
 *
 * The culprit is ViewportFrame's pending class-update queues. Every DesignBar
 * class edit is filed into them unconditionally (SYNC_CLASSES_TO_IFRAME
 * handler), and they are drained only by the next ELEMENTS_SCANNED — which a
 * class-only edit never produces (no file write ⇒ no HMR, and the bridge's
 * MutationObserver does not rescan on a `class` attribute change). So the
 * reload's own scan is the first scan since the edit, and `handleElementsScanned`
 * replays the queued payload as UPDATE_CLASSES before it ever consults the doc.
 * The values it replays are exactly the ones Reset just discarded.
 *
 * Clearing the queues here makes the discard visible to the re-apply that
 * follows it — an ordering, not a new mechanism. Nothing is lost: an override
 * that still exists in the doc is re-applied from the doc by the very same scan
 * (`reapplySourceClassOverrides`), which is the authoritative path; the queue is
 * a retry buffer for DOM misses only.
 *
 * It acts on refs ViewportFrame owns for the local-folder and files-truth WC
 * runtime; both use the same explicit reload event.
 */
/** The one event name. Callers use {@link requestPreviewReload}, never a literal. */
export const PREVIEW_RELOAD_EVENT = 'sq:reload-preview';

/**
 * Ask the mounted ViewportFrame to discard what is on screen and re-render from
 * source. THE way to trigger the reload — DesignBar's "Reset to master" and
 * UndoContext's local doc-only undo/redo both go through here, so there is one
 * mechanism and one name to grep for.
 *
 * Inert wherever no ViewportFrame is listening (tests, headless).
 */
export function requestPreviewReload(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREVIEW_RELOAD_EVENT));
}

/**
 * Cap on a one-shot read of what the instance serves for the frame's URL
 * (capturePreviewBaseline — the class-write certifier reads it). One GET of a
 * route the frame already shows; a miss is a null, never a wait.
 *
 * The verified-reload poll that used to follow a Push (rounds 11/15) is gone:
 * with the seamless canvas every file write reaches the frame through Vite's
 * own reload, which the bridge turns into an in-place refresh that fetches
 * AFTER the change (plan docs/plans/2026-10-04-seamless-canvas-plan.md 2.6).
 */
export const PREVIEW_BASELINE_TIMEOUT_MS = 500;

/**
 * ViewportFrame publishes the URL the frame is currently showing. Read as a
 * getter so each operation captures the current URL and authoritative runtime
 * together. After native navigation the src attribute can intentionally remain
 * parked at an old route; ViewportFrame publishes its current desired URL.
 */
let previewUrlProvider: (() => string | null) | null = null;
export function setPreviewUrlProvider(fn: (() => string | null) | null): void {
  previewUrlProvider = fn;
}

function capturePreviewRead(): ((init: RequestInit) => Promise<Response>) | null {
  const url = previewUrlProvider?.() ?? null;
  // `about:blank` is what previewSrc returns while the instance boots or errors.
  if (!url || url.startsWith('about:')) return null;
  // The instance secret lives in the desktop main process — documents ride the
  // lease's IPC. (No desktop bridge = a test or a plain-browser dev page.)
  return isDesktop() ? desktopDriver.captureDocumentReader(url) : init => fetch(url, init);
}

/**
 * The served bytes, or null if they cannot be read (no frame, non-ok, offline,
 * or `budgetMs` elapsed first).
 *
 * The budget is what makes the caller's cap a real ceiling: without it a single
 * slow response runs to completion and the loop only notices afterwards, which
 * is how a 3000 ms cap measured 3636 ms live. An abort lands in the same `catch`
 * as any other read failure — "could not read" is already not a change.
 */
async function fetchServedBytes(read: (init: RequestInit) => Promise<Response>, budgetMs: number): Promise<string | null> {
  // AbortController, not AbortSignal.timeout: the latter is absent from some
  // jsdom builds and this must behave identically in tests and in Chrome.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), Math.max(0, budgetMs));
  try {
    // `accept: text/html` matches the iframe's own request, so the plugin's
    // HTML-arming middleware runs for our probe too and we compare the same
    // artifact the frame will receive.
    const res = await read({
      cache: 'no-store',
      headers: { accept: 'text/html' },
      signal: controller.signal,
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null; // instance gone, CORS lost, or out of budget — verification degrades
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Snapshot what the instance serves for the frame's current URL. Call BEFORE
 * the writes; hand the result to {@link requestVerifiedPreviewReload}.
 *
 * `null` means "cannot verify" and is not an error — with needles it simply
 * means none can be dropped, and with no needles the caller falls back to the
 * immediate reload, i.e. exactly the pre-round-11 behaviour.
 *
 * Bounded by {@link PREVIEW_BASELINE_TIMEOUT_MS}, NOT by the verify cap: this is
 * a snapshot, not a wait, and it sits on the same click as the loop.
 */
export async function capturePreviewBaseline(): Promise<string | null> {
  const read = capturePreviewRead();
  return read ? fetchServedBytes(read, PREVIEW_BASELINE_TIMEOUT_MS) : null;
}

export interface PreviewReloadTargets {
  iframe: HTMLIFrameElement | null;
  /** ViewportFrame's `pendingKeyUpdatesRef` (key → payload). */
  pendingKeyUpdates: Map<string, unknown>;
}

export function reloadPreviewFromSource(targets: PreviewReloadTargets): void {
  // Order is the whole point: invalidate BEFORE the refresh, so the scan it
  // triggers can never find a discarded value to replay.
  targets.pendingKeyUpdates.clear();
  // Seamless canvas (Task 2.6): never navigate. The bridge re-fetches the
  // page's FILE bytes and morphs them in place (source-refresh.ts); the live
  // #sq-ov fragment re-applies the overrides that are still current.
  targets.iframe?.contentWindow?.postMessage({ type: 'REFRESH_FROM_SOURCE' }, '*');
}
