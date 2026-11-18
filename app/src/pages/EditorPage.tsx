// src/pages/EditorPage.tsx
import { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { ProjectNavigationGuard } from '@/components/ProjectNavigationGuard';
import { Editor } from '@/components/Editor';

export default function EditorPage() {
  // Using '*' wildcard to capture paths with slashes (e.g., local_projects/personal-website)
  const params = useParams<{ '*': string }>();
  const projectId = params['*'];
  // An id with no project on this device (stale bookmark, wiped browser) is a
  // redirect to Projects — never the recovery banner.
  const [missing, setMissing] = useState(false);

  if (!projectId || missing) {
    return <Navigate to="/" replace />;
  }

  return <><ProjectNavigationGuard projectId={projectId} /><AppErrorBoundary key={projectId}><Editor projectId={projectId} onProjectMissing={() => setMissing(true)} /></AppErrorBoundary></>;
}
