// src/routes/index.tsx
import { RouteErrorRecovery } from '@/components/AppErrorBoundary';
import { createBrowserRouter } from 'react-router-dom';
import ProjectsPage from '@/pages/ProjectsPage';
import LandingPage from '@/pages/LandingPage';
import SignInPage from '@/pages/SignInPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorRecovery />,
    path: '/',
    element: <ProjectsPage />,
  },
  {
    errorElement: <RouteErrorRecovery />,
    path: '/landing',
    element: <LandingPage />,
  },
  {
    errorElement: <RouteErrorRecovery />,
    path: '/sign-in',
    element: <SignInPage />,
  },
  {
    errorElement: <RouteErrorRecovery />,
    path: '/auth/callback',
    element: <AuthCallbackPage />,
  },
  // Uses * to capture paths with slashes (e.g., /editor/browser_abc123)
  {
    errorElement: <RouteErrorRecovery />,
    path: '/editor/*',
    lazy: async () => {
      const { default: Component } = await import('@/pages/EditorPage');
      return { Component };
    },
  },
]);
