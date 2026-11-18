// Ledger numbers: "sheet N" = docs/plans/2026-10-20-publish-sheet-design.md; bare = docs/plans/2026-10-14-github-publish-design.md;
// "into N"/E… = docs/plans/2026-10-18-publish-into-existing-repo-design.md; "site N"/B…/R… =
// docs/plans/2026-10-20-publish-branch-selection-design.md; "prepublish N" = docs/plans/2026-10-20-prepublish-type-check-design.md.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : Stub), has: () => true });
});
vi.mock('@/services/desktopDriver', () => ({ desktopDriver: {} }));
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitProjectFiles: vi.fn() }));
const seo = vi.hoisted(() => ({ ensureSiteAddress: vi.fn(async (_url: string) => {}) }));
vi.mock('@/store/seo/seoFiles', () => seo);

import { PublishFlow } from './PublishFlow';
import { GitError, type DeployStatus, type GitClient, type GitStatus, type RepoPreview, type RepoSummary } from '@/services/git/gitClient';

const USER = { login: 'oleg', name: 'Oleg', email: null, avatarUrl: '', id: 7 };
const REPO = { remote: 'https://github.com/oleg/site.git', github: { owner: 'oleg', repo: 'site' } };
function status(over: Partial<GitStatus> = {}): GitStatus {
  return { initialized: true, branch: 'main', changed: 0, files: [], merging: false, conflicts: null,
    remote: null, github: null, ahead: 0, behind: 0, user: USER, host: null, pagesStale: false, pagesWorkflow: null, ...over };
}
const D = (over: Partial<DeployStatus> = {}): DeployStatus => ({ state: 'none', url: null, liveUrl: null, liveBranch: 'main', defaultBranch: 'main', siteBlocked: false, ...over });
const REPOS: RepoSummary[] = [{ owner: 'oleg', repo: 'site', private: false, pushedAt: '2025-02-06T21:49:54Z' },
  { owner: 'acme', repo: 'docs', private: true, pushedAt: '2025-01-01T12:00:00Z' }];
const PREVIEW = (over: Partial<RepoPreview> = {}): RepoPreview => ({ owner: 'oleg', repo: 'site', branch: 'main', private: false, large: false,
  empty: false, astro: true, changed: 11, added: 27, removed: ['src/components/FeaturedWorkList.astro', 'src/components/WorkList.astro'],
  removedCount: 2, dropped: { node_modules: 15554 }, kept: ['.astro/', '.gitignore', '.vscode/'], host: 'vercel', pagesWorkflow: null, ...over });
const CF = { connected: true, account: { id: 'acc1', name: 'Mine' }, accounts: [], worker: null, published: false, domain: null, offline: null };
const CF_LIVE = { ...CF, worker: { name: 'my-site', url: 'https://my-site.oleg.workers.dev', reachable: true }, published: true };
function fakeClient(s: GitStatus, over: Record<string, unknown> = {}, deploys: DeployStatus[] = [D()]) {
  const log: string[] = [];
  let current = s;
  const step = (name: string, result?: unknown) => vi.fn(async (...args: unknown[]) => { log.push(`${name}${args.length ? `:${args.join(',')}` : ''}`); return result; });
  const c = {
    log, set: (next: GitStatus) => { current = next; },
    status: vi.fn(async () => current),
    deployStatus: vi.fn(async () => (deploys.length > 1 ? deploys.shift()! : deploys[0])),
    publish: step('publish', { owner: 'oleg', repo: 'site', htmlUrl: '' }),
    setHost: step('setHost', { wrote: false }), publishChanges: step('publishChanges', { wrote: false }), makePublic: step('makePublic'),
    pull: vi.fn(async () => ({ conflicts: [] })), disconnect: step('disconnect'), signOut: step('signOut'), pagesBranch: step('pagesBranch', { wrote: false }),
    signIn: vi.fn(async () => ({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })),
    signInWait: vi.fn(async () => USER), signInCancel: vi.fn(async () => {}),
    cloudflareStatus: vi.fn(async () => CF),
    cloudflareConnect: step('cloudflareConnect'), cloudflarePublish: step('cloudflarePublish'), cloudflareAccount: step('cloudflareAccount'),
    cloudflareDomain: step('cloudflareDomain'), cloudflareDisconnect: step('cloudflareDisconnect'), cloudflareSearch: vi.fn(async () => []),
    repos: vi.fn(async () => REPOS), inspectRepo: vi.fn(async () => PREVIEW()),
    publishInto: step('publishInto', { owner: 'oleg', repo: 'site', htmlUrl: '', wrote: true }),
    typeCheck: vi.fn(async () => ({ ran: false, errors: [], total: 0 })),
    ...over,
  };
  return c as unknown as GitClient & { log: string[]; set(s: GitStatus): void } & Record<string, ReturnType<typeof vi.fn>>;
}
const check = vi.fn(async () => {});
const open = (client: GitClient, onOpenVersions: () => void = () => {}) =>
  render(<PublishFlow client={client} projectName="My Site" check={check} onOpenVersions={onOpenVersions} />);
const button = async (name: string) => screen.findByRole('button', { name }) as Promise<HTMLButtonElement>;
const click = async (name: string) => fireEvent.click(await button(name));
const enabled = async (name: string) => { const b = await button(name); await waitFor(() => expect(b.disabled).toBe(false)); return b; };
const pick = async (name: string) => fireEvent.click(await screen.findByRole('radio', { name }));
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const status$ = () => screen.getByTestId('unpublished').textContent;
/** An item's text: its label + helper, and its fields' values / placeholders (Figma 2026-10-21: values live in fields). */
const text = (el: HTMLElement) => [el.textContent, ...[...el.querySelectorAll('input')].flatMap(i => [i.value, i.placeholder])].join(' ');
const address = () => text(screen.getByTestId('publish-state'));
let browser: ReturnType<typeof vi.spyOn>;
beforeEach(() => { browser = vi.spyOn(window, 'open').mockImplementation(() => null); });
afterEach(() => { vi.useRealTimers(); browser.mockRestore(); });
const opened = () => browser.mock.calls.map(c => c[0]);
const menu = async () => fireEvent.click(await button('Repository options'));
/** The Site branch dropdown (owner 2026-10-21: "why site branch has no chevron?"): its items as [branch, on|off]. */
const siteItems = async () => {
  await click('Site branch options');
  return (await screen.findAllByRole('menuitem')).map(i => [i.title, i.getAttribute('aria-disabled') === 'true' ? 'off' : 'on']);
};
const showOnSite = async (branch: string) => {
  await click('Site branch options');
  fireEvent.click((await screen.findAllByRole('menuitem')).find(i => i.title === branch)!);
};

