import { useCallback, useSyncExternalStore } from 'react';
import type { SectionReadState } from '@/utils/sectionReadState';
import { projectIdFromPath } from '@/utils/localMode';

/**
 * One project library (components, layouts) per project path, shared by every mounted hook
 * (the editor mounts ~9 of each): one read in flight, one `sq:files-changed` listener, a burst
 * of disk changes coalesced into one rescan. Hooks read it with `useSyncExternalStore`.
 * The first subscriber reads; the last one leaving aborts the read and drops the entry.
 *
 * Desktop: every disk change in the open project (ours echoed, an agent's, git, another app)
 * arrives as `sq:files-changed` (desktopDriver.applyDiskChange). Vite HMR events come only from
 * the editor's own dev server, never for project files.
 */

/** A disk change waits for this much quiet — at most MAX_WAIT_MS in a steady stream — so a run
 *  of writes (an agent, a checkout, a save per keystroke) costs one rescan. */
const QUIET_MS = 250;
const MAX_WAIT_MS = 2000;

export interface LibrarySpec<T> {
  operation: 'components' | 'layouts';
  /** `full`: mount, refresh, HMR or an accepted edit; false: a disk change. */
  read(path: string | null, signal: AbortSignal, full: boolean): Promise<T[]>;
  /** Does this disk change touch what the library lists (`listed` = the current list)? */
  affects(files: readonly string[], gone: readonly string[], listed: readonly T[] | null): boolean;
  /** More triggers while the entry lives (HMR, durable acceptance); returns the teardown. */
  watch?(path: string | null, revalidate: () => void): () => void;
}

interface Entry<T> {
  state: SectionReadState<T[]>; subs: Set<() => void>; read: AbortController | null; episode: number;
  timer: ReturnType<typeof setTimeout> | null; burstStart: number | null; teardown: () => void;
}

const LOADING: SectionReadState<never[]> = Object.freeze({ status: 'loading', data: null });
const sameList = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createLibraryStore<T>(spec: LibrarySpec<T>) {
  const entries = new Map<string | null, Entry<T>>();
  const publish = (entry: Entry<T>, state: SectionReadState<T[]>) => {
    if (entry.state === state) return;
    entry.state = state;
    for (const notify of [...entry.subs]) notify();
  };

  /** Reads now, superseding a read in flight (it may predate the change). */
  function revalidate(path: string | null, entry: Entry<T>, full: boolean): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null; entry.burstStart = null;
    entry.read?.abort();
    const controller = new AbortController();
    entry.read = controller;
    const episode = ++entry.episode;
    const current = () => entries.get(path) === entry && entry.read === controller;
    // A ready library stays 'ready' while it revalidates (stale-while-revalidate).
    if (entry.state.status !== 'ready') publish(entry, entry.state.status === 'loading' ? entry.state : { status: 'loading', data: entry.state.data });
    return spec.read(path, controller.signal, full).then(data => {
      if (!current()) return;
      entry.read = null;
      // An unchanged list keeps the same object: no consumer re-renders.
      const previous = entry.state;
      publish(entry, previous.status === 'ready' && sameList(previous.data, data) ? previous : { status: 'ready', data });
    }, () => {
      if (!current()) return;
      entry.read = null;
      publish(entry, { status: 'unavailable', data: entry.state.data,
        issue: { code: 'read-unavailable', operation: spec.operation, outcome: 'not-applicable',
          owner: { projectId: path, entityKey: spec.operation, visit: episode }, episode, recover: 'read-again', fallbackUsable: false } });
    });
  }

  function open(path: string | null): Entry<T> {
    const entry: Entry<T> = { state: LOADING, subs: new Set(), read: null, episode: 0, timer: null, burstStart: null, teardown: () => {} };
    const projectId = projectIdFromPath(path);
    const onFiles = (e: Event) => {
      const { projectId: id, files, gone } = (e as CustomEvent<{ projectId: string; files: string[]; gone: string[] }>).detail;
      if (id !== projectId || !spec.affects(files, gone, entry.state.data)) return;
      const now = Date.now();
      entry.burstStart ??= now;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { void revalidate(path, entry, false); }, Math.min(QUIET_MS, Math.max(0, entry.burstStart + MAX_WAIT_MS - now)));
    };
    if (projectId) window.addEventListener('sq:files-changed', onFiles);
    const unwatch = spec.watch?.(path, () => { void revalidate(path, entry, true); });
    entry.teardown = () => { window.removeEventListener('sq:files-changed', onFiles); unwatch?.(); };
    entries.set(path, entry);
    void revalidate(path, entry, true);
    return entry;
  }

  return {
    subscribe(path: string | null, notify: () => void): () => void {
      const entry = entries.get(path) ?? open(path);
      entry.subs.add(notify);
      return () => {
        entry.subs.delete(notify);
        if (entry.subs.size || entries.get(path) !== entry) return;
        entries.delete(path);
        if (entry.timer) clearTimeout(entry.timer);
        entry.read?.abort();
        entry.teardown();
      };
    },
    get: (path: string | null): SectionReadState<T[]> => entries.get(path)?.state ?? LOADING,
    /** Read again now (refresh, HMR). Resolves when the read settles. */
    refresh(path: string | null): Promise<void> {
      const entry = entries.get(path);
      return entry ? revalidate(path, entry, true) : Promise.resolve();
    },
  };
}

export type LibraryStore<T> = ReturnType<typeof createLibraryStore<T>>;

export function useLibraryState<T>(store: LibraryStore<T>, path: string | null): SectionReadState<T[]> {
  const subscribe = useCallback((notify: () => void) => store.subscribe(path, notify), [store, path]);
  return useSyncExternalStore(subscribe, () => store.get(path));
}

/** `import.meta.hot` event → revalidate (vitest's hot stub lacks `off`). */
export function onHotEvent(event: string, run: () => void): () => void {
  const hot = import.meta.hot;
  if (!hot || typeof hot.on !== 'function' || typeof hot.off !== 'function') return () => {};
  hot.on(event, run);
  return () => hot.off(event, run);
}
