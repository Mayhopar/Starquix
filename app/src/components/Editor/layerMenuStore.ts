/** Where the layer context menu (canvas + Layers right-click) is open, in client coordinates. */
export type MenuPoint = { x: number; y: number };

let point: MenuPoint | null = null;
let armed: MenuPoint | null = null;
const listeners = new Set<() => void>();

export const layerMenu = {
  get: (): MenuPoint | null => point,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** null closes. Also drops an armed point. */
  open(next: MenuPoint | null): void {
    armed = null;
    point = next;
    listeners.forEach(listener => listener());
  },
  /** Canvas: open at `at` once the simulated click has selected the layer under it. */
  arm(at: MenuPoint): void { armed = at; },
  takeArmed(): MenuPoint | null {
    const at = armed;
    armed = null;
    return at;
  },
};