describe('PublishFlow — the destination list (sheet 10–14)', () => {
  it('3. the first read pending → the 4 options in the kit\'s loading state (Row skeleton), no pick, no status yet', async () => {
    open(fakeClient(status(), { status: vi.fn(() => new Promise(() => {})) }));
    const skeleton = await screen.findByRole('status', { name: 'Loading destinations' });
    expect(skeleton.querySelectorAll('.rounded-full.animate-pulse')).toHaveLength(4); // one radio shape per option row
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('GitHub Pages').parentElement).toHaveClass('text-transparent', 'animate-pulse'); // the bar = the name's width
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByTestId('unpublished')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('10. nothing published → Cloudflare · GitHub Pages · Netlify · Vercel, one line each; Cloudflare picked; no GitHub only, no token path', async () => {
    open(fakeClient(status({ user: null })));
    expect((await screen.findByRole('radio', { name: 'Cloudflare' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('radio').map(r => r.getAttribute('aria-label'))).toEqual(['Cloudflare', 'GitHub Pages', 'Netlify', 'Vercel']);
    expect(screen.queryByText('github.io')).toBeNull(); // Figma 2026-10-21: no meta on the rows — the Address field says it
    expect(await screen.findByPlaceholderText('Free address on workers.dev')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'GitHub only' })).toBeNull();
    expect(screen.queryByText(/Vercel token/)).toBeNull();
    expect(screen.queryByText(/Step \d of/)).toBeNull();
    expect(await button('Publish to Cloudflare')).toBeTruthy();
  });

  it('Figma 2026-10-21: the picked destination\'s items sit right under its row, 48px in; picking moves them', async () => {
    open(fakeClient(status({ user: null })));
    const items = await screen.findByRole('group', { name: 'Cloudflare settings' });
    const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(radio('Cloudflare'), items) && after(items, radio('GitHub Pages'))).toBe(true);
    expect(items).toHaveClass('pl-12', 'pr-6', 'gap-4');
    await pick('Netlify');
    const moved = await screen.findByRole('group', { name: 'Netlify settings' });
    expect(after(radio('Netlify'), moved) && after(moved, radio('Vercel'))).toBe(true);
    expect(screen.queryByRole('group', { name: 'Cloudflare settings' })).toBeNull();
    expect(within(moved).getByRole('button', { name: 'Log in' })).toBeTruthy(); // GitHub's account, among its items
  });

  it('signed out: Log in is the window\'s one live primary — the footer\'s Publish waits disabled (owner 2026-10-22)', async () => {
    open(fakeClient(status({ user: null })));
    await pick('GitHub Pages');
    const items = await screen.findByRole('group', { name: 'GitHub Pages settings' });
    expect(within(items).getByRole('button', { name: 'Log in' })).toHaveClass('bg-btn-primary-fill-default');
    expect(await button('Publish to GitHub Pages')).toBeDisabled();
  });

  it('10/14. a repo linked without a host (or the retired "GitHub only") → GitHub Pages is picked; the repo shows', async () => {
    open(fakeClient(status({ ...REPO, host: 'github' })));
    expect((await screen.findByRole('radio', { name: 'GitHub Pages' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByDisplayValue('oleg/site')).toBeTruthy();
    expect(await button('Publish to GitHub Pages')).toBeTruthy(); // nothing is current
  });

  it('11/12. picking another destination writes nothing: its rows, "Publish to <Host>", what stays; picking back = the live rows', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages' }), {}, [D({ state: 'success', liveUrl: 'https://oleg.github.io/site/' })]);
    open(c);
    expect(await screen.findByText('Live')).toBeTruthy();
    await pick('Netlify');
    expect(await button('Publish to Netlify')).toBeTruthy();
    expect(status$()).toBe('GitHub Pages stays online.');
    expect(address()).toContain('Free address on netlify.app');
    expect(screen.getByText('Live')).toBeTruthy(); // the current host keeps its badge
    await pick('GitHub Pages');
    expect(await button('Publish')).toBeTruthy();
    expect(address()).toContain('oleg.github.io/site');
    expect(c.log).toEqual([]);
  });

  it('13. the current host\'s badge: Building / Build failed / Waiting; none while off the live branch or signed out', async () => {
    const cases: [Partial<GitStatus>, DeployStatus, string | null][] = [
      [{ host: 'pages' }, D({ state: 'pending' }), 'Building'],
      [{ host: 'pages' }, D(), null], // GitHub has no build for this version: nothing is building — no badge (owner 2026-10-22)
      [{ host: 'pages' }, D({ state: 'failure', url: 'u' }), 'Build failed'],
      [{ host: 'netlify' }, D(), 'Waiting'],
      [{ host: 'vercel', branch: 'starquix' }, D({ state: 'success' }), null],
      [{ host: 'pages', user: null }, D({ state: 'success' }), null],
    ];
    const clients = new Map<unknown, ReturnType<typeof fakeClient>>();
    const c0 = (v: unknown) => clients.get(v)!;
    for (const [over, d, badge] of cases) {
      const client = fakeClient(status({ ...REPO, ...over }), {}, [d]);
      const view = open(client);
      clients.set(view, client);
      await screen.findByTestId('publish-state');
      if (badge) expect(await screen.findByText(badge)).toBeTruthy();
      else await waitFor(() => expect(c0(view).deployStatus).toHaveBeenCalled());
      for (const other of ['Building', 'Build failed', 'Waiting', 'Live'].filter(b => b !== badge)) expect(screen.queryByText(other)).toBeNull();
      view.unmount();
    }
  });

  it('SEO D5: GitHub Pages writes its address (the owner github.io origin) before the push', async () => {
    seo.ensureSiteAddress.mockClear();
    const c = fakeClient(status({ ...REPO, host: 'pages', changed: 1, user: USER }));
    open(c);
    await click('Publish');
    await waitFor(() => expect(c.publishChanges).toHaveBeenCalled());
    expect(seo.ensureSiteAddress).toHaveBeenCalledWith('https://oleg.github.io');
    expect(seo.ensureSiteAddress.mock.invocationCallOrder[0]).toBeLessThan(c.publishChanges.mock.invocationCallOrder[0]);
  });

  it('9. while an op runs the list waits', async () => {
    let release!: () => void;
    const c = fakeClient(status({ ...REPO, host: 'pages', changed: 1 }), { publishChanges: vi.fn(() => new Promise<void>(r => { release = r; })) });
    open(c);
    await click('Publish');
    await waitFor(() => expect(radio('Netlify').disabled).toBe(true));
    await act(async () => { release(); });
    await waitFor(() => expect(radio('Netlify').disabled).toBe(false));
  });
});

describe('PublishFlow — a GitHub destination without a repository (sheet 29–42)', () => {
  it('29/30/31. signed out → Sign in with GitHub in the rows; the code + Open GitHub; denied → Try again; Publish waits', async () => {
    const c = fakeClient(status({ user: null }), { signInWait: vi.fn(async () => { throw new GitError('denied', 'denied'); }) });
    open(c);
    await pick('GitHub Pages');
    expect((await button('Publish to GitHub Pages')).disabled).toBe(true);
    expect(screen.queryByLabelText('Repository name')).toBeNull();
    await click('Log in');
    expect(await screen.findByText('GitHub sign-in was denied.')).toBeTruthy();
    expect(await button('Try again')).toBeTruthy();
  });

  it('32/35. Pages: the name from the project, Public, the address it will get; Publish → publish (main saves) → setHost — no type check', async () => {
    const c = fakeClient(status({ changed: 2 }));
    open(c);
    await pick('GitHub Pages');
    expect((screen.getByLabelText('Repository name') as HTMLInputElement).value).toBe('my-site');
    expect(address()).toContain('oleg.github.io/my-site');
    expect(screen.getByRole('button', { name: 'Public' }).getAttribute('aria-pressed') ?? 'x').toBeTruthy();
    await click('Publish to GitHub Pages');
    await waitFor(() => expect(c.log).toEqual(['publish:my-site,false,Publish site', expect.stringMatching(/^setHost:pages,Update site · /)]));
    expect(c.typeCheck).not.toHaveBeenCalled();
  });

  it('34. Pages + Private → the paid-plan line; Private reaches publish', async () => {
    const c = fakeClient(status());
    open(c);
    await pick('GitHub Pages');
    await click('Private');
    expect(status$()).toBe('Private repositories need a paid GitHub plan for Pages.');
    await click('Publish to GitHub Pages');
    await waitFor(() => expect(c.log[0]).toBe('publish:my-site,true,Publish site'));
  });

  it('33. name taken → the field says so + a free name + "Use existing" opens the list with it picked; invalid → GitHub\'s sentence', async () => {
    const c = fakeClient(status(), { publish: vi.fn()
      .mockRejectedValueOnce(new GitError('name-taken', 'taken', { suggestion: 'my-site-2' }))
      .mockRejectedValueOnce(new GitError('invalid', 'Names can only contain letters.')) });
    open(c);
    await pick('Vercel');
    await click('Publish to Vercel');
    expect(await screen.findByText('my-site already exists')).toBeTruthy();
    await click('Use it');
    expect((screen.getByLabelText('Repository name') as HTMLInputElement).value).toBe('my-site-2');
    await click('Publish to Vercel');
    expect(await screen.findByText('Names can only contain letters.')).toBeTruthy();
    expect(c.setHost).not.toHaveBeenCalled();
    c.publish.mockRejectedValueOnce(new GitError('name-taken', 'taken'));
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'site' } });
    await click('Publish to Vercel');
    expect(await screen.findByText('site already exists')).toBeTruthy();
    await click('Use existing');
    await waitFor(() => expect(c.inspectRepo).toHaveBeenCalledWith('oleg', 'site'));
    expect(radio('oleg/site').checked).toBe(true);
  });

  it('37. Pages refused after the repo exists (private, free plan) → Make public & retry → public, Pages on', async () => {
    const c = fakeClient(status(), { setHost: vi.fn().mockRejectedValueOnce(new GitError('pages-unavailable', 'x', { settingsUrl: 'https://github.com/oleg/site/settings/pages' }))
      .mockResolvedValue({ wrote: true }) });
    open(c);
    await pick('GitHub Pages');
    await click('Publish to GitHub Pages');
    expect(await screen.findByText('GitHub Pages needs a public repository on the free plan.')).toBeTruthy();
    c.set(status({ ...REPO })); // the repo exists now
    await click('Open Pages settings');
    expect(opened()).toContain('https://github.com/oleg/site/settings/pages');
    await click('Make public & retry');
    await waitFor(() => expect(c.makePublic).toHaveBeenCalled());
    expect(c.setHost).toHaveBeenLastCalledWith('pages', expect.stringMatching(/^Update site · /));
  });

  it('37. a refused host keeps the pick: the repo now shows, Publish to GitHub Pages retries the host then publishes', async () => {
    const c = fakeClient(status(), { setHost: vi.fn().mockRejectedValueOnce(new GitError('pages-admin', 'Only an admin of oleg/site can turn on GitHub Pages.')).mockResolvedValue({ wrote: false }),
      publish: vi.fn(async () => { c.set(status({ ...REPO })); }) }); // main links the new repo
    open(c);
    await pick('GitHub Pages');
    await click('Publish to GitHub Pages');
    expect(await screen.findByText('Only an admin of oleg/site can turn on GitHub Pages.')).toBeTruthy();
    expect(await screen.findByDisplayValue('oleg/site')).toBeTruthy();
    fireEvent.click(await enabled('Publish to GitHub Pages'));
    await waitFor(() => expect(c.publishChanges).toHaveBeenCalled());
    expect(radio('GitHub Pages').checked).toBe(true);
  });
});

