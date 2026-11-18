/**
 * Run `flush` when the page is about to die or go background — pagehide plus
 * visibilitychange→hidden (reload, tab close, tab switch). THE shared wiring
 * for debounced-persistence tiers whose pending timer would die with the page
 * (task-077 localStorage tiers, task-098 editor auto-bake + masters saver).
 * Returns the unsubscribe.
 */
export function listenFlushOnHide(flush: () => void): () => void {
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHidden);
  return () => {
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHidden);
  };
}
