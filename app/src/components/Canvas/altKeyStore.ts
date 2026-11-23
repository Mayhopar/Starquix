/**
 * Option (Alt) held → Option-hover measuring: ViewportFrame forwards hover while it is down and
 * SelectionOverlay shows MeasureOverlay. Window key events feed it; ViewportFrame also sets it
 * from every canvas mouse move, so a keyup missed while focus was elsewhere heals on the next
 * move. Window listeners live only while someone subscribes.
 */
let down = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === down) return;
  down = next;
  listeners.forEach((l) => l());
}
const onKey = (e: KeyboardEvent) => set(e.key === 'Alt' ? e.type === 'keydown' : e.altKey);
const onBlur = () => set(false);

function listen(add: boolean): void {
  if (add) {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
  } else {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('blur', onBlur);
  }
}

export const altKeyStore = {
  get: (): boolean => down,
  set,
  subscribe(listener: () => void): () => void {
    if (listeners.size === 0) listen(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listen(false);
    };
  },
};