describe('PublishFlow — an existing repository (sheet 38–42)', () => {
  async function existing(c: GitClient, host = 'Vercel', onOpenVersions?: () => void) {
    open(c, onOpenVersions);
    await pick(host);
    await click('Use existing');
  }
  const use = async (repo = 'site') => fireEvent.click(await enabled(`Use ${repo}`));

  it('38. the repository list loading → its own rows in their loading state (radio shape, name, pushed date), no "Loading…" row', async () => {
    await existing(fakeClient(status(), { repos: vi.fn(() => new Promise(() => {})) }));
    const loading = await screen.findByRole('status', { name: 'Loading your repositories' });
    expect(loading.querySelectorAll('.rounded-full.animate-pulse')).toHaveLength(5); // a radio shape per row
    expect(screen.queryByText('Loading your repositories…')).toBeNull();
  });

  it('E1/E4/15/36. pick a repo → Use → the rows: counts, details, Publish to; Publish into → publishInto, then setHost', async () => {
    const c = fakeClient(status({ changed: 2 }));
    await existing(c);
    await pick('oleg/site');
    await use();
    expect(text(screen.getByTestId('into-preview'))).toContain('11 changed · 27 new · 2 removed');
    expect(screen.getByDisplayValue('node_modules/ (15,554 files)')).toBeTruthy();
    expect(screen.getByDisplayValue('.astro/, .gitignore, .vscode/')).toBeTruthy();
    expect(screen.queryByLabelText('Repository name')).toBeNull();
    expect(radio('main').checked).toBe(true);
    await click('Publish into site');
    await waitFor(() => expect(c.log).toEqual(['publishInto:oleg,site,Publish site', expect.stringMatching(/^setHost:vercel,Update site · /)]));
  });

  it('W5/40. another host already deploys the repo → the nudge; "Use Vercel instead" picks it', async () => {
    const c = fakeClient(status());
    await existing(c, 'GitHub Pages');
    await pick('oleg/site');
    await use();
    expect(await screen.findByText('Vercel already deploys site.')).toBeTruthy();
    expect(screen.getByText('GitHub Pages would be a second site.')).toBeTruthy();
    await click('Use Vercel instead');
    expect(radio('Vercel').checked).toBe(true);
    expect(screen.queryByText('Vercel already deploys site.')).toBeNull();
    await click('Publish into site');
    await waitFor(() => expect(c.setHost).toHaveBeenCalledWith('vercel', expect.stringMatching(/^Update site · /)));
  });

  it('38/6/8. the list loads, filters, offers a typed owner/name; Back keeps the sheet as it was', async () => {
    let release!: (r: RepoSummary[]) => void;
    const c = fakeClient(status(), { repos: vi.fn(() => new Promise<RepoSummary[]>(r => { release = r; })) });
    await existing(c);
    expect(await screen.findByRole('status', { name: 'Loading your repositories' })).toBeTruthy(); // its rows' loading state
    await act(async () => { release(REPOS); });
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByText('Pushed Jan 1, 2025')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a repository'), { target: { value: 'DOC' } });
    expect(screen.queryByRole('radio', { name: 'oleg/site' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Find a repository'), { target: { value: ' someone/else ' } });
    expect(screen.getByText('No repository matches.')).toBeTruthy();
    fireEvent.click(screen.getByText('Use someone/else'));
    await waitFor(() => expect(c.inspectRepo).toHaveBeenCalledWith('someone', 'else'));
    await click('Back');
    expect(await screen.findByLabelText('Repository name')).toBeTruthy();
  });

  it('38/7/10. none you can push to → says so; a failed list → notice + Retry', async () => {
    const view = render(<PublishFlow client={fakeClient(status(), { repos: vi.fn(async () => []) })} projectName="My Site" check={check} onOpenVersions={() => {}} />);
    await pick('Vercel');
    await click('Use existing');
    expect(await screen.findByText('No repositories you can publish into.')).toBeTruthy();
    view.unmount();
    const c = fakeClient(status(), { repos: vi.fn().mockRejectedValueOnce(new GitError('offline', 'You are offline')).mockResolvedValue(REPOS) });
    await existing(c);
    expect(await screen.findByText("You're offline.")).toBeTruthy();
    await click('Retry');
    expect(await screen.findByRole('radio', { name: 'oleg/site' })).toBeTruthy();
  });

  it('38/12/13. while checking, Use waits; the newest pick wins', async () => {
    const answers: Record<string, (p: RepoPreview) => void> = {};
    const c = fakeClient(status(), { inspectRepo: vi.fn((o: string, r: string) => new Promise<RepoPreview>(res => { answers[`${o}/${r}`] = res; })) });
    await existing(c);
    await pick('oleg/site');
    expect(screen.getByText('Checking oleg/site…')).toBeTruthy();
    expect((await button('Use repository')).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'acme/docs' }));
    await act(async () => { answers['oleg/site'](PREVIEW()); });
    expect((await button('Use repository')).disabled).toBe(true);
    await act(async () => { answers['acme/docs'](PREVIEW({ owner: 'acme', repo: 'docs', host: null })); });
    await use('docs');
    expect(await button('Publish into docs')).toBeTruthy();
  });

  it('39/41. empty / not Astro / large / private on Pages — each says so; publishing stays possible', async () => {
    const c = fakeClient(status(), { inspectRepo: vi.fn(async (_o: string, r: string) => (r === 'site'
      ? PREVIEW({ empty: true, changed: 0, removed: [], removedCount: 0, dropped: {}, kept: [], host: null })
      : PREVIEW({ owner: 'acme', repo: 'docs', astro: false, large: true, private: true, host: null, dropped: { dist: 1 } }))) });
    await existing(c, 'GitHub Pages');
    await pick('oleg/site');
    await use();
    expect(text(screen.getByTestId('into-preview'))).toContain('Empty: your site becomes its first version');
    await click('Change');
    fireEvent.click(await screen.findByRole('radio', { name: 'acme/docs' }));
    await use('docs');
    expect(await screen.findByText("docs isn't an Astro site.")).toBeTruthy();
    expect(screen.getByDisplayValue('dist/ (1 file)')).toBeTruthy();
    expect(status$()).toBe('Private repositories need a paid GitHub plan for Pages.');
    expect((await button('Publish into docs')).disabled).toBe(false);
    await pick('Vercel');
    expect(status$()).toBe('The first publish downloads docs; it can take a minute.');
  });

  it('38/31. a refused repo shows main\'s sentence and Use waits; another owner\'s repo → the org hint + Request access', async () => {
    const c = fakeClient(status(), { inspectRepo: vi.fn(async (o: string) => {
      throw o === 'oleg' ? new GitError('repo-unsupported', "site stores files with Git LFS. Starquix can't publish into it yet.")
        : new GitError('no-access', "You can't push to acme/docs.");
    }) });
    await existing(c);
    await pick('oleg/site');
    expect(await screen.findByText("site stores files with Git LFS. Starquix can't publish into it yet.")).toBeTruthy();
    expect((await button('Use repository')).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'acme/docs' }));
    expect(await screen.findByText('If acme is an organization, ask an owner to approve Starquix, or request access.')).toBeTruthy();
    await click('Request access');
    expect(opened()).toContain('https://github.com/settings/applications');
  });

  it('42. moved → Try again; a protected branch → GitHub\'s reason + branch settings; no host is set', async () => {
    const c = fakeClient(status(), { publishInto: vi.fn().mockRejectedValueOnce(new GitError('moved', 'x'))
      .mockRejectedValueOnce(new GitError('push-refused', 'protected branch hook declined', { branch: 'main' })) });
    await existing(c);
    await pick('oleg/site');
    await use();
    await click('Publish into site');
    expect(await screen.findByText('site changed on GitHub while publishing.')).toBeTruthy();
    fireEvent.click(await enabled('Try again'));
    expect(await screen.findByText('GitHub refused the update to main.')).toBeTruthy();
    await click('Open branch settings');
    expect(opened()).toContain('https://github.com/oleg/site/settings/branches');
    expect(c.publishInto).toHaveBeenCalledTimes(2);
    expect(c.setHost).not.toHaveBeenCalled();
  });

  it('42/27. a local branch named like GitHub\'s default → Open Versions', async () => {
    const onOpenVersions = vi.fn();
    const c = fakeClient(status(), { publishInto: vi.fn(async () => { throw new GitError('branch-taken', 'main is another branch in this project', { branch: 'main' }); }) });
    await existing(c, 'Vercel', onOpenVersions);
    await pick('oleg/site');
    await use();
    await click('Publish into site');
    expect(await screen.findByText('Switch to main in Versions, then publish.')).toBeTruthy();
    await click('Open Versions');
    expect(onOpenVersions).toHaveBeenCalled();
  });

  it('39/E6. "A new branch" + a name → "Publish to <name>" → publishInto(…, name); Pages without its own workflow can\'t', async () => {
    const c = fakeClient(status(), { inspectRepo: vi.fn(async (o: string) => PREVIEW(o === 'oleg' ? {} : { owner: 'acme', repo: 'docs', pagesWorkflow: 'deploy.yml', host: 'pages' })) });
    await existing(c);
    await pick('oleg/site');
    await use();
    expect(screen.getByText('Goes live right away')).toBeTruthy();
    await pick('A new branch');
    expect(document.activeElement).toBe(screen.getByLabelText('Branch name'));
    expect((await button('Publish to a new branch')).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: ' starquix ' } });
    await pick('GitHub Pages'); // E6/56: Pages publishes the live branch only
    expect(screen.getByText('GitHub Pages only publishes main')).toBeTruthy();
    expect(radio('A new branch').disabled).toBe(true);
    expect(await button('Publish into site')).toBeTruthy();
    await pick('Netlify');
    await click('Publish to starquix');
    await waitFor(() => expect(c.log[0]).toBe('publishInto:oleg,site,Publish site,starquix'));
  });

  it('37. the repo\'s own Pages workflow: the Workflow row names it', async () => {
    const c = fakeClient(status(), { inspectRepo: vi.fn(async () => PREVIEW({ host: 'pages', pagesWorkflow: 'sync-and-deploy.yml' })) });
    await existing(c, 'GitHub Pages');
    await pick('oleg/site');
    await use();
    expect(screen.getByDisplayValue('sync-and-deploy.yml')).toBeTruthy();
  });
});

