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
