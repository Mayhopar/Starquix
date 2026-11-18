/**
 * task-118 — toast when a structural source edit orphans overrides.
 * Observes the overrideOrphans map (grow only; discard/undo are silent) and
 * fires one toast per affected component: "N override(s) orphaned in <name>".
 * Review/keep/discard lives in the DesignBar badge (OrphanedOverridesBadge).
 */
import { useEffect } from 'react';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { useEditorDoc } from '@/store/hooks';
import { getOrphansMap, type OverrideOrphan } from '@/store/overrideOrphans';

const componentNameOf = (astroSource: string): string =>
  astroSource.split('/').pop()?.replace(/\.astro$/, '') ?? astroSource;

export function useOrphanToast(): void {
  const doc = useEditorDoc();
  useEffect(() => {
    const map = getOrphansMap(doc);
    const observer = (event: Y.YMapEvent<OverrideOrphan>) => {
      // Only live command dispatches toast: hydration (y-indexeddb provider
      // object origin) re-adds persisted orphans on every project open, and
      // 'undo' re-adds discarded ones — both are old news, not new orphanings.
      const origin = event.transaction.origin as unknown;
      if (origin === 'undo' || (origin !== null && typeof origin === 'object')) return;
      // changes must be read INSIDE the handler (they are invalid afterwards)
      const added: string[] = [];
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add') added.push(key);
      });
      if (added.length === 0) return;
      const bySource = new Map<string, number>();
      for (const key of added) {
        const orphan = map.get(key) as OverrideOrphan | undefined;
        if (orphan) bySource.set(orphan.astroSource, (bySource.get(orphan.astroSource) ?? 0) + 1);
      }
      for (const [astroSource, n] of bySource) {
        // no fixed id: react-hot-toast swallows a re-issued id after the
        // previous toast with it was dismissed — each orphaning event is real
        toast(
          `${n} override${n === 1 ? '' : 's'} orphaned in ${componentNameOf(astroSource)} — review in the Design Bar`,
          { icon: '⚠️', duration: 6000 },
        );
      }
    };
    map.observe(observer);
    return () => map.unobserve(observer);
  }, [doc]);
}
