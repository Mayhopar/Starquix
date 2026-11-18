// The Versions window (docs/plans/2026-10-07-git-versions-design.md; layout: docs/plans/2026-10-20-publish-sheet-design.md "sheet N").
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : Stub), has: () => true });
});
vi.mock('@/services/desktopDriver', () => ({ desktopDriver: {} }));
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitProjectFiles: vi.fn() }));

import { VersionPanel, VersionsWindow } from './VersionPanel';
import { GitError, type GitClient, type GitStatus, type GitVersion, type RepoSummary } from '@/services/git/gitClient';

const USER = { login: 'oleg', name: 'Oleg', email: null, avatarUrl: '', id: 7 };
const V = (n: number): GitVersion => ({ oid: String(n).repeat(40).slice(0, 40), message: `v${n}`, at: Date.now() - n * 60_000, author: 'Oleg', parents: [] });
function status(over: Partial<GitStatus> = {}): GitStatus {
  return { initialized: true, branch: 'main', changed: 0, files: [], merging: false, conflicts: null,
    remote: null, github: null, ahead: 0, behind: 0, user: null, host: null, pagesStale: false, pagesWorkflow: null, ...over };
}
const REPOS: RepoSummary[] = [{ owner: 'oleg', repo: 'site', private: false, pushedAt: '2025-02-06T21:49:54Z' }];
function fakeClient(s: GitStatus, history: GitVersion[] = [V(2), V(1)], over: Partial<GitClient> = {}) {
  let current = s;
  const c = {
    status: vi.fn(async () => current), history: vi.fn(async () => history), branches: vi.fn(async () => ['main', 'redesign']),
    save: vi.fn(async () => 'oid'), restore: vi.fn(async () => 'oid'), createBranch: vi.fn(async () => {}),
    switchBranch: vi.fn(async () => {}), discard: vi.fn(async () => {}), refresh: vi.fn(async () => ({ ahead: 0, behind: 0 })),
    pull: vi.fn(async () => ({ conflicts: [] })), resolve: vi.fn(async () => {}), finish: vi.fn(async () => 'oid'),
    abort: vi.fn(async () => {}), push: vi.fn(async () => {}),
    publish: vi.fn(async () => ({ owner: 'oleg', repo: 'site', htmlUrl: '' })), disconnect: vi.fn(async () => {}),
    publishInto: vi.fn(async () => ({ owner: 'oleg', repo: 'site', htmlUrl: '', wrote: false })), setHost: vi.fn(async () => ({ wrote: false })),
    repos: vi.fn(async () => REPOS),
    inspectRepo: vi.fn(async () => ({ owner: 'oleg', repo: 'site', branch: 'main', private: false, large: false, empty: false, astro: true,
      changed: 1, added: 0, removed: [], removedCount: 0, dropped: {}, kept: [], host: null, pagesWorkflow: null })),
    signIn: vi.fn(async () => ({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })),
    signInWait: vi.fn(async () => USER), signInCancel: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
    ...over,
    set: (next: GitStatus) => { current = next; },
  };
  return c as unknown as GitClient & { set(s: GitStatus): void } & Record<keyof GitClient, ReturnType<typeof vi.fn>>;
}
const open = (client: GitClient, active = true) => render(<VersionPanel client={client} projectName="My Site" active={active} />);
const CONNECTED = { user: USER, remote: 'https://github.com/oleg/site.git', github: { owner: 'oleg', repo: 'site' } };
let browser: ReturnType<typeof vi.spyOn>;
beforeEach(() => { browser = vi.spyOn(window, 'open').mockImplementation(() => null); });
afterEach(() => { browser.mockRestore(); });
const options = async () => fireEvent.click(await screen.findByRole('button', { name: 'GitHub options' }));

