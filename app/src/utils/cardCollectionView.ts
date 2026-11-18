/**
 * Which collection the Fields UI is showing for a card serving several
 * (design 2026-10-09-cards-any-collection §3): one per card file, shared by
 * the Fields switcher, the field picker and the Assets alias rows. Session
 * UI state — nothing on disk.
 */
import { useSyncExternalStore } from 'react';

const views = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getCardCollectionView = (file: string): string | null => views.get(file) ?? null;

export function setCardCollectionView(file: string, collection: string): void {
  if (views.get(file) === collection) return;
  views.set(file, collection);
  version++;
  for (const l of listeners) l();
}

/** The viewed collection: the one picked, else `preferred` (the listing's), else the first — always one of `cols` (null when none). */
export function resolveCardCollectionView(file: string, cols: readonly string[], preferred?: string | null): string | null {
  const picked = views.get(file);
  if (picked && cols.includes(picked)) return picked;
  if (preferred && cols.includes(preferred)) return preferred;
  return cols[0] ?? null;
}

export function useCardCollectionView(file: string, cols: readonly string[], preferred?: string | null): string | null {
  useSyncExternalStore(subscribe, () => version);
  return resolveCardCollectionView(file, cols, preferred);
}

export function _resetCardCollectionViewsForTests(): void { views.clear(); version = 0; }