describe('PublishFlow — the current GitHub destination (sheet 43–64)', () => {
  it('43. signed out on a published repo → the sign-in row + the repo; Publish waits', async () => {
    open(fakeClient(status({ user: null, ...REPO, host: 'pages', changed: 1 })));
    expect(await button('Log in')).toBeTruthy();
    expect(screen.getByDisplayValue('oleg/site')).toBeTruthy();
    expect(address()).toContain('oleg.github.io/site'); // the owner's Figma: the github.io address + its link, signed out too
    expect((await button('Publish')).disabled).toBe(true);
  });

  it('44/51. live on Pages: the address (↗ opens it), Live, "Everything is published", Publish disabled', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages' }), {}, [D({ state: 'success', url: 'https://github.com/oleg/site/actions/runs/1', liveUrl: 'https://oleg.github.io/site/' })]));
    expect(await screen.findByDisplayValue('oleg.github.io/site')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    await click('Open site');
    expect(opened()).toEqual(['https://oleg.github.io/site/']);
    expect(status$()).toBe('Everything is published');
    expect((await button('Publish')).disabled).toBe(true);
  });

  it('52. Publish → publishChanges with an "Update site" message (no host change); the build is watched', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages', changed: 3 }));
    open(c);
    expect(await screen.findByText('Unpublished changes')).toBeTruthy();
    await click('Publish');
    await waitFor(() => expect(c.log).toEqual([expect.stringMatching(/^publishChanges:Update site · /)]));
  });

  it('53. another GitHub destination on the linked repo → type check → setHost → publishChanges', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages' }));
    open(c);
    await pick('Netlify');
    await click('Publish to Netlify');
    await waitFor(() => expect(c.log).toEqual([expect.stringMatching(/^setHost:netlify,Update site · /), expect.stringMatching(/^publishChanges:Update site · /)]));
    expect(c.typeCheck).toHaveBeenCalled();
  });

  it('54/28. from Cloudflare, a GitHub destination says the Cloudflare site stays online', async () => {
    open(fakeClient(status({ ...REPO, host: 'cloudflare' }), { cloudflareStatus: vi.fn(async () => CF_LIVE) }));
    expect(await screen.findByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
    await pick('GitHub Pages');
    expect(status$()).toBe('Your Cloudflare site stays online.');
    expect(await button('Publish to GitHub Pages')).toBeTruthy();
  });

  it('61/62. GitHub is ahead → Get latest; conflicts → Resolve in Versions; a merge blocks Publish', async () => {
    const onOpenVersions = vi.fn();
    const c = fakeClient(status({ ...REPO, host: 'netlify', ahead: 1 }), {
      publishChanges: vi.fn(async () => { throw new GitError('behind', 'Pull first'); }),
      pull: vi.fn(async () => ({ conflicts: ['src/pages/index.astro'] })) });
    open(c, onOpenVersions);
    await click('Publish');
    expect(await screen.findByText('GitHub has newer changes.')).toBeTruthy();
    await click('Get latest');
    expect(await screen.findByText('Some files changed both here and on GitHub.')).toBeTruthy();
    await click('Resolve in Versions');
    expect(onOpenVersions).toHaveBeenCalled();
    const view = open(fakeClient(status({ ...REPO, host: 'netlify', ahead: 1, merging: true })));
    await waitFor(() => expect(view.getAllByText('Some files changed both here and on GitHub.').length).toBeGreaterThan(0));
    expect((within(view.container).getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('60/63. repo gone → Publish again disconnects; signed out → Sign in again; offline → Retry re-reads', async () => {
    const c = fakeClient(status({ ...REPO, host: 'vercel', ahead: 1 }), { publishChanges: vi.fn()
      .mockRejectedValueOnce(new GitError('repo-gone', 'gone')).mockRejectedValueOnce(new GitError('signed-out', 'x')).mockRejectedValueOnce(new GitError('offline', 'x')) });
    open(c);
    await click('Publish');
    await click('Publish again');
    await waitFor(() => expect(c.disconnect).toHaveBeenCalled());
    fireEvent.click(await enabled('Publish'));
    await click('Sign in again');
    await waitFor(() => expect(c.signOut).toHaveBeenCalled());
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText("You're offline.")).toBeTruthy();
    const reads = c.status.mock.calls.length;
    await click('Retry');
    await waitFor(() => expect(c.status.mock.calls.length).toBeGreaterThan(reads));
  });

  it('45. Netlify, nothing deployed yet → Waiting + "Connect" opens their import page (the steps in the tooltip)', async () => {
    open(fakeClient(status({ ...REPO, host: 'netlify' })));
    expect(await screen.findByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Not connected yet')).toBeTruthy();
    expect(screen.getByTitle('On Netlify, choose GitHub, then pick oleg/site. Build settings are detected.')).toBeTruthy();
    await click('Connect');
    expect(opened()).toEqual(['https://app.netlify.com/start']);
  });

  it('49. success without a site address → "On Vercel" + View deploy', async () => {
    open(fakeClient(status({ ...REPO, host: 'vercel' }), {}, [D({ state: 'success', url: 'https://vercel.com/oleg/site/x', liveUrl: null })]));
    expect(await screen.findByPlaceholderText('On Vercel')).toBeTruthy();
    await click('View deploy');
    expect(opened()).toEqual(['https://vercel.com/oleg/site/x']);
  });

  it('47. a failed build → the notice + Build log; Pages keeps the last good version online', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages' }), {}, [D({ state: 'failure', url: 'https://github.com/oleg/site/actions/runs/9', liveUrl: 'https://oleg.github.io/site/' })]));
    expect(await screen.findByText('The last build failed.')).toBeTruthy();
    expect(screen.getByText('GitHub Pages keeps the last good version online.')).toBeTruthy();
    await click('Build log');
    expect(opened()).toEqual(['https://github.com/oleg/site/actions/runs/9']);
  });

  it('owner 2026-10-22: logging in on GitHub Pages deploys nothing — nothing saved or pushed, no "Building"; Publish waits for an edit', async () => {
    let c!: ReturnType<typeof fakeClient>;
    c = fakeClient(status({ ...REPO, host: 'pages', user: null }), {
      signInWait: vi.fn(async () => { c.set(status({ ...REPO, host: 'pages' })); return USER; }) });
    open(c);
    await click('Log in');
    expect(await button('Log out')).toBeTruthy();
    await waitFor(() => expect(c.deployStatus).toHaveBeenCalled());
    expect(c.log).toEqual([]); // no setHost · publishChanges · publish
    expect(screen.queryByText('Building')).toBeNull(); // GitHub reports no build for this version (state none)
    expect(await screen.findByText('Everything is published')).toBeTruthy();
    expect(await button('Publish')).toBeDisabled();
  });

  it('48. polls every 10 s while building and stops once the host settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = fakeClient(status({ ...REPO, host: 'pages' }), {}, [D({ state: 'pending', liveUrl: 'https://oleg.github.io/site/' }), D({ state: 'success', liveUrl: 'https://oleg.github.io/site/' })]);
    open(c);
    expect(await screen.findByText('Building')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(screen.getByText('Live')).toBeTruthy());
    const calls = c.deployStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(c.deployStatus.mock.calls.length).toBe(calls);
  });

  it('48. never polls forever: after 10 minutes it stops and offers Check again; another destination picked stops it too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = fakeClient(status({ ...REPO, host: 'netlify' }));
    open(c);
    expect(await screen.findByText('Waiting')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 10_000); });
    const calls = c.deployStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(c.deployStatus.mock.calls.length).toBe(calls);
    await click('Check again');
    await waitFor(() => expect(c.deployStatus.mock.calls.length).toBeGreaterThan(calls));
    await pick('Vercel');
    const after = c.deployStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(c.deployStatus.mock.calls.length).toBe(after);
  });

  it('46. no build 2 minutes after a push → the hint + Open Actions', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(fakeClient(status({ ...REPO, host: 'pages', changed: 1 })));
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText('Building')).toBeTruthy(); // the push, before GitHub registers its run
    await act(async () => { await vi.advanceTimersByTimeAsync(130_000); });
    expect(await screen.findByText("GitHub hasn't started the build yet.")).toBeTruthy();
    await click('Open Actions');
    expect(opened()).toEqual(['https://github.com/oleg/site/actions']);
  });

  it('50. a stale Pages setup counts as unpublished', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages', pagesStale: true }), {}, [D({ liveUrl: 'https://oleg.github.io/site/' })]);
    open(c);
    expect(await screen.findByText('Unpublished changes')).toBeTruthy();
    await click('Publish');
    await waitFor(() => expect(c.publishChanges).toHaveBeenCalled());
  });

  it('44. Netlify off the live branch → the Branch row + Pull request (live...branch)', async () => {
    open(fakeClient(status({ ...REPO, host: 'vercel', branch: 'starquix' }), {}, [D({ liveBranch: 'main' })]));
    expect(await screen.findByText('Vercel builds main')).toBeTruthy();
    await click('Pull request');
    expect(opened()).toEqual(['https://github.com/oleg/site/compare/main...starquix?expand=1']);
  });
});

