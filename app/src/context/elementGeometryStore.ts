import type { ElementRect } from '@/bridge';
export type GeometryPatch = { key: string; rect: ElementRect };
export interface ElementGeometryStore {
  get(key: string): ElementRect | null;
  subscribe(key: string, listener: () => void): () => void;
  update(patches: readonly GeometryPatch[]): void;
  replace(patches: readonly GeometryPatch[]): void;
  clear(): void;
}
export function sameElementRect(a: ElementRect, b: ElementRect): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}
export function createElementGeometryStore(): ElementGeometryStore {
  const rects = new Map<string, ElementRect>();
  const listeners = new Map<string, Set<() => void>>();
  function publish(patches: readonly GeometryPatch[], replace: boolean) {
    const next = new Map(patches.map(({ key, rect }) => [key, rect]));
    const changed = new Set<string>();
    if (replace) for (const key of rects.keys()) {
      if (!next.has(key)) { rects.delete(key); changed.add(key); }
    }
    for (const [key, rect] of next) {
      const previous = rects.get(key);
      if (previous && sameElementRect(previous, rect)) continue;
      rects.set(key, Object.freeze({ ...rect }));
      changed.add(key);
    }
    // Commit the entire batch before notifying any consumer.
    const notify = new Set<() => void>();
    for (const key of changed) listeners.get(key)?.forEach(listener => notify.add(listener));
    notify.forEach(listener => listener());
  }
  return {
    get: key => rects.get(key) ?? null,
    subscribe(key, listener) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, set = new Set());
      set.add(listener);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
    update: patches => publish(patches, false),
    replace: patches => publish(patches, true),
    clear: () => publish([], true),
  };
}
