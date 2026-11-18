import 'fake-indexeddb/auto';
import React from 'react';
import * as Y from 'yjs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ crash: false, router: null as any }));
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, RouterProvider: (props: React.ComponentProps<typeof actual.RouterProvider>) => {
    if (fixture.crash) throw new Error('sk-secret-project-source');
    return <actual.RouterProvider {...props} />;
  } };
});
vi.mock('@/routes', () => ({ get router() { return fixture.router; } }));
vi.mock('@/auth/bootAuth', () => ({ startAuthBoot: () => () => {} }));
vi.mock('@/components/Editor', () => ({ Editor: () => <div>Retained editor</div> }));
const journal = vi.hoisted(() => ({ projectId: 'browser_root' as string | null, status: 'idle', error: null }));
vi.mock('@/services/filesTruthSync', () => ({ syncChangedFiles: async () => {}, getFilesTruthSyncStatus: () => journal, subscribeFilesTruthSyncStatus: () => () => {} }));
import { createMemoryRouter } from 'react-router-dom';
import App from '@/App';
import EditorPage from '@/pages/EditorPage';
import { setActiveProjectForSave } from '@/services/pendingProjectMutations';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import * as store from '@/services/durableEdits/store';
import { db } from '@/db';
let doc: Y.Doc;
/** Hold one acceptance transaction open: the only state that must finish before leaving. */
function holdAcceptance() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = store.acceptStoredEdit;
  vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => { await gate; return save(input); });
  const accepting = acceptProjectEdit(doc, { projectId: 'browser_root', operationId: 'edit', commands: [], mutate: staged => staged.getMap('order').set('value', 1) });
  return { release, accepting };
}
beforeEach(async () => {
  await db.delete(); await db.open();
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_root');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  journal.projectId = 'browser_root'; setActiveProjectForSave('browser_root'); fixture.crash = true;
  fixture.router = createMemoryRouter([{ path: '/editor/*', element: <EditorPage /> }, { path: '/other', element: <div>Other route</div> }], { initialEntries: ['/other', '/editor/browser_root'], initialIndex: 1 });
});
afterEach(() => { cleanup(); fixture.router.dispose(); doc.destroy(); setActiveProjectForSave(null); vi.restoreAllMocks(); });
it('returns to the project whose edit is still committing after Back while the router is unmounted', async () => {
  const held = holdAcceptance();
  render(<App />);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.queryByText(/sk-secret-project-source/)).toBeNull();
  expect(screen.getByRole('alert')).not.toHaveTextContent(/unsaved|keep this tab/i);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await act(async () => { await fixture.router.navigate(-1); });
  expect(fixture.router.state.location.pathname).toBe('/other');
  fixture.crash = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  await screen.findByText('Retained editor');
  expect(fixture.router.state.location.pathname).toBe('/editor/browser_root');
  await act(async () => { held.release(); await held.accepting; });
  const after = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
});
it('respects the history destination when nothing is committing', async () => {
  journal.projectId = null; setActiveProjectForSave(null);
  render(<App />);
  await act(async () => { await fixture.router.navigate(-1); });
  fixture.crash = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  await screen.findByText('Other route');
  expect(fixture.router.state.location.pathname).toBe('/other');
});
it('shows actionable storage recovery when a child reports an IndexedDB-open error', async () => {
  const { AppErrorBoundary } = await import('../AppErrorBoundary');
  function FailedStorage() { throw new DOMException('private database details', 'QuotaExceededError'); }
  render(<AppErrorBoundary><FailedStorage /></AppErrorBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent(/browser storage could not complete/i);
  expect(screen.getByRole('alert')).not.toHaveTextContent(/free.*device storage|clear.*site data|keep this tab/i);
  expect(screen.queryByText(/private database details/)).toBeNull();
});
it('runtime recovery offers no Reload and warns on unload only while an edit is committing', async () => {
  const { RecoveryActions } = await import('../AppErrorBoundary');
  const held = holdAcceptance();
  render(<RecoveryActions category="startup" detail="The preview is unavailable." />);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restart preview' })).toBeNull();
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () => { held.release(); await held.accepting; });
});
