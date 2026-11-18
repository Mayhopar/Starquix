import { useSyncExternalStore } from 'react';

/**
 * The visual alignment grid: what the top-bar Grid chip sets and LayoutGridOverlay
 * draws. A per-project VIEW preference in localStorage (like the screen height) —
 * not a document edit: not in Yjs, not in files, not in ⌘Z.
 * Design + ledger: docs/plans/2026-11-16-layout-grid-design.md
 */
export type GridType = 'columns' | 'square';

export interface GridSettings {
  on: boolean;
  type: GridType;
  /** columns: how many */
  count: number;
  /** columns: space between them, px */
  gutter: number;
  /** columns: space at both outer edges, px */
  margin: number;
  /** square: line pitch, px */
  size: number;
}

/** [min, max] per number; every write is rounded and clamped into it. */
export const GRID_LIMITS = {
  count: [1, 24],
  gutter: [0, 200],
  margin: [0, 1000],
  size: [2, 512],
} as const;
export type GridNumberKey = keyof typeof GRID_LIMITS;

/** Off by default; 12 columns × 16px gutters + 16px margins fit even the 320px xs artboard. */
export const DEFAULT_GRID: GridSettings = { on: false, type: 'columns', count: 12, gutter: 16, margin: 16, size: 8 };

/** Anything → valid settings: wrong type → default, number out of range → clamped. Never throws. */
function normalize(raw: unknown): GridSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: GridSettings = { ...DEFAULT_GRID, on: r.on === true, type: r.type === 'square' ? 'square' : 'columns' };
  for (const key of Object.keys(GRID_LIMITS) as GridNumberKey[]) {
    const v = r[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [min, max] = GRID_LIMITS[key];
    out[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  return out;
}

const STORAGE_KEY = 'sq:grid';
const listeners = new Set<() => void>();

// Memory is the source during a session: snapshots stay referentially stable for
// useSyncExternalStore, and the grid still works when storage is blocked.
let cache: Map<string, GridSettings> | null = null;

function load(): Map<string, GridSettings> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
    return new Map(Object.entries(raw).map(([id, s]) => [id, normalize(s)]));
  } catch { return new Map(); }
}

const store = (): Map<string, GridSettings> => (cache ??= load());

/** `null` (no project yet) shares one bucket so nothing crashes before the id arrives. */
export function getGrid(projectId: string | null): GridSettings {
  return store().get(projectId ?? '') ?? DEFAULT_GRID;
}

export function setGrid(projectId: string | null, patch: Partial<GridSettings>): void {
  const current = getGrid(projectId);
  const next = normalize({ ...current, ...patch });
  // Nothing changed (the active segment pressed again, a retype past a clamp): no write, no re-render.
  if ((Object.keys(next) as (keyof GridSettings)[]).every((k) => next[k] === current[k])) return;
  // Re-read storage so another window's entries for OTHER projects survive; memory keeps ours when storage is blocked.
  cache = new Map([...store(), ...load(), [projectId ?? '', next]]);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache))); }
  catch { /* shortcut: storage blocked → the grid lasts this session only; nothing to tell the user */ }
  listeners.forEach((l) => l());
}

export const toggleGrid = (projectId: string | null): void => setGrid(projectId, { on: !getGrid(projectId).on });

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useGrid(projectId: string | null): GridSettings {
  return useSyncExternalStore(subscribe, () => getGrid(projectId));
}

/** Test seam: forget the in-memory copy so the next read goes back to localStorage. */
export function _resetGridCacheForTests(): void { cache = null; }
