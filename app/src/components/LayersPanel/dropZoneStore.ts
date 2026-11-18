/**
 * Tiny external store for the LIVE Layers drop zone (before/inside/after) of the
 * row currently under the pointer. Editor's `onDragMove` writes it; each
 * `SortableNode` reads its own row's zone via `useSyncExternalStore` so only the
 * tree rows re-render on pointer move (NOT the Canvas). The SAME zone math feeds
 * the drop decision in `onDragEnd`, so the indicator can never disagree with what
 * the drop actually does. See docs/plans/task-078-position-aware-drop-ledger.md.
 */
import type { DropPosition } from '@/store/planLayersDrop';

export interface DropZoneState {
  overKey: string | null;
  zone: DropPosition | null;
}

let state: DropZoneState = { overKey: null, zone: null };
const listeners = new Set<() => void>();

export function setDropZone(overKey: string | null, zone: DropPosition | null): void {
  if (state.overKey === overKey && state.zone === zone) return;
  state = { overKey, zone };
  for (const l of listeners) l();
}

export function clearDropZone(): void {
  setDropZone(null, null);
}

export function subscribeDropZone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot: same reference until `setDropZone` actually changes it. */
export function getDropZoneSnapshot(): DropZoneState {
  return state;
}
