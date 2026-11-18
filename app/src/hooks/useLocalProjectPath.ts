import { useParams } from 'react-router-dom';
import { isLocalProjectId, findLocalProjectEntry } from '@/utils/localMode';

/**
 * task-136/137: the opened local project's folder path, or null when the
 * current route is not a local_ project (or its recents entry is gone —
 * ledger #9, the editor fails soft elsewhere). Derived from the /editor/*
 * splat param so library hooks can source locally without an arming race.
 */
export function useLocalProjectPath(): string | null {
  const params = useParams<{ '*': string }>();
  const projectId = params['*'] ?? '';
  if (!isLocalProjectId(projectId)) return null;
  return findLocalProjectEntry(projectId)?.path ?? null;
}