describe('PublishFlow — the Pages site branch (B4, site ledger)', () => {
  // Owner, 2026-10-20, trying the build on personal-site (on debugging = default = site): "can't select anything".
  it('site 1. the field always says which branch the site shows; with nothing to switch its menu has only that one, checked', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages' }), {}, [D({ state: 'success' })]));
    expect(await screen.findByText('Live')).toBeTruthy();
    const row = screen.getByTestId('site-branch');
    expect(text(row)).toContain('Site branch');
    expect(text(row)).toContain('main');
    expect(await siteItems()).toEqual([['main', 'off']]);
  });

  it('site 2. on another branch → the field shows main; ⌄ → redesign publishes it there (no badge for a build of another branch)', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages', branch: 'redesign' }), {}, [D({ liveBranch: 'main' })]);
    open(c);
    const row = await screen.findByTestId('site-branch');
    expect(text(row)).toContain('main');
    expect(screen.queryByText('Building')).toBeNull();
    await showOnSite('redesign');
    await waitFor(() => expect(c.log).toEqual([expect.stringMatching(/^pagesBranch:redesign,Update site · /)]));
  });

  it('site 3/4/5. the menu offers the default branch and the one you are on — never the one already shown (a third: shown, off)', async () => {
    const cases: [string, string, string[][]][] = [
      ['debugging', 'debugging', [['main', 'on'], ['debugging', 'off']]],
      ['main', 'debugging', [['main', 'on'], ['debugging', 'off']]],
      ['other', 'debugging', [['main', 'on'], ['other', 'on'], ['debugging', 'off']]]];
    for (const [branch, site, items] of cases) {
      const view = open(fakeClient(status({ ...REPO, host: 'pages', branch }), {}, [D({ liveBranch: site })]));
      await view.findByTestId('site-branch');
      expect(await siteItems()).toEqual(items);
      view.unmount();
    }
  });

  it('site 6. the repo\'s own Pages workflow → no row; off its branch → the Branch row', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages', branch: 'x', pagesWorkflow: 'deploy.yml' }), {}, [D({ liveBranch: 'main' })]));
    expect(await screen.findByText('GitHub Pages builds main')).toBeTruthy();
    expect(screen.queryByTestId('site-branch')).toBeNull();
  });

  it('site 8. a long branch name is shortened; the full name is the tooltip', async () => {
    const long = 'feature/very-long-branch-name-here';
    open(fakeClient(status({ ...REPO, host: 'pages', branch: long }), {}, [D({ liveBranch: 'main' })]));
    await click('Site branch options');
    const item = (await screen.findAllByRole('menuitem')).find(i => i.title === long)!;
    expect(item.textContent).toContain('feature/very-long-branc…');
  });

  it('the Repository field is a dropdown (the owner\'s Figma): a click on the field opens its menu', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages' }), {}, [D({ state: 'success' })]));
    fireEvent.click(await screen.findByDisplayValue('oleg/site'));
    expect(await screen.findByText('Use another repository')).toBeTruthy();
  });

  it('site 24/R12. a merge in progress disables the switch and the repository ⋯', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages', branch: 'redesign', merging: true }), {}, [D({ liveBranch: 'main' })]));
    expect((await button('Site branch options')).disabled).toBe(true);
    expect((await button('Repository options')).disabled).toBe(true);
  });

  it('site 15/16/22/27. refusals → main\'s sentence + where to fix it', async () => {
    const onOpenVersions = vi.fn();
    const c = fakeClient(status({ ...REPO, host: 'pages', branch: 'redesign' }), { pagesBranch: vi.fn()
      .mockRejectedValueOnce(new GitError('pages-protected', 'GitHub Pages deploys only protected branches here.', { settingsUrl: 'https://github.com/oleg/site/settings/environments' }))
      .mockRejectedValueOnce(new GitError('pages-not-started', "GitHub didn't start the build.", { settingsUrl: 'https://github.com/oleg/site/actions' }))
      .mockRejectedValueOnce(new GitError('pages-not-set-up', 'main has no Pages setup yet.')) }, [D({ liveBranch: 'main' })]);
    open(c, onOpenVersions);
    await showOnSite('redesign');
    expect(await screen.findByText('Protect the branch on GitHub, or allow it in the github-pages environment.')).toBeTruthy();
    await click('Open environment settings');
    await enabled('Site branch options');
    await showOnSite('redesign');
    expect(await screen.findByText('The site switches on its next build.')).toBeTruthy();
    await click('Run it in Actions');
    await enabled('Site branch options');
    await showOnSite('redesign');
    await click('Open Versions');
    expect(onOpenVersions).toHaveBeenCalled();
    expect(opened()).toEqual(['https://github.com/oleg/site/settings/environments', 'https://github.com/oleg/site/actions']);
  });

  it('site 48. GitHub refuses the site branch → the row says so even when you are on it; Show it here repairs it', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages', branch: 'debugging' }), {}, [D({ liveBranch: 'debugging', siteBlocked: true })]);
    open(c);
    expect(await screen.findByText("GitHub won't deploy it yet")).toBeTruthy();
    expect(await siteItems()).toEqual([['main', 'on'], ['debugging', 'on']]); // the shown one stays pickable while refused
    fireEvent.click((await screen.findAllByRole('menuitem')).find(i => i.title === 'debugging')!);
    await waitFor(() => expect(c.log[0]).toMatch(/^pagesBranch:debugging,/));
  });
});

