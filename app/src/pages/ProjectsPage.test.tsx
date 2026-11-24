import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/snapshotLoader', () => ({
  loadSnapshot: vi.fn().mockResolvedValue({}),
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));
// Stub icon imports (jsdom does not render SVG meaningfully); Proxy covers
// every named icon export the page tree pulls in.
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  // `then` must stay undefined or the awaited factory result is treated as a
  // never-resolving thenable and the test run hangs.
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'then' ? undefined : Stub),
      has: () => true, // vitest validates exports with an `in` check
    }
  );
});

import { db } from '@/db';
import toast from 'react-hot-toast';
import ProjectsPage from './ProjectsPage';
import type { UpdateState } from '@/hooks/useDesktopUpdate';
import { _resetProjectUndoForTests } from '@/services/projectUndo';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

beforeEach(async () => {
  // Node's builtin webstorage shadows jsdom's localStorage and its methods
  // throw — stub a Map-backed one (AssetsPanel.render.test.tsx pattern).
  // Empty store → no last-project-id → the pre-warm effect is a no-op.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
  // jsdom lacks matchMedia (useTheme via ThemeToggle needs it)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  _resetProjectUndoForTests();
  await db.delete();
  await db.open();
  await db.projects.bulkAdd([
    {
      id: 'browser_old',
      name: 'Old Project',
      pagesTree: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'browser_new',
      name: 'Newer Project',
      pagesTree: [],
      createdAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    },
  ]);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>
  );
}

// Owner 2026-11-10: delete anything AND undo — the trash deletes at once; ⌘Z (Ctrl+Z off a Mac) brings it back.
function deleteProject(index: number) {
  fireEvent.click(screen.getAllByTitle('Delete Project')[index]);
}
const undoKey = (target: EventTarget = window) => act(async () => { fireEvent.keyDown(target, { key: 'z', ctrlKey: true }); });
const redoKey = () => act(async () => { fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true }); });

describe('delete at once, ⌘Z brings it back', () => {
  const file = { id: 'browser_old:src/pages/index.astro', projectId: 'browser_old', path: 'src/pages/index.astro',
    content: new TextEncoder().encode('<h1>Old</h1>'), isText: true };
  beforeEach(async () => { await db.projectFiles.add(file); });

  it('deletes without a question; ⌘Z restores the project and its files; ⇧⌘Z deletes it again', async () => {
    const native = vi.spyOn(window, 'confirm');
    renderPage();
    await screen.findByText('Old Project');
    deleteProject(1);
    await waitFor(() => expect(screen.queryByText('Old Project')).toBeNull());
    expect(await db.projects.get('browser_old')).toBeUndefined();
    expect(await db.projectFiles.where('projectId').equals('browser_old').count()).toBe(0);
    expect(toast.success).toHaveBeenCalledWith('Deleted “Old Project” — Ctrl+Z to undo');
    expect(native).not.toHaveBeenCalled(); expect(screen.queryByRole('group')).toBeNull();

    await undoKey();
    await screen.findByText('Old Project');
    expect((await db.projects.get('browser_old'))?.name).toBe('Old Project');
    expect(new TextDecoder().decode((await db.projectFiles.get(file.id))!.content)).toBe('<h1>Old</h1>');

    await redoKey();
    await waitFor(() => expect(screen.queryByText('Old Project')).toBeNull());
    expect(await db.projects.get('browser_old')).toBeUndefined();
  });

  it('⌘Z in a text field belongs to the field, never to a deleted project', async () => {
    renderPage();
    await screen.findByText('Old Project');
    deleteProject(1);
    await waitFor(() => expect(screen.queryByText('Old Project')).toBeNull());
    fireEvent.click(screen.getAllByTitle('Rename Project')[0]);
    await undoKey(screen.getByRole('textbox'));
    expect(screen.queryByText('Old Project')).toBeNull();
    expect(await db.projects.get('browser_old')).toBeUndefined();
  });

  it('a half-finished delete: ⌘Z restores the project whole and clears its notice', async () => {
    const creation = await import('@/services/projectImport/createFilesTruthProject');
    vi.spyOn(creation, 'deleteFilesTruthData').mockRejectedValueOnce(new Error('cleanup unavailable'));
    renderPage();
    await screen.findByText('Old Project');
    deleteProject(1);
    await screen.findByText(/deletion did not finish/i);
    await undoKey();
    await waitFor(() => expect(screen.queryByText(/deletion did not finish/i)).toBeNull());
    expect((await db.projects.get('browser_old'))?.name).toBe('Old Project');
    expect(await db.projectFiles.get(file.id)).toBeTruthy();
  });

  it('the deletions outlive leaving the page (the editor and back)', async () => {
    const first = renderPage();
    await screen.findByText('Old Project');
    deleteProject(1);
    await waitFor(() => expect(screen.queryByText('Old Project')).toBeNull());
    first.unmount();
    renderPage();
    await screen.findByText('Newer Project');
    expect(screen.queryByText('Old Project')).toBeNull(); expect(await db.projects.get('browser_old')).toBeUndefined();
    await undoKey();
    await screen.findByText('Old Project');
  });
});

