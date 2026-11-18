/**
 * Gesture stash (instant-edit P2, decision 17): a SYNCHRONOUS localStorage mirror of every class intent the canvas shows that the
 * acceptance lane has not accepted yet. A typed number waits for its settle window before it commits and a stepper burst commits
 * at key-up + a short idle: a reload, a renderer crash or a kill inside that window would lose it, and nothing async survives
 * pagehide. Every armed keystroke / tick / class edit call writes its intent here first; acceptance or rejection clears it; the
 * next open replays what is left (context/hooks/useGestureStashReplay.ts). Invariant: every class edit the canvas shows is
 * accepted or stashed. One entry per project + key: a newer intent of a key supersedes the older (the lane skips the older too).
 */
const STORAGE_KEY = 'sq:gesture-stash:v1';
export const STASH_TTL_MS = 24 * 3600 * 1000;

export interface StashEntry {
  projectId: string;
  key: string;
  /** The class string the element should have. */
  classes: string;
  /** The class the element had when the pending chain of intents for this key began: a replay only re-issues when the
   * committed class still equals it (newest wins, never a blind splice). */
  baseline: string | null;
  origin: unknown;
  /** The class-edit operation that carries `classes` (null while it is still a typed draft or a preview tick). */
  opId: string | null;
  ts: number;
}
type Store = Record<string, StashEntry>;
const slot = (projectId: string, key: string): string => `${projectId}\u0000${key}`;

function read(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Store : {};
  } catch { return {}; }
}
function write(store: Store): void {
  try {
    if (Object.keys(store).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); else localStorage.removeItem(STORAGE_KEY);
  } catch { /* quota / private mode: the lane still accepts the edit; only the safety net is missing */ }
}

/** Synchronous: callable from a keydown, an `input` event, a `pagehide` handler. */
export function stashPut(entry: Omit<StashEntry, 'ts'> & { ts?: number }): void {
  const store = read();
  const id = slot(entry.projectId, entry.key);
  const previous = store[id];
  store[id] = { ...entry, baseline: previous ? previous.baseline : entry.baseline, ts: entry.ts ?? Date.now() };
  write(store);
}

/** The op was accepted (or rejected): forget its intent. A newer intent of the key (another opId) stays. */
export function stashClear(projectId: string, key: string, opId?: string): void {
  const store = read();
  const id = slot(projectId, key);
  const entry = store[id];
  if (!entry || (opId !== undefined && entry.opId !== opId)) return;
  delete store[id];
  write(store);
}

/** Live entries of one project (expired ones are dropped here). */
export function stashEntries(projectId: string, now = Date.now()): StashEntry[] {
  const store = read();
  let dirty = false;
  const live: StashEntry[] = [];
  for (const [id, entry] of Object.entries(store)) {
    if (now - entry.ts > STASH_TTL_MS) { delete store[id]; dirty = true; continue; }
    if (entry.projectId === projectId) live.push(entry);
  }
  if (dirty) write(store);
  return live.sort((a, b) => a.ts - b.ts);
}

export function stashHas(projectId: string, key: string): boolean { return !!read()[slot(projectId, key)]; }
export function _resetGestureStashForTests(): void { try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ } }
