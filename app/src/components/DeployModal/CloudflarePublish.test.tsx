// Ledger case numbers: docs/plans/2026-10-16-cloudflare-one-click-design.md; "sheet N": docs/plans/2026-10-20-publish-sheet-design.md
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : Stub), has: () => true });
});
vi.mock('@/services/desktopDriver', () => ({ desktopDriver: {} }));
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitProjectFiles: vi.fn() }));
const seo = vi.hoisted(() => ({ ensureSiteAddress: vi.fn(async (_url: string) => {}) }));
vi.mock('@/store/seo/seoFiles', () => seo);

import { CloudflarePublish } from './CloudflarePublish';
import { GitError, type CloudflareStatus, type GitClient, type GitStatus } from '@/services/git/gitClient';

const ACCOUNT = { id: 'acc1', name: 'Mine' };
const WORKER = { name: 'my-site', url: 'https://my-site.oleg.workers.dev', reachable: true };
const S = (over: Partial<CloudflareStatus> = {}): CloudflareStatus => ({ connected: true, account: ACCOUNT, accounts: [], worker: null, published: false, domain: null, offline: null, ...over });
const LIVE = S({ worker: WORKER, published: true });
const domain = (state: NonNullable<CloudflareStatus['domain']>['state'], sentTo: string | null = null) => S({ worker: WORKER, published: true, domain: { name: 'bakery.com', state, sentTo } });
function status(over: Partial<GitStatus> = {}): GitStatus {
  return { initialized: true, branch: 'main', changed: 0, files: [], merging: false, conflicts: null,
    remote: null, github: null, ahead: 0, behind: 0, user: null, host: null, pagesStale: false, pagesWorkflow: null, ...over };
}
/** `states` answer cloudflareStatus in order; the last one repeats. */
function fakeClient(states: CloudflareStatus[], over: Record<string, unknown> = {}) {
  const log: string[] = [];
  const step = (name: string) => vi.fn(async (...args: unknown[]) => { log.push(args.length ? `${name}:${args.map(a => JSON.stringify(a)).join(',')}` : name); });
  const c = {
    log,
    cloudflareStatus: vi.fn(async () => (states.length > 1 ? states.shift()! : states[0])),
    cloudflareConnect: step('connect'), cloudflareAccount: step('account'), cloudflarePublish: step('publish'),
    cloudflareDomain: step('domain'), cloudflareDisconnect: step('disconnect'), cloudflareSearch: vi.fn(async () => []),
    cloudflareUnpublish: step('unpublish'),
    cloudflareAddress: vi.fn(async () => ({ url: WORKER.url })),
    ...over,
  };
  return c as unknown as GitClient & { log: string[] } & Record<string, ReturnType<typeof vi.fn>>;
}
const check = vi.fn(async () => {});
interface Extra { onChanged?: () => void; onOpenVersions?: () => void; onBadge?: (b: unknown) => void; stays?: string | null }
/** `s.host === 'cloudflare'` = Cloudflare is where the site lives (the parent passes `current`). */
function open(client: GitClient, s: GitStatus = status(), x: Extra = {}) {
  return render(<CloudflarePublish client={client} status={s} projectName="My Site" check={check} list={g => <div>the list{g}</div>} current={s.host === 'cloudflare'}
    stays={x.stays ?? null} onBadge={x.onBadge ?? (() => {})} onChanged={x.onChanged ?? (() => {})} onOpenVersions={x.onOpenVersions ?? (() => {})} />);
}
const enabled = async (name: string) => {
  const b = await screen.findByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  return b;
};
/** The Address item: its label + helper text, and the field's value or placeholder (Figma 2026-10-21: values live in fields). */
const address = () => { const el = screen.getByTestId('publish-state'); const f = el.querySelector('input'); return `${el.textContent} ${f?.value ?? ''} ${f?.placeholder ?? ''}`; };
const domainMenu = async () => fireEvent.click(await screen.findByRole('button', { name: 'Domain options' }));
let browser: ReturnType<typeof vi.spyOn>;
beforeEach(() => { browser = vi.spyOn(window, 'open').mockImplementation(() => null); });
afterEach(() => { vi.useRealTimers(); check.mockReset(); check.mockImplementation(async () => {}); browser.mockRestore(); });
const opened = () => browser.mock.calls.map(c => c[0]);