describe('review probe: retained editor target fence', () => {
  it.each(['pending', 'partial'] as const)('does not rename a %s deletion target through the retained Field', async (phase) => {
    const creation = await import('@/services/projectImport/createFilesTruthProject');
    const cleanup = vi.spyOn(creation, 'deleteFilesTruthData');
    let finishCleanup!: () => void;
    if (phase === 'pending') cleanup.mockImplementationOnce(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
    else cleanup.mockRejectedValueOnce(new Error('cleanup unavailable'));
    renderPage();
    await screen.findByText('Old Project');
    const update = vi.spyOn(db.projects, 'update').mockRejectedValueOnce(new Error('write unavailable'));
    fireEvent.click(screen.getAllByTitle('Rename Project')[1]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Retained draft  ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText(/name.*not.*saved/i);
    await act(async () => { fireEvent.blur(screen.getByRole('textbox')); });
    deleteProject(1);
    await waitFor(() => expect(cleanup).toHaveBeenCalledWith('browser_old'));
    if (phase === 'partial') await screen.findByText(/deletion did not finish/i);
    expect(await db.projects.get('browser_old')).toBeUndefined();
    expect(screen.getByRole('textbox')).toHaveValue('  Retained draft  ');
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
    const calls = update.mock.calls.length;
    if (phase === 'pending') await act(async () => { finishCleanup(); });
    expect(calls).toBe(1);
  });
});

describe('ProjectsPage rename', () => {
  // Generous timeout: full page render + IndexedDB roundtrips + 15 typed keys
  // run slowly when the machine is under parallel-session load.
  it('renames a project, persists to IndexedDB, and re-sorts the grid', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Old Project');
    // Grid order before: Newer Project (updatedAt 02-01) first
    let names = screen.getAllByText(/^(Old|Newer|Renamed) Project$/).map((el) => el.textContent);
    expect(names).toEqual(['Newer Project', 'Old Project']);

    // Rename the OLD project
    const renameButtons = screen.getAllByTitle('Rename Project');
    await user.click(renameButtons[1]); // second card = Old Project
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Renamed Project{Enter}');

    // Persisted
    await waitFor(async () => {
      const dbProject = await db.projects.get('browser_old');
      expect(dbProject?.name).toBe('Renamed Project');
      expect(dbProject!.updatedAt.getTime()).toBeGreaterThan(
        new Date('2026-02-01T00:00:00Z').getTime()
      );
    });

    // Re-sorted: renamed card now first
    await waitFor(() => {
      names = screen.getAllByText(/^(Old|Newer|Renamed) Project$/).map((el) => el.textContent);
      expect(names).toEqual(['Renamed Project', 'Newer Project']);
    });
  });
});

it('keeps existing projects visible after create storage failure and provides actionable retry guidance', async () => {
  const creation = await import('@/services/projectImport/createFilesTruthProject');
  vi.spyOn(creation, 'createScaffoldProject').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  renderPage();
  await screen.findByText('Old Project');
  await userEvent.click(screen.getByRole('button', { name: /new project/i }));
  expect(await screen.findByText(/free.*storage.*without clearing.*site.s data/i)).toBeTruthy();
  expect(screen.getByText('Old Project')).toBeInTheDocument();
  expect(await db.projects.count()).toBe(2);

});


describe('Projects operation failures at the mounted database boundary', () => {
  it('a rejected project read is unavailable rather than empty, and Retry clears only that read issue', async () => {
    vi.spyOn(db.projects, 'orderBy').mockImplementationOnce(() => { throw new Error('<html> /Users/private token-secret'); });
    renderPage();
    await screen.findByText('Projects');
    expect(screen.queryByText('Create new project')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Users\/private|token-secret|<html>/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Old Project')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('failed asynchronous rename retains the exact draft for correction', async () => {
    renderPage();
    await screen.findByText('Old Project');
    vi.spyOn(db.projects, 'update').mockRejectedValueOnce(new Error('<html> /Users/private token-secret'));
    fireEvent.click(screen.getAllByTitle('Rename Project')[1]);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  Exact draft  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/name.*not.*saved/i);
    expect(screen.getByRole('textbox')).toHaveValue('  Exact draft  ');
    expect((await db.projects.get('browser_old'))?.name).toBe('Old Project');
    expect(document.body.textContent).not.toMatch(/Users\/private|token-secret|<html>/);
  });

  it('acknowledged rename remains visible when its follow-up project read fails', async () => {
    renderPage();
    await screen.findByText('Old Project');
    vi.spyOn(db.projects, 'orderBy').mockImplementationOnce(() => { throw new Error('private read failure'); });
    fireEvent.click(screen.getAllByTitle('Rename Project')[1]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved name' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('Saved name')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/name.*not.*saved/i)).toBeNull();
    expect((await db.projects.get('browser_old'))?.name).toBe('Saved name');
  });

  it('partial deletion keeps its target visible with honest local feedback', async () => {
    const creation = await import('@/services/projectImport/createFilesTruthProject');
    vi.spyOn(creation, 'deleteFilesTruthData').mockRejectedValueOnce(new Error('private cleanup failure'));
    renderPage();
    await screen.findByText('Old Project');
    deleteProject(1);
    await screen.findByText(/deletion did not finish/i);
    expect(screen.getByText('Old Project')).toBeTruthy();
    expect(screen.getByText(/some project data may have been removed/i)).toBeTruthy();
    expect(await db.projects.get('browser_old')).toBeUndefined();
    expect(await db.projects.get('browser_new')).toBeTruthy();
  });
  it('read recovery cannot clear an independent create failure', async () => {
    const creation = await import('@/services/projectImport/createFilesTruthProject');
    vi.spyOn(db.projects, 'orderBy').mockImplementationOnce(() => { throw new Error('read unavailable'); });
    vi.spyOn(creation, 'createScaffoldProject').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    renderPage();
    await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(screen.getByRole('button', { name: /New Project/i }));
    await screen.findByText('The project could not be created.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Old Project');
    expect(screen.getByText('The project could not be created.')).toBeTruthy();
  });

  it('unrelated successful rename and refresh cannot hide a partial deletion', async () => {
    const creation = await import('@/services/projectImport/createFilesTruthProject');
    vi.spyOn(creation, 'deleteFilesTruthData').mockRejectedValueOnce(new Error('cleanup unavailable'));
    renderPage();
    await screen.findByText('Old Project');
    deleteProject(1);
    await screen.findByText(/deletion did not finish/i);
    fireEvent.click(screen.getAllByTitle('Rename Project')[0]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Other saved name' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText('Other saved name');
    await waitFor(() => expect(screen.queryByText('Loading projects…')).toBeNull());
    expect(screen.getByText('Old Project')).toBeTruthy();
    expect(screen.getByText(/deletion did not finish/i)).toBeTruthy();
  });

  it('a failed Enter followed by blur does not submit the same rejected draft twice', async () => {
    renderPage();
    await screen.findByText('Old Project');
    const update = vi.spyOn(db.projects, 'update').mockRejectedValueOnce(new Error('write unavailable'));
    fireEvent.click(screen.getAllByTitle('Rename Project')[1]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Rejected draft' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText(/name.*not.*saved/i);
    await act(async () => { fireEvent.blur(screen.getByRole('textbox')); });
    expect(update).toHaveBeenCalledTimes(1);
    expect((await db.projects.get('browser_old'))?.name).toBe('Old Project');
  });

  it('a superseded read cannot replace a newer acknowledged project name', async () => {
    renderPage();
    await screen.findByText('Old Project');
    const staleRows = await db.projects.toArray();
    let finish!: (rows: typeof staleRows) => void;
    const pendingRead = new Promise<typeof staleRows>(resolve => { finish = resolve; });
    const collection = db.projects.toCollection();
    vi.spyOn(collection, 'toArray').mockReturnValueOnce(pendingRead as ReturnType<typeof collection.toArray>);
    vi.spyOn(db.projects, 'orderBy').mockReturnValueOnce(collection);
    fireEvent.click(screen.getAllByTitle('Rename Project')[1]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First acknowledged' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText('First acknowledged');
    fireEvent.click(screen.getAllByTitle('Rename Project')[0]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second acknowledged' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText('Second acknowledged');
    await waitFor(() => expect(screen.queryByText('Loading projects…')).toBeNull());
    await act(async () => { finish(staleRows); });
    expect(screen.getByText('First acknowledged')).toBeTruthy();
    expect(screen.getByText('Second acknowledged')).toBeTruthy();
    expect(screen.queryByText('Old Project')).toBeNull();
  });

  it('explicit Enter can resubmit the retained failed rename without changing its draft', async () => {
    renderPage();
    await screen.findByText('Old Project');
    vi.spyOn(db.projects, 'update').mockRejectedValueOnce(new Error('write unavailable'));
    fireEvent.click(screen.getAllByTitle('Rename Project')[1]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Retried name  ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText(/name.*not.*saved/i);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText('Retried name');
    await waitFor(() => expect(screen.queryByText('Loading projects…')).toBeNull());
    await act(async () => { expect((await db.projects.get('browser_old'))?.name).toBe('Retried name'); });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/name.*not.*saved/i)).toBeNull();
  });

});

// Update notifier, notify only (docs/plans/2026-11-10-update-notifier-design.md, ledger rows 6, 13, 15, 17-18, 22, 47, 59).
describe('ProjectsPage update notifier', () => {
  const page = 'https://github.com/Mayhopar/Starquix-releases/releases/tag/v0.3.3';
  function desktop(initial: UpdateState) {
    let push: (state: UpdateState) => void = () => {};
    const off = vi.fn();
    vi.stubGlobal('sqDesktop', { update: { state: async () => initial,
      onState: (callback: (state: UpdateState) => void) => { push = callback; return off; } } });
    return { push: (state: UpdateState) => act(() => { push(state); }), off };
  }
  const updateButton = () => screen.queryByRole('button', { name: /^Update to/ });

  it('no desktop (the editor in a plain browser): no button, the credit line as before', async () => {
    renderPage();
    await screen.findByText('Newer Project');
    expect(updateButton()).toBeNull();
    expect(screen.getByText(/^Starquix © 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'MIT' })).toHaveAttribute('href', 'https://github.com/Mayhopar/starquix/blob/main/LICENSE');
  });

  it('a newer release: "Update to" opens the release page main built, and stays after the click', async () => {
    desktop({ current: '0.3.2', latest: '0.3.3', page });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Update to 0.3.3' }));
    expect(open).toHaveBeenCalledWith(page, '_blank', 'noopener,noreferrer');
    expect(screen.getByRole('button', { name: 'Update to 0.3.3' })).toBeInTheDocument();
    expect(screen.getByText('Starquix 0.3.3 is available')).toBeInTheDocument(); // the banner, not a header button
  });

  it('the Discord button in the top bar opens the community invite', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Ask on Discord' }));
    expect(open).toHaveBeenCalledWith('https://discord.gg/Fpuwzbd48V', '_blank', 'noopener,noreferrer');
  });


  it('already latest: the version and no button; main\'s pushes then show, relabel and remove it live; leaving unsubscribes', async () => {
    const { push, off } = desktop({ current: '0.3.2', latest: null, page: null });
    const { unmount } = renderPage();
    expect(await screen.findByText(/^Starquix 0\.3\.2 © 2026/)).toBeInTheDocument();
    expect(updateButton()).toBeNull();
    push({ current: '0.3.2', latest: '0.3.3', page });
    expect(await screen.findByRole('button', { name: 'Update to 0.3.3' })).toBeInTheDocument();
    push({ current: '0.3.2', latest: '0.3.4', page: page.replace('0.3.3', '0.3.4') });
    expect(await screen.findByRole('button', { name: 'Update to 0.3.4' })).toBeInTheDocument();
    push({ current: '0.3.2', latest: null, page: null });
    await waitFor(() => expect(updateButton()).toBeNull());
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
