import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectNavigationGuard } from '../ProjectNavigationGuard';
import { setActiveProjectForSave } from '@/services/pendingProjectMutations';
import { acceptProjectEdit, inspectAcceptedProject } from '@/services/durableEdits/acceptance';
import * as store from '@/services/durableEdits/store';
import { db } from '@/db';

let doc: Y.Doc;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_nav');
  setActiveProjectForSave('browser_nav');
});
afterEach(() => { cleanup(); doc.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveProjectForSave(null); });
function mount() {
  const router = createMemoryRouter([
    { path: '/editor/*', element: <><ProjectNavigationGuard projectId="browser_nav" /><div>Editor</div></> },
    { path: '/', element: <div>Projects</div> },
  ], { initialEntries: ['/editor/browser_nav'] });
  render(<RouterProvider router={router} />); return router;
}
it('leaves silently with accepted source work still materializing', async () => {
  await acceptProjectEdit(doc, { projectId: 'browser_nav', operationId: 'move', commands: [], mutate: staged => staged.getMap('order').set('value', ['b', 'a']) });
  const router = mount();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  await act(async () => { void router.navigate('/'); });
  expect(await screen.findByText('Projects')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(unload.defaultPrevented).toBe(false);
  const [edit] = await store.listUnmaterialized('browser_nav');
  const reopened = new Y.Doc(); Y.applyUpdate(reopened, edit.yjsUpdate!);
  expect(reopened.getMap('order').get('value')).toEqual(['b', 'a']); reopened.destroy();
});
it('joins only the overlapping local commit, without waiting for source or showing a message', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = store.acceptStoredEdit;
  vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => { await gate; return save(input); });
  const router = mount();
  const accepting = acceptProjectEdit(doc, { projectId: 'browser_nav', operationId: 'move', commands: [], mutate: staged => staged.getMap('order').set('value', ['b', 'a']) });
  await act(async () => { void router.navigate('/'); });
  expect(router.state.location.pathname).toBe('/editor/browser_nav');
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => { release(); await accepting; });
  expect(await screen.findByText('Projects')).toBeInTheDocument();
  expect((await db.durableEdits.toArray())[0].operationId).toBe('move');
});

// "Back to projects" during boot did nothing for ~8s+: the fresh-doc default
// variable seed regenerates variables CSS off the instance, so it (and every
// read-only inspection queued behind it) settles only after the preview boots.
it('never waits for a BACKGROUND edit (the boot seed) stuck on the preview', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); // the preview has not answered
  const router = mount();
  const seed = acceptProjectEdit(doc, { projectId: 'browser_nav', operationId: 'seed', commands: [], background: true,
    prepare: () => gate, mutate: staged => staged.getMap('seed').set('v', 1) });
  await act(async () => { void router.navigate('/'); });
  expect(await screen.findByText('Projects')).toBeInTheDocument();
  release(); await seed; // drain the module-level lane for the next test
});
it('never waits for a read-only inspection stuck on the preview', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const router = mount();
  const inspection = inspectAcceptedProject('browser_nav', () => gate);
  await act(async () => { void router.navigate('/'); });
  expect(await screen.findByText('Projects')).toBeInTheDocument();
  release(); await inspection;
});
it('still joins a USER edit queued behind a stuck background seed', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const router = mount();
  void acceptProjectEdit(doc, { projectId: 'browser_nav', operationId: 'seed', commands: [], background: true,
    prepare: () => gate, mutate: staged => staged.getMap('seed').set('v', 1) }).catch(() => {});
  const user = acceptProjectEdit(doc, { projectId: 'browser_nav', operationId: 'move', commands: [], mutate: staged => staged.getMap('order').set('value', ['b', 'a']) });
  await act(async () => { void router.navigate('/'); });
  expect(router.state.location.pathname).toBe('/editor/browser_nav');
  await act(async () => { release(); await user; });
  expect(await screen.findByText('Projects')).toBeInTheDocument();
});
