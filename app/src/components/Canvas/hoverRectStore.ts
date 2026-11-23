import type { ElementRect } from '@/bridge';

/**
 * task-120 (4.2): hoveredRect lives outside React state. Hover moves arrive
 * at pointer rate; as ViewportFrame useState every one re-rendered the whole
 * frame. SelectionOverlay subscribes via useSyncExternalStore, so only the
 * small overlay re-renders.
 *
 * Carries key/tagName alongside the rect (not just the rect) so the image
 * hover-upload overlay can tell, from one atomic update, whether the
 * hovered element is an <img> — never desyncs the way two separate stores
 * updated in sequence could.
 */
export interface HoveredElementInfo {
  computedStyles?: import('@/services/imageFillGeometry').ImageFillGeometry;
  rect: ElementRect;
  /** Absent on legacy/AI-highlight paths that only know the rect */
  key?: string;
  tagName?: string;
}

let current: HoveredElementInfo | null = null;
const listeners = new Set<() => void>();

export const hoverRectStore = {
  get(): HoveredElementInfo | null {
    return current;
  },
  set(info: HoveredElementInfo | null): void {
    if (info === current) return;
    current = info;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/**
 * Option (Alt) held → MeasureOverlay shows distances from the selection to the
 * hovered box. Parent key events feed it directly; with focus inside the preview
 * iframe the bridge relays ALT_KEY instead. Window listeners live only while
 * someone subscribes. Any key event carries altKey, so a missed keyup self-heals.
 */
let altDown = false;
const altListeners = new Set<() => void>();
function setAlt(down: boolean): void {
  if (down === altDown) return;
  altDown = down;
  altListeners.forEach((l) => l());
}
const onKey = (e: KeyboardEvent) => setAlt(e.key === 'Alt' ? e.type === 'keydown' : e.altKey);
const onBlur = () => setAlt(false);

export const altKeyStore = {
  get: (): boolean => altDown,
  set: setAlt,
  subscribe(listener: () => void): () => void {
    if (altListeners.size === 0) {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKey, true);
      window.addEventListener('blur', onBlur);
    }
    altListeners.add(listener);
    return () => {
      altListeners.delete(listener);
      if (altListeners.size > 0) return;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  },
};
