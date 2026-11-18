// src/App.tsx
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { hasPendingUserAcceptance } from '@/services/durableEdits/acceptance';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { router } from '@/routes';
import { startAuthBoot } from '@/auth/bootAuth';

export default function App() {
  useEffect(() => startAuthBoot(), []);

  return (
    <AppErrorBoundary beforeRetry={async () => {
      // History can change while RouterProvider is unmounted. Return to a
      // project whose edit is still committing so that commit is not cut short.
      const projectId = getActiveSaveProjectId();
      if (projectId && hasPendingUserAcceptance(projectId)) await router.navigate(`/editor/${projectId}`, { replace: true });
    }}>
      <RouterProvider router={router} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--color-bg-contrast)',
            color: 'var(--color-text)',
            borderRadius: '0.5rem',
            padding: '12px 16px',
            fontSize: '14px',
            border: '1px solid var(--color-stroke)',
          },
          success: {
            iconTheme: {
              primary: '#22c55e',
              secondary: 'var(--color-bg-contrast)',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: 'var(--color-bg-contrast)',
            },
          },
        }}
      />
    </AppErrorBoundary>
  );
}