describe('CloudflarePublish (sheet 15–28)', () => {
  it('48. the first read pending → its items in their loading state (Address, Account: label bars over field boxes), no "Loading…" row', async () => {
    open(fakeClient([S()], { cloudflareStatus: vi.fn(() => new Promise(() => {})) }));
    const loading = await screen.findByRole('status', { name: 'Loading Cloudflare' });
    expect(loading.querySelectorAll('.animate-pulse.h-8')).toHaveLength(2); // two 32px field boxes
    expect(screen.getByText('Address')).toHaveClass('text-transparent');
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('15/1. never connected: ONE click → the guard, the sign-in window, then the publish; the list stays on top', async () => {
    const c = fakeClient([S({ connected: false, account: null }), S(), LIVE]);
    open(c);
    expect(await screen.findByText('the list')).toBeTruthy();
    expect(await screen.findByPlaceholderText('Free address on workers.dev')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    await waitFor(() => expect(c.log).toEqual(['connect', 'publish:"My Site","Publish site"']));
    expect(check).toHaveBeenCalledTimes(1);
    expect(await screen.findByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
  });

  it('16/2. closing the sign-in window is a choice: no notice, nothing published', async () => {
    const c = fakeClient([S({ connected: false, account: null })], { cloudflareConnect: vi.fn(async () => { throw new GitError('cancelled', 'Cancelled'); }) });
    open(c);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    await enabled('Publish to Cloudflare');
    expect(c.cloudflarePublish).not.toHaveBeenCalled();
    expect(screen.queryByText("That didn't work.")).toBeNull();
  });

  it('25/38. the Export guard refuses → its curated copy, nothing signed in or published', async () => {
    check.mockImplementation(async () => { throw new GitError('refused', 'Unpushed component instance edits would be missing.', { detail: 'Push or reset them.' }); });
    const c = fakeClient([S({ connected: false, account: null })]);
    open(c);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    expect(await screen.findByText('Unpushed component instance edits would be missing.')).toBeTruthy();
    expect(screen.getByText('Push or reset them.')).toBeTruthy();
    expect(c.log).toEqual([]);
  });

  it('18. publishing → the footer says so and the parent re-reads after; another host leaving says what stays', async () => {
    let release!: () => void;
    const onChanged = vi.fn();
    const c = fakeClient([S(), LIVE], { cloudflarePublish: vi.fn(() => new Promise<void>(r => { release = r; })) });
    open(c, status({ host: 'pages' }), { onChanged, stays: 'GitHub Pages stays online.' });
    expect(await screen.findByText('GitHub Pages stays online.')).toBeTruthy();
    fireEvent.click(await enabled('Publish to Cloudflare'));
    expect(await screen.findByText('Building and uploading… usually under a minute')).toBeTruthy();
    await act(async () => { release(); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('17/11. several accounts: the select asks once; the waiting publish then continues by itself', async () => {
    const two = [ACCOUNT, { id: 'acc2', name: 'Work' }];
    // Reads: open · after the sign-in · the run's closing re-read · the pick's closing re-read · the continued publish's read · after it.
    const c = fakeClient([S({ connected: false, account: null }), S({ account: null, accounts: two }), S({ account: null, accounts: two }),
      S({ account: two[1] }), S({ account: two[1] }), LIVE]);
    open(c);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    expect(await screen.findByText('Choose the Cloudflare account to publish to.')).toBeTruthy();
    expect(c.cloudflarePublish).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Cloudflare account'), { target: { value: 'acc2' } });
    await waitFor(() => expect(c.log).toEqual(['connect', 'account:"acc2"', 'publish:"My Site","Publish site"']));
  });

  it('17. a failed account pick keeps its notice (no publish behind it)', async () => {
    const two = [ACCOUNT, { id: 'acc2', name: 'Work' }];
    const c = fakeClient([S({ connected: false, account: null }), S({ account: null, accounts: two })],
      { cloudflareAccount: vi.fn(async () => { throw new GitError('offline', 'You are offline'); }) });
    open(c);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    fireEvent.change(await screen.findByLabelText('Cloudflare account'), { target: { value: 'acc2' } });
    expect(await screen.findByText("You're offline.")).toBeTruthy();
    expect(c.cloudflarePublish).not.toHaveBeenCalled();
  });

  it('19. live: the address (↗ opens it), the account, Everything is published, Publish disabled, Get a domain; the badge is Live', async () => {
    const onBadge = vi.fn();
    open(fakeClient([LIVE]), status({ host: 'cloudflare' }), { onBadge });
    expect(await screen.findByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
    expect(screen.getByDisplayValue('Mine')).toBeTruthy(); // the account, with Log out
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open site' }));
    expect(opened()).toEqual(['https://my-site.oleg.workers.dev']);
    expect(screen.getByText('Everything is published')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Get a domain' })).toBeTruthy();
    await waitFor(() => expect(onBadge).toHaveBeenLastCalledWith({ label: 'Live', variant: 'success' }));
  });

  it('5. the account is an item (no ⋯ menu — the owner\'s Figma): its name + Log out → disconnect, then the re-read drops it', async () => {
    const c = fakeClient([LIVE, S({ connected: false, account: null, worker: WORKER, published: true })]);
    open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByDisplayValue('Mine')).toBeTruthy();
    fireEvent.click(await enabled('Log out'));
    await waitFor(() => expect(c.log).toContain('disconnect'));
    await waitFor(() => expect(screen.queryByDisplayValue('Mine')).toBeNull());
  });

  it('35/36. changed files or a version after the last publish → unpublished; Publish publishes under "Update site"', async () => {
    const c = fakeClient([LIVE]);
    const view = open(c, status({ host: 'cloudflare', changed: 2 }));
    expect(await screen.findByText('Unpublished changes')).toBeTruthy();
    fireEvent.click(await enabled('Publish'));
    await waitFor(() => expect(c.log).toEqual([expect.stringMatching(/^publish:"My Site","Update site · /)]));
    view.unmount();
    open(fakeClient([{ ...LIVE, published: false }]), status({ host: 'cloudflare' }));
    expect(await screen.findByText('Unpublished changes')).toBeTruthy();
  });

  it('SEO D5: the address goes into astro.config BEFORE the build — asked of main, written, then published', async () => {
    seo.ensureSiteAddress.mockClear();
    const c = fakeClient([LIVE]);
    open(c, status({ host: 'cloudflare', changed: 2 }));
    fireEvent.click(await enabled('Publish'));
    await waitFor(() => expect(c.cloudflarePublish).toHaveBeenCalled());
    expect(c.cloudflareAddress).toHaveBeenCalledWith('My Site');
    expect(seo.ensureSiteAddress).toHaveBeenCalledWith(WORKER.url);
    expect(seo.ensureSiteAddress.mock.invocationCallOrder[0]).toBeLessThan(c.cloudflarePublish.mock.invocationCallOrder[0]);
  });

  it('20. a new address that does not answer yet → Going live; polls every 10 s and stops once it answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onBadge = vi.fn();
    const c = fakeClient([S({ worker: { ...WORKER, reachable: false }, published: true }), LIVE]);
    open(c, status({ host: 'cloudflare' }), { onBadge });
    expect(await screen.findByText('Going live… about a minute')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open site' })).toBeNull();
    await waitFor(() => expect(onBadge).toHaveBeenLastCalledWith({ label: 'Going live', variant: 'info' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open site' })).toBeTruthy());
    const calls = c.cloudflareStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(c.cloudflareStatus.mock.calls.length).toBe(calls);
  });

  it('20. never polls forever: after 10 minutes → Check again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = fakeClient([S({ worker: { ...WORKER, reachable: false }, published: true })]);
    open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByText('Going live… about a minute')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 10_000); });
    const calls = c.cloudflareStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(c.cloudflareStatus.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(c.cloudflareStatus.mock.calls.length).toBeGreaterThan(calls));
  });

  it('25. curated notices (signed out → Connect, build, server site, big file, busy + Retry re-reads only, refused, offline)', async () => {
    const c = fakeClient([LIVE], { cloudflarePublish: vi.fn()
      .mockRejectedValueOnce(new GitError('cloudflare-signed-out', 'x'))
      .mockRejectedValueOnce(new GitError('build-failed', 'Transform failed with 1 error: src/pages/index.astro:2:10: ERROR: Unexpected ";"'))
      .mockRejectedValueOnce(new GitError('not-static', 'This site needs a server'))
      .mockRejectedValueOnce(new GitError('file-too-big', '/video.mp4 is over 25 MB', { file: '/video.mp4' }))
      .mockRejectedValueOnce(new GitError('rate-limited', 'Cloudflare is busy'))
      .mockRejectedValueOnce(new GitError('cloudflare', 'Cloudflare answered 403', { status: 403 }))
      .mockRejectedValueOnce(new GitError('offline', 'You are offline')) });
    open(c, status({ host: 'cloudflare', changed: 1 }));
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText('Connect Cloudflare again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cloudflare' }));
    await waitFor(() => expect(c.log).toEqual(['connect']));
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText('Transform failed with 1 error: src/pages/index.astro:2:10: ERROR: Unexpected ";"')).toBeTruthy();
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText('This site needs a server.')).toBeTruthy();
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText('/video.mp4 is over 25 MB. Make it smaller, then publish again.')).toBeTruthy();
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText('Cloudflare is busy.')).toBeTruthy();
    const reads = c.cloudflareStatus.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(c.cloudflareStatus.mock.calls.length).toBeGreaterThan(reads));
    expect(c.cloudflarePublish).toHaveBeenCalledTimes(5); // Retry never publishes
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText("Cloudflare didn't accept this.")).toBeTruthy();
    expect(screen.queryByText(/answered/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Cloudflare' }));
    expect(opened()).toEqual(['https://dash.cloudflare.com/']);
    fireEvent.click(await enabled('Publish'));
    expect(await screen.findByText("You're offline.")).toBeTruthy();
  });

  it('27/48. a failing first read is never a dead end: 5xx → "Cloudflare isn\'t answering." + Retry; signed out → Connect', async () => {
    const c = fakeClient([LIVE], { cloudflareStatus: vi.fn().mockRejectedValueOnce(new GitError('cloudflare', 'Cloudflare answered 503', { status: 503 })).mockResolvedValue(LIVE) });
    const view = open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByText("Cloudflare isn't answering.")).toBeTruthy();
    expect(screen.getByText('the list')).toBeTruthy(); // other destinations stay pickable
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
    view.unmount();
    const out = fakeClient([LIVE], { cloudflareStatus: vi.fn().mockRejectedValueOnce(new GitError('cloudflare-signed-out', 'x')).mockResolvedValue(LIVE) });
    open(out, status({ host: 'cloudflare' }));
    expect(await screen.findByText('Connect Cloudflare again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cloudflare' }));
    expect(await screen.findByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
  });

  it('25/9/6/5. no account granted → Allow + Connect; not set up in this build / no keychain → their own copy', async () => {
    const c = fakeClient([S({ connected: false, account: null })], { cloudflareConnect: vi.fn()
      .mockRejectedValueOnce(new GitError('no-account', 'x')).mockRejectedValueOnce(new GitError('not-configured', 'x')).mockRejectedValueOnce(new GitError('no-keychain', 'x')) });
    open(c);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    expect(await screen.findByText('Allow Starquix on a Cloudflare account.')).toBeTruthy();
    fireEvent.click(await enabled('Publish to Cloudflare'));
    expect(await screen.findByText('Cloudflare sign-in is not set up in this build.')).toBeTruthy();
    fireEvent.click(await enabled('Publish to Cloudflare'));
    expect(await screen.findByText('No system keychain to keep the Cloudflare sign-in.')).toBeTruthy();
  });

  it('26/37. a merge in progress blocks Publish and says where to finish it', async () => {
    const onOpenVersions = vi.fn();
    open(fakeClient([LIVE]), status({ host: 'cloudflare', changed: 1, merging: true }), { onOpenVersions });
    expect(await screen.findByText('Finish the merge in Versions, then publish.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open Versions' }));
    expect(onOpenVersions).toHaveBeenCalled();
  });
});

describe('CloudflarePublish — the domain (sheet 21–23)', () => {
  it('23/49. Get a domain is a sub-view (the list leaves); Back returns and re-reads', async () => {
    const c = fakeClient([LIVE]);
    open(c, status({ host: 'cloudflare' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Get a domain' }));
    expect(await screen.findByLabelText('Domain name')).toBeTruthy();
    expect(screen.queryByText('the list')).toBeNull();
    const reads = c.cloudflareStatus.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Get a domain' })).toBeTruthy();
    await waitFor(() => expect(c.cloudflareStatus.mock.calls.length).toBeGreaterThan(reads));
  });

  it('21/54/55. registering → its badge; confirm-email → where the link went + Check again (no polling)', async () => {
    const view = open(fakeClient([domain('registering')]), status({ host: 'cloudflare' }));
    expect(await screen.findByText('Registering')).toBeTruthy();
    view.unmount();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = fakeClient([domain('confirm-email', 'a***@x.com')]);
    open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByText('Cloudflare sent a link to a***@x.com. Click it, then check again.')).toBeTruthy();
    const calls = c.cloudflareStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(c.cloudflareStatus.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(c.cloudflareStatus.mock.calls.length).toBeGreaterThan(calls));
  });

  it('21/58/61. setting up → HTTPS → live: workers.dev stays the address until HTTPS answers; then the domain; Manage in ⋯', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const c = fakeClient([domain('setting-up'), domain('https'), domain('live')]);
    open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByText('Setting up')).toBeTruthy();
    expect(address()).toContain('my-site.oleg.workers.dev');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(await screen.findByText('Setting up HTTPS')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(address()).toContain('bakery.com'));
    await domainMenu();
    fireEvent.click(await screen.findByText('Manage on Cloudflare'));
    expect(opened()).toEqual(['https://dash.cloudflare.com/acc1/domains/registrations']);
    expect(screen.queryByRole('button', { name: 'Get a domain' })).toBeNull();
  });

  it('21/56. failed → nothing registered; Use another domain forgets it and opens the search', async () => {
    const c = fakeClient([domain('failed'), LIVE]);
    open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByText("Cloudflare couldn't register it.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use another domain' }));
    await waitFor(() => expect(c.log).toEqual(['domain:null']));
    expect(await screen.findByLabelText('Domain name')).toBeTruthy();
  });

  it('21/59. conflict → remove its DNS records (Open DNS) + Check again', async () => {
    open(fakeClient([domain('conflict')]), status({ host: 'cloudflare' }));
    expect(await screen.findByText('bakery.com already points somewhere else.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open DNS' }));
    expect(opened()).toEqual(['https://dash.cloudflare.com/acc1/bakery.com/dns/records']);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('21/62. detached after it was live → Connect again (attach only, never a purchase)', async () => {
    const c = fakeClient([domain('detached'), domain('live')]);
    open(c, status({ host: 'cloudflare' }));
    expect(await screen.findByText('The domain is not connected to this site anymore.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect again' }));
    await waitFor(() => expect(c.log).toEqual(['domain:"bakery.com"']));
  });

  it('22/66. every domain state but registering offers Use another domain in ⋯', async () => {
    for (const state of ['setting-up', 'https', 'confirm-email', 'conflict', 'detached', 'live', 'unknown'] as const) {
      const view = open(fakeClient([domain(state)]), status({ host: 'cloudflare' }));
      await domainMenu();
      expect(await screen.findByText('Use another domain', { selector: '[role="menuitem"] *, [role="menuitem"]' })).toBeTruthy();
      view.unmount();
    }
    open(fakeClient([domain('registering')]), status({ host: 'cloudflare' }));
    await domainMenu();
    expect(screen.queryByText('Use another domain')).toBeNull(); // money in flight: wait for it
  });

  it('21. a domain Cloudflare could not be asked about → its notice + Check again; Publish stays usable', async () => {
    const c = fakeClient([domain('unknown')]);
    open(c, status({ host: 'cloudflare', changed: 1 }));
    expect(await screen.findByText("Can't check the domain right now.")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false);
    const reads = c.cloudflareStatus.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(c.cloudflareStatus.mock.calls.length).toBeGreaterThan(reads));
  });
});

describe('CloudflarePublish — Unpublish (U1–U5, sheet 24)', () => {
  // Owner 2026-11-10: "with unpublish you just unpublish and publish" — no question; Publish brings it back.
  it('U1. Unpublish acts at once — no question', async () => {
    const c = fakeClient([LIVE, S({ offline: 'https://my-site.oleg.workers.dev' })]);
    open(c, status({ host: 'cloudflare' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(c.log).toEqual(['unpublish']));
    expect(screen.queryByText(/Take the site offline\?/)).toBeNull();
  });

  it('U2/U3. confirmed → offline at the old address; Publish to Cloudflare brings it back; the badge says Offline', async () => {
    const onBadge = vi.fn();
    const c = fakeClient([LIVE, S({ offline: 'https://my-site.oleg.workers.dev' })]);
    open(c, status({ host: 'cloudflare' }), { onBadge });
    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(c.log).toEqual(['unpublish']));
    expect(await screen.findByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
    expect(address()).toContain('Offline');
    expect(screen.getByRole('button', { name: 'Publish to Cloudflare' })).toBeTruthy();
    await waitFor(() => expect(onBadge).toHaveBeenLastCalledWith({ label: 'Offline', variant: 'default' }));
  });

  it('U5. Cloudflare refuses the unpublish → a notice; still live', async () => {
    const c = fakeClient([LIVE], { cloudflareUnpublish: vi.fn(async () => { throw new GitError('cloudflare', 'Cloudflare answered 403', { status: 403 }); }) });
    open(c, status({ host: 'cloudflare' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
    expect(await screen.findByText("Cloudflare didn't accept this.")).toBeTruthy();
    expect(screen.getByDisplayValue('my-site.oleg.workers.dev')).toBeTruthy();
  });
});