describe('PublishFlow — another repository / Disconnect (R1–R11, sheet 56–59)', () => {
  it('56. ⋯ → Open on GitHub; Open pull request only off the default branch', async () => {
    open(fakeClient(status({ ...REPO, host: 'pages', branch: 'redesign' }), {}, [D({ liveBranch: 'main' })]));
    await menu();
    fireEvent.click(await screen.findByText('Open pull request'));
    await menu();
    fireEvent.click(await screen.findByText('Open on GitHub'));
    expect(opened()).toEqual(['https://github.com/oleg/site/compare/main...redesign?expand=1', 'https://github.com/oleg/site']);
  });

  it('57/R2/R3/R4. Use another repository → the rows switch in place (the old one stays); Cancel keeps it; Publish: disconnect → publish → the same host', async () => {
    const c = fakeClient(status({ ...REPO, host: 'netlify' }));
    open(c);
    await menu();
    fireEvent.click(await screen.findByText('Use another repository'));
    expect((screen.getByLabelText('Repository name') as HTMLInputElement).value).toBe('my-site');
    expect(status$()).toBe('oleg/site stays on GitHub as it is.');
    await click('Cancel');
    expect(screen.queryByLabelText('Repository name')).toBeNull();
    await menu();
    fireEvent.click(await screen.findByText('Use another repository'));
    await click('Use existing');
    expect(await screen.findByRole('radio', { name: 'acme/docs' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'oleg/site' })).toBeNull(); // R2: not the one in use
    await click('Back');
    await click('Publish to Netlify');
    await waitFor(() => expect(c.log).toEqual(['disconnect', 'publish:my-site,false,Publish site', expect.stringMatching(/^setHost:netlify,/)]));
  });

  it('58/R6. a publish failing after the disconnect keeps its notice; the rows show no repository', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages' }), { publish: vi.fn(async () => { c.set(status({ host: 'pages' })); throw new GitError('offline', 'x'); }) });
    open(c);
    await menu();
    fireEvent.click(await screen.findByText('Use another repository'));
    await click('Publish to GitHub Pages');
    expect(await screen.findByText("You're offline.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Repository options' })).toBeNull();
    expect(screen.getByLabelText('Repository name')).toBeTruthy();
  });

  // Owner 2026-11-10: outside ⌘Z, just do it — the repo stays on GitHub and can be connected again.
  it('59/R9. Disconnect acts at once — no question → the no-repository rows', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages' }), { disconnect: vi.fn(async () => { c.set(status({ host: 'pages' })); }) });
    open(c);
    await menu();
    fireEvent.click(await screen.findByText('Disconnect'));
    expect(screen.queryByText(/Disconnect oleg\/site\?/)).toBeNull();
    expect(await screen.findByLabelText('Repository name')).toBeTruthy();
    expect(radio('GitHub Pages').checked).toBe(true);
  });
});

