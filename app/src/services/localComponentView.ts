// task-143: which user component/layout file the local-mode component view is
// showing (null = a normal page). Mirrors Editor's localComponentFile state —
// set ONLY by Editor (single write point, same pattern as serverWriteMode) so
// deep panels (FillBlock's usage picker, DesignBar's component-editor gate) can
// branch without prop drilling.
//
// task-149: DesignBar reads it through useSyncExternalStore, so the store
// NOTIFIES. Without that, opening/leaving the component view would not re-render
// the panel and it would keep the previous view's chrome (the ⋮/↗/* cluster) on
// screen — the defect this subscription exists to prevent.
let file: string | null = null;

const listeners = new Set<() => void>();

export function setLocalComponentViewFile(f: string | null): void {
  if (file === f) return;
  file = f;
  for (const l of listeners) l();
}

export function getLocalComponentViewFile(): string | null {
  return file;
}

/** useSyncExternalStore subscribe. Returns the unsubscribe. */
export function subscribeLocalComponentView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** switchLocalComponentView gave up on `file` (the route never answered): the
 *  canvas stayed on `previous`, so the row that asked follows it back. */
export const LOCAL_COMPONENT_VIEW_FAILED = 'sq:local-component-view-failed';

/** Ask Editor to show `file`'s master view (null = back to the page) — the one
 *  event the Assets panel, the DesignBar and the AI tools all send. */
export function requestLocalComponentView(f: string | null): void {
  window.dispatchEvent(new CustomEvent('sq:local-component-view', { detail: { file: f } }));
}

/** Show the page: the File-tab click path (LeftSidebar leaves the Assets tab
 *  AND the view). The Assets tab never shows a page, so a caller that wants
 *  the page sends this, not requestLocalComponentView(null). */
export function requestPageView(): void {
  window.dispatchEvent(new CustomEvent('sq:go-to-page'));
}
