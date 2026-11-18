/**
 * "Put this element back the way the source renders it" — the in-place repaint
 * an undo needs when it REMOVES an overlay entry (task-151).
 *
 * Why this is not a preview reload. task-149 covered the same cases by
 * re-navigating the iframe, and two live measurements retired that: the reload
 * costs 100 % of the scroll position (1087 px → 0 in 1036 ms at the editor's
 * 375×667 geometry, where server mode loses none because it patches in place),
 * and it raced — a redo left the canvas byte-identical for 20 s even though the
 * frame demonstrably reloaded. Value changes have always been patched in place
 * with neither cost; add/remove now go the same way.
 *
 * Why the value comes from the iframe. Neither undo snapshot holds the
 * pre-override value, and the scan payload cannot supply it either: `classes` is
 * read live off the DOM, so it reports the OVERRIDE after any rescan that
 * follows one; `textContent` is direct-text-nodes only, trimmed to 200 chars;
 * and image attribute values are not in the payload at all. The bridge holds the
 * element in its pre-override state at the instant it is asked to apply the
 * first override, and captures it there (`originalClassesByKey`,
 * `originalImageAttrsByKey`, `originalTextByKey`).
 *
 * Runtime-agnostic by construction, exactly like reloadPreview.ts: it acts on
 * refs ViewportFrame owns in every runtime, and posts the same kind of in-place
 * bridge message WC and server already use for every value change.
 */
import type { SourceLocation } from '@/store/types';
import type { ClassIntentTag } from '@/bridge/types';

/** Same-window relay types (ClassStoreContext / useSourceImageSync → ViewportFrame). */
export const RESTORE_CLASSES_RELAY = 'RESTORE_CLASSES_TO_IFRAME';
export const RESTORE_IMAGE_ATTRS_RELAY = 'RESTORE_IMAGE_ATTRS_TO_IFRAME';

export interface ClassRestoreRequest {
  key: string;
  /**
   * The parent's registration-time classes, used only when this bridge never
   * applied an override for the key (so it captured no baseline). The bridge's
   * own capture always wins — it is the one value taken before any override
   * touched the DOM.
   */
  fallbackClasses: string;
  sourceLocation?: SourceLocation;
  /** The undo's intent: without it a canvas that holds the key would drop the restore (instant-edit P0b). */
  intent?: ClassIntentTag;
}

export interface ImageAttrRestoreRequest {
  key: string;
  /** The attributes the removed overlay entry held. */
  attributes: string[];
}

export function requestClassRestore(request: ClassRestoreRequest): void {
  if (typeof window === 'undefined') return;
  window.postMessage({ type: RESTORE_CLASSES_RELAY, payload: request }, '*');
}

export function requestImageAttrRestore(request: ImageAttrRestoreRequest): void {
  if (typeof window === 'undefined') return;
  window.postMessage({ type: RESTORE_IMAGE_ATTRS_RELAY, payload: request }, '*');
}

export interface ClassRestoreTargets {
  iframe: HTMLIFrameElement | null;
  /** ViewportFrame's `pendingKeyUpdatesRef` (key → payload). */
  pendingKeyUpdates: Map<string, unknown>;
  /** The frame's document announced class intents: only then is the intent forwarded. */
  intents?: boolean;
}

/**
 * Evicting the key from both retry queues is not housekeeping — it is half the
 * fix. Every class edit is filed into them unconditionally and nothing drains
 * them until the next ELEMENTS_SCANNED, which replays the queued payload as
 * UPDATE_CLASSES *before* the doc re-apply. Leaving the discarded value there
 * resurrects it on whatever rescan happens next (round-4 defect; see
 * reloadPreview.ts, which does the same thing wholesale for Reset).
 */
export function applyClassRestore(targets: ClassRestoreTargets, request: ClassRestoreRequest): void {
  targets.pendingKeyUpdates.delete(request.key);

  targets.iframe?.contentWindow?.postMessage({
    type: 'RESTORE_ORIGINAL_CLASSES',
    payload: { key: request.key, fallbackClasses: request.fallbackClasses, ...(targets.intents && request.intent ? { intent: request.intent } : {}) },
  }, '*');
}

export function applyImageAttrRestore(
  iframe: HTMLIFrameElement | null,
  request: ImageAttrRestoreRequest,
): void {
  iframe?.contentWindow?.postMessage({
    type: 'RESTORE_ORIGINAL_IMAGE_ATTRIBUTES',
    payload: { key: request.key, attributes: request.attributes },
  }, '*');
}
