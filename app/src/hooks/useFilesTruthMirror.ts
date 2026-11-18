import { useEffect, useState } from 'react';
import { db } from '@/db';
import { isLocalProjectId, markFilesTruth } from '@/utils/localMode';

/** Dexie is authoritative. A failed advisory localStorage mirror never reloads the tab. */
export function useFilesTruthMirror(projectId: string): boolean {
  const [resolved, setResolved] = useState<string | null>(null);
  const filesTruth = resolved === projectId || isLocalProjectId(projectId);
  useEffect(() => {
    if (isLocalProjectId(projectId)) return;
    let cancelled = false;
    void db.projects.get(projectId).then(row => {
      if (cancelled || !row?.filesTruth) return;
      markFilesTruth(projectId);
      setResolved(projectId);
    }).catch(() => { /* useProjectSync displays the actual database-open failure. */ });
    return () => { cancelled = true; };
  }, [projectId]);
  return filesTruth;
}
