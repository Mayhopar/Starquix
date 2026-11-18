import { useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { setActiveProjectForSave } from '@/services/pendingProjectMutations';
import { awaitUserAccepted, hasPendingUserAcceptance } from '@/services/durableEdits/acceptance';

/** Join only an initiating local commit. Source/preview recovery never gates
 * navigation, prompts the user, or requires keeping a runtime mounted. */
export function ProjectNavigationGuard({ projectId }: { projectId: string }) {
  const handled = useRef(false);
  useLayoutEffect(() => { setActiveProjectForSave(projectId); }, [projectId]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && hasPendingUserAcceptance(projectId));
  useEffect(() => {
    if (blocker.state !== 'blocked') { handled.current = false; return; }
    if (handled.current) return;
    handled.current = true;
    // Rejection discards staged state; it does not leave an unsaved live edit.
    void awaitUserAccepted(projectId).then(() => blocker.proceed());
  }, [blocker, projectId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasPendingUserAcceptance(projectId)) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [projectId]);
  return null;
}
