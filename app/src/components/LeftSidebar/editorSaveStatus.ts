/**
 * Editor auto-save status — pure reducer + module-level store consumed via
 * useSyncExternalStore. Ephemeral UI state by design: NOT in Yjs (must never
 * be undoable/snapshotted), NOT in context (producer LeftSidebar and consumer
 * DesignBar are far apart). See docs/archive/plans/2026-06-10-save-feedback-design.md §4.3.
 */
import { useSyncExternalStore } from 'react';
import type { PushResult } from '@/utils/pushOverridesToSource';

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'dirty' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'saved-with-skips'; at: number; skipped: PushResult['skipped'] }
  | { state: 'error'; message: string };

export type SaveEvent =
  | { type: 'EDIT' }
  | { type: 'FLUSH_START' }
  | { type: 'FLUSH_SUCCESS'; result: PushResult }
  | { type: 'FLUSH_ERROR'; message: string }
  | { type: 'RESET' };

export function reduceSaveStatus(s: SaveStatus, e: SaveEvent): SaveStatus {
  switch (e.type) {
    case 'EDIT': return { state: 'dirty' };
    case 'RESET': return { state: 'idle' };
    // FLUSH_START only from dirty — the flush also fires on component-switch
    // with nothing pending; staying idle/saved there is correct.
    case 'FLUSH_START': return s.state === 'dirty' ? { state: 'saving' } : s;
    case 'FLUSH_SUCCESS':
      if (s.state !== 'saving') return s; // stale resolution after a newer EDIT
      return e.result.skipped.length === 0
        ? { state: 'saved', at: Date.now() }
        : { state: 'saved-with-skips', at: Date.now(), skipped: e.result.skipped };
    case 'FLUSH_ERROR':
      return s.state === 'saving' ? { state: 'error', message: e.message } : s;
  }
}

let current: SaveStatus = { state: 'idle' };
const listeners = new Set<() => void>();

export function dispatchSaveEvent(e: SaveEvent): void {
  const next = reduceSaveStatus(current, e);
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export function useEditorSaveStatus(): SaveStatus {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
  );
}

/** Test-only: reset module state between tests. */
export function __resetSaveStatusForTests(): void {
  current = { state: 'idle' };
  listeners.clear();
}