describe('VersionPanel (the Versions window, sheet 65–77)', () => {
  it('65. the first read pending → the window\'s own rows in their loading state (branch + its select box, GitHub, history), no "Loading…" row', async () => {
    open(fakeClient(status(), [], { status: vi.fn(() => new Promise(() => {})) } as Partial<GitClient>));
    const loading = await screen.findByRole('status', { name: 'Loading versions' });
    expect(loading.querySelector('.animate-pulse.w-44.h-6')).not.toBeNull(); // the branch select's box
    expect(screen.getByText('History')).toHaveClass('text-transparent');
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('S3. its own window named Versions', async () => {
    render(<VersionsWindow isOpen onClose={() => {}} client={fakeClient(status())} projectName="My Site" />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
    expect(await screen.findByText('v2')).toBeTruthy();
  });

  it('68/75. not on GitHub: "Not backed up" + Back up; Save version (footer) + History still work', async () => {
    const client = fakeClient(status({ changed: 2 }));
    open(client);
    expect(await screen.findByText('Not backed up')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByTestId('changed-count').textContent).toBe('2 unsaved changes');
    fireEvent.change(screen.getByLabelText('Version message'), { target: { value: 'Hero copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(client.save).toHaveBeenCalledWith('Hero copy'));
  });

  it('68/ux 21. Back up → the repository rows (sub-view) → Back up to GitHub links it WITHOUT a host; Back leaves', async () => {
    const client = fakeClient(status({ user: USER }), [V(1)]);
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Back up' }));
    expect((screen.getByLabelText('Repository name') as HTMLInputElement).value).toBe('my-site');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Not backed up')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }));
    client.set(status({ ...CONNECTED }));
    fireEvent.click(screen.getByRole('button', { name: 'Back up to GitHub' }));
    await waitFor(() => expect(client.publish).toHaveBeenCalledWith('my-site', false, 'Back up to GitHub'));
    expect(client.setHost).not.toHaveBeenCalled();
    expect(await screen.findByText('· Up to date')).toBeTruthy(); // back on the list, linked
  });

  it('68. Back up into an existing repository (the list), and a taken name stays on the rows', async () => {
    const client = fakeClient(status({ user: USER }), [V(1)], { publish: vi.fn(async () => { throw new GitError('name-taken', 'taken'); }) });
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Back up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back up to GitHub' }));
    expect(await screen.findByText('my-site already exists')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use existing' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'oleg/site' }));
    const use = await screen.findByRole('button', { name: 'Use site' });
    await waitFor(() => expect(use).toBeEnabled());
    fireEvent.click(use);
    fireEvent.click(await screen.findByRole('button', { name: 'Back up into site' }));
    await waitFor(() => expect(client.publishInto).toHaveBeenCalledWith('oleg', 'site', 'Back up to GitHub'));
  });

  it('69. connected but signed out: the GitHub row signs in (the code + Open GitHub); denied → Try again', async () => {
    let fail!: (e: unknown) => void;
    const client = fakeClient(status({ ...CONNECTED, user: null }), [], { signInWait: vi.fn(() => new Promise((_r, rej) => { fail = rej; })) });
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }));
    expect((await screen.findByTestId('device-code')).textContent).toBe('ABCD-1234');
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
    expect(browser).toHaveBeenCalledWith('https://github.com/login/device', '_blank', 'noopener,noreferrer');
    fail(new GitError('denied', 'denied'));
    expect(await screen.findByText('GitHub sign-in was denied.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('70. connected: repo, counts, Pull/Push; ⋯ = Check GitHub · Open on GitHub · Open pull request (off main) · Disconnect', async () => {
    const client = fakeClient(status({ ...CONNECTED, branch: 'redesign', ahead: 1, behind: 2 }));
    open(client);
    expect(await screen.findByText('oleg/site')).toBeTruthy();
    expect(screen.getByText('· 1 to push · 2 to pull')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    await waitFor(() => expect(client.push).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(client.pull).toHaveBeenCalled());
    await options();
    fireEvent.click(await screen.findByText('Open pull request'));
    expect(browser.mock.calls[0][0]).toBe('https://github.com/oleg/site/compare/redesign?expand=1');
    await options();
    fireEvent.click(await screen.findByText('Check GitHub'));
    await waitFor(() => expect(client.refresh).toHaveBeenCalled());
  });

  // Owner 2026-11-10: outside ⌘Z, just do it — the repo stays on GitHub and can be connected again.
  it('77. Disconnect from ⋯ acts at once — no question', async () => {
    const client = fakeClient(status({ ...CONNECTED }));
    open(client);
    await options();
    fireEvent.click(await screen.findByText('Disconnect'));
    await waitFor(() => expect(client.disconnect).toHaveBeenCalled());
    expect(screen.queryByText(/Disconnect oleg\/site\?/)).toBeNull();
  });

  it('71. push rejected as behind → "GitHub has newer versions" + Pull', async () => {
    const client = fakeClient(status({ ...CONNECTED, ahead: 1 }), [V(1)], { push: vi.fn(async () => { throw new GitError('behind', 'Pull first'); }) });
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Push' }));
    expect(await screen.findByText('GitHub has newer versions.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Pull' }).at(-1)!);
    await waitFor(() => expect(client.pull).toHaveBeenCalled());
  });

  it('72. merging: per-file Mine/Theirs; Abort · Finish merge take the footer; save and push wait', async () => {
    const client = fakeClient(status({ ...CONNECTED, merging: true, conflicts: { 'src/pages/index.astro': 'mine' }, changed: 1, ahead: 1 }));
    open(client);
    const merge = await screen.findByRole('region', { name: 'Merge' });
    fireEvent.click(within(merge).getByRole('button', { name: 'Theirs' }));
    await waitFor(() => expect(client.resolve).toHaveBeenCalledWith('src/pages/index.astro', 'theirs'));
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Push' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Finish merge' }));
    await waitFor(() => expect(client.finish).toHaveBeenCalled());
  });

  it('66. a dirty branch switch asks in the footer (never a native confirm)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const client = fakeClient(status({ changed: 3 }));
    open(client);
    fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'redesign' } });
    expect(await screen.findByText('You have 3 unsaved changes. Save or discard them before switching to redesign.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    expect(client.switchBranch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard & switch' }));
    await waitFor(() => expect(client.switchBranch).toHaveBeenCalledWith('redesign'));
    expect(client.discard).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('67. "+" opens the New branch row; Create makes it', async () => {
    const client = fakeClient(status());
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'New branch' }));
    fireEvent.change(screen.getByLabelText('New branch name'), { target: { value: ' redesign ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(client.createBranch).toHaveBeenCalledWith('redesign'));
  });

  // Owner 2026-11-10: a restore is saved as a NEW version (nothing lost) — no question; restore the previous to go back.
  it('73/74. history: one line per version; Not pushed on local ones; Restore acts at once', async () => {
    const client = fakeClient(status({ ...CONNECTED, ahead: 1 }), [V(2), V(1)]);
    open(client);
    await screen.findByText('v2');
    expect(screen.getAllByText('Not pushed')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' })); // only older versions offer Restore
    await waitFor(() => expect(client.restore).toHaveBeenCalledWith(V(1).oid));
    expect(screen.queryByText(/It's saved as a new version/)).toBeNull();
    expect(await screen.findByRole('button', { name: 'Save version' })).toBeTruthy();
  });

  it('74. restore with unsaved changes waits: Restore is off and says why; the composer stays', async () => {
    const client = fakeClient(status({ changed: 2 }), [V(2), V(1)]);
    open(client);
    await screen.findByText('v2');
    const restore = screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    expect(restore.title).toBe('Save or discard your unsaved changes first');
    fireEvent.click(restore);
    expect(screen.getByRole('button', { name: 'Save version' })).toBeTruthy();
    expect(client.restore).not.toHaveBeenCalled();
  });

  it('73. no versions yet → the empty state', async () => {
    open(fakeClient(status(), []));
    expect(await screen.findByText('No versions yet')).toBeTruthy();
  });

  it('70/76. offline disables Pull/Push; repo-gone offers Disconnect', async () => {
    const client = fakeClient(status({ ...CONNECTED, ahead: 1 }), [V(1)], {
      push: vi.fn(async () => { throw new GitError('offline', 'You are offline'); }),
      pull: vi.fn(async () => { throw new GitError('repo-gone', 'gone'); }),
    });
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Pull' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(client.disconnect).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Push' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText('· Offline')).toBeTruthy();
  });

  it('65. a closed window reads nothing; it reads when it opens', async () => {
    const client = fakeClient(status());
    const view = open(client, false);
    await new Promise(r => setTimeout(r, 20));
    expect(client.status).not.toHaveBeenCalled();
    view.rerender(<VersionPanel client={client} projectName="My Site" active />);
    await waitFor(() => expect(client.status).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('v2')).toBeTruthy();
  });
});