const ERR = (file: string, line: number, message: string) => ({ file, line, column: 9, code: 'ts(2339)', message });
const FAILS = { ran: true, total: 2, errors: [ERR('src/components/BlogCard.astro', 22, "Property 'collection' does not exist on type 'X'."),
  ERR('src/layouts/Post.astro', 15, "Property 'backHref' does not exist on type 'Props'.")] };

describe('PublishFlow — the site\'s own type check (prepublish)', () => {
  it('1/19/22. errors stop Publish before anything is saved or pushed; a row per error; Publish anyway publishes', async () => {
    const c = fakeClient(status({ ...REPO, host: 'netlify', changed: 1 }), { typeCheck: vi.fn(async () => FAILS) });
    open(c);
    await click('Publish');
    expect(await screen.findByText("The site's build will fail.")).toBeTruthy();
    expect(screen.getByText('2 errors stop it. Fix them, then publish.')).toBeTruthy();
    expect(screen.getByText('BlogCard.astro:22')).toBeTruthy();
    expect(c.publishChanges).not.toHaveBeenCalled();
    await click('Publish anyway');
    await waitFor(() => expect(c.publishChanges).toHaveBeenCalled());
  });

  it('17/20/24. a check that couldn\'t run never blocks; more errors than sent → "N more"; while it checks, the footer says so', async () => {
    let release!: (v: unknown) => void;
    const c = fakeClient(status({ ...REPO, host: 'vercel', changed: 1 }), { typeCheck: vi.fn(() => new Promise(r => { release = r; })) });
    open(c);
    await click('Publish');
    expect(await screen.findByText('Checking the site…')).toBeTruthy();
    await act(async () => { release({ ...FAILS, total: 5 }); });
    expect(await screen.findByText('3 more')).toBeTruthy();
    c.typeCheck.mockRejectedValueOnce(new Error('no runtime'));
    await click('Publish');
    await waitFor(() => expect(c.publishChanges).toHaveBeenCalled());
  });

  it('3. GitHub Pages never checks', async () => {
    const c = fakeClient(status({ ...REPO, host: 'pages', changed: 1 }), { typeCheck: vi.fn(async () => FAILS) });
    open(c);
    await click('Publish');
    await waitFor(() => expect(c.publishChanges).toHaveBeenCalled());
    expect(c.typeCheck).not.toHaveBeenCalled();
  });
});
