/**
 * A project id with no project on this device redirects to Projects.
 * Ledger case 1, docs/plans/2026-09-10-remove-open-local-folder-design.md.
 */
import { render, screen, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { it, expect, vi } from 'vitest';
import React from 'react';
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => prop === 'then' ? undefined : Stub, has: () => true });
});
vi.mock('@/components/Editor', () => ({
  Editor: ({ onProjectMissing }: { onProjectMissing?: () => void }) => {
    React.useEffect(() => { onProjectMissing?.(); }, [onProjectMissing]);
    return <div>Editor mounted</div>;
  },
}));
vi.mock('@/services/filesTruthSync', () => ({ syncChangedFiles: async () => {}, getFilesTruthSyncStatus: () => ({ projectId: null, status: 'idle', error: null }), subscribeFilesTruthSyncStatus: () => () => {} }));
import EditorPage from '@/pages/EditorPage';

it('an unknown project id lands on Projects, not on a recovery banner', async () => {
  const router = createMemoryRouter([{ path: '/editor/*', element: <EditorPage /> }, { path: '/', element: <div>Projects</div> }], { initialEntries: ['/editor/local_1abc2'] });
  await act(async () => { render(<RouterProvider router={router} />); });
  expect(await screen.findByText('Projects')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});
