import { useSyncExternalStore } from 'react';
import { classesToFamily, familyToClass } from '@/components/DesignBar/blocks/fontFamilyClass';

/**
 * Font families the preview page loads (bridge FONT_FAMILIES, sent after each
 * scan and any <head> change) — fonts the site brings itself: an earlier upload after
 * reopen, a WordPress import, CSS the AI or the CSS tab wrote. The picker lists
 * them; picking one only writes the class, since the site already loads the face.
 */
const NONE: string[] = [];
let current = { projectId: '', families: NONE };
const listeners = new Set<() => void>();

export function setSiteFonts(projectId: string, families: unknown): void {
  if (!Array.isArray(families)) return;
  // Only names the font-["…"] class round-trips: the picker must read back what it applied.
  const next = [...new Set(families.filter((f): f is string =>
    typeof f === 'string' && classesToFamily(familyToClass(f))?.value === f))].sort();
  if (current.projectId === projectId && next.join('\n') === current.families.join('\n')) return;
  current = { projectId, families: next };
  listeners.forEach((l) => l());
}

export function siteFontFamilies(projectId: string): string[] {
  return current.projectId === projectId ? current.families : NONE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSiteFonts(projectId: string): string[] {
  return useSyncExternalStore(subscribe, () => siteFontFamilies(projectId));
}
