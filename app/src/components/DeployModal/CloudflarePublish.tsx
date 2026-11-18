/**
 * Publish → Cloudflare (desktop): the rows and footer under the destination list when Cloudflare is picked. One click builds
 * the project locally and uploads it as a Worker on the user's own Cloudflare account; "Get a domain" is our search + Buy
 * (CloudflareDomain, a sub-view). Every state and error is a ledger case in docs/plans/2026-10-16-cloudflare-one-click-design.md;
 * the layout is docs/plans/2026-10-20-publish-sheet-design.md (cases 15–28).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@/assets/icons';
import { Badge, Button, Field, Labeled, Menu, MenuItem } from '@/components/ui';
import { GitError, parseGitError, type CloudflareStatus, type DomainState, type GitClient, type GitErrorCode, type GitStatus } from '@/services/git/gitClient';
import { CloudflareDomain, dash } from './CloudflareDomain';
import { bare, Cancel, LoadingFooter, Notices, NoticeView, open, openIcon, Pane, Prop, stamp, Status, usePoll, useReportBusy, WATCH_MS,
  adoptSiteAddress, type Notice, type StateBadge } from './publishParts';

const SETTLING: DomainState[] = ['registering', 'setting-up', 'https']; // Cloudflare is still working: polled
const BUSY = 'Building and uploading… usually under a minute';

interface Props {
  client: GitClient; status: GitStatus; projectName: string;
  /** The Export guard (unpushed instance edits) — runs before anything signs in or builds (ledger 38). */
  check: () => Promise<void>;
  /** The destination list; Cloudflare's items go in its group, under the Cloudflare row. */
  list: (group: ReactNode) => ReactNode;
  /** Cloudflare is where the site lives (host = cloudflare). */
  current: boolean;
  /** What stays when Publish moves the site here ("GitHub Pages stays online."). */
  stays: string | null;
  /** Cloudflare's state badge for the list (reported once the status is read). */
  onBadge: (badge: StateBadge | null) => void;
  /** After a publish (it saves a version and sets the host): the parent re-reads the git status. */
  onChanged: () => void;
  /** The merge note's way to Versions (ledger 37). */
  onOpenVersions: () => void;
  onBusy?: (busy: boolean) => void;
}

export function CloudflarePublish({ client, status: s, projectName, check, list, current, stays, onBadge, onChanged, onOpenVersions, onBusy }: Props) {
  const [n, setN] = useState<CloudflareStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [waiting, setWaiting] = useState(false); // ledger 11: a publish waits on the account pick
  const [searching, setSearching] = useState(false); // Get a domain is open
  const [domainMenu, setDomainMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useReportBusy(!!busy, onBusy);
  const refresh = useCallback(async () => { const next = await client.cloudflareStatus(); setN(next); return next; }, [client]);
  useEffect(() => { refresh().catch(e => setError(parseGitError(e))); }, [refresh]); // a failed first read never publishes (ledger 48)

  const worker = n?.worker ?? null;
  const domain = n?.domain ?? null;
  const settling = (!!worker && !!worker.url && !worker.reachable) || (!!domain && SETTLING.includes(domain.state));
  const polling = settling && !busy && now - since < WATCH_MS; // ledger 20/61
  usePoll(polling, async () => { setNow(Date.now()); setN(await client.cloudflareStatus()); });
  const live = domain?.state === 'live';
  const reachable = live || !!worker?.reachable;
  const badge: StateBadge | null = !n ? null : worker && reachable ? { label: 'Live', variant: 'success' }
    : worker?.url ? { label: 'Going live', variant: 'info' } : !worker && n.offline ? { label: 'Offline', variant: 'default' } : null;
  useEffect(() => { if (n) onBadge(badge); }, [n, badge?.label]); // eslint-disable-line react-hooks/exhaustive-deps -- the label is the badge

  /** One op at a time; its error lands in the notice; the status is re-read either way. Resolves true when it worked. */
  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name); setError(null);
    let ok = false;
    try { await fn(); ok = true; } catch (e) {
      const g = parseGitError(e);
      if (g.code === 'choose-account') setWaiting(true); // the re-read shows the account select
      else if (g.code !== 'cancelled') setError(g); // ledger 2: closing the window is a choice
    } finally {
      await refresh().catch(e => setError(prev => prev ?? parseGitError(e))); // a failed re-read stays visible
      if (name === 'publish') onChanged();
      setBusy(null);
    }
    return ok;
  }
  const watch = () => { setSince(Date.now()); setNow(Date.now()); };
  const recheck = () => { watch(); void refresh().catch(e => setError(parseGitError(e))); };
  async function publishWith(st: CloudflareStatus) {
    if (!st.account) { setWaiting(true); throw new GitError('choose-account', 'Choose an account'); } // ledger 11: asked once, then it continues
    setWaiting(false);
    await adoptSiteAddress((await client.cloudflareAddress(projectName)).url); // before the build: the publish carries it
    await client.cloudflarePublish(projectName, st.worker ? stamp() : 'Publish site');
    watch();
  }
  /** Ledger 1/38: the guard, then the first click signs in and carries on. */
  function publish(st: CloudflareStatus | null = n) {
    void run('publish', async () => {
      await check();
      await publishWith(st?.connected ? st : (await client.cloudflareConnect(), await refresh()));
    });
  }
  /** Ledger 11: the pick, then a waiting publish continues as a publish (its status line + loading button — review 12). */
  const choose = async (id: string) => {
    if (await run('account', () => client.cloudflareAccount(id)) && waiting) publish(await refresh().catch(() => null));
  };
  // Ledger 28: every Retry only re-reads; Publish stays the one way to upload.
  const retry = { label: 'Retry', onClick: () => void run('retry', async () => {}) };
  const connect = { label: 'Connect Cloudflare', onClick: () => void run('connect', client.cloudflareConnect) };

  const NOTICE: Partial<Record<GitErrorCode, (e: GitError) => Notice>> = {
    offline: () => ({ title: "You're offline.", detail: 'Publishing needs a connection.', action: retry }),
    'cloudflare-signed-out': () => ({ title: 'Connect Cloudflare again.', action: connect }),
    'no-account': () => ({ title: 'Allow Starquix on a Cloudflare account.', detail: 'Pick an account when Cloudflare asks.', action: connect }),
    'rate-limited': () => ({ title: 'Cloudflare is busy.', detail: 'Try again in a minute.', action: retry }),
    cloudflare: () => ({ title: "Cloudflare didn't accept this.", detail: 'Try again in a minute.', action: retry,
      links: [{ href: 'https://dash.cloudflare.com/', label: 'Open Cloudflare' }] }),
    'build-failed': e => ({ title: "The site didn't build.", detail: e.message }), // the user's own diagnostic (ledger 21)
    'not-static': () => ({ title: 'This site needs a server.', detail: 'Publishing to Cloudflare supports static sites.' }),
    'file-too-big': e => ({ title: 'A file is too big for Cloudflare.', detail: `${e.extra.file ?? 'A file'} is over 25 MB. Make it smaller, then publish again.` }),
    'not-configured': () => ({ title: 'Cloudflare sign-in is not set up in this build.' }),
    'no-keychain': () => ({ title: 'No system keychain to keep the Cloudflare sign-in.' }),
    refused: e => ({ title: e.message, detail: e.extra.detail }), // the Export guard's curated copy (ledger 38)
  };
  const notice = error && (NOTICE[error.code]?.(error) ?? { title: "That didn't work.", detail: error.message });
  const primary = (label: string, disabled = false) => (
    <Button variant="primary" size="lg" label={label} loading={busy === 'publish'} disabled={!!busy || s.merging || disabled} onClick={() => publish()} />
  );

  if (searching && n?.account) return (
    <CloudflareDomain client={client} account={n.account} onBack={() => { setSearching(false); recheck(); }}
      onDone={() => { setSearching(false); recheck(); }} />
  );

  // Ledger 48: the first read failed — never a dead end: signed out → Connect, else Retry; the list stays usable.
  if (!n) {
    const read = error?.code === 'cloudflare' ? { title: "Cloudflare isn't answering.", detail: 'Try again in a minute.' } : notice;
    return (
      <Pane footer={<LoadingFooter primary={current ? 'Publish' : 'Publish to Cloudflare'} />}>
        {list(!read ? ( // the items to come in their loading state (owner 2026-10-22: the skeleton everywhere)
          <div role="status" aria-label="Loading Cloudflare" className="flex flex-col gap-4"><Prop label="Address" skeleton /><Prop label="Account" skeleton /></div>
        ) : <NoticeView notice={{ title: read.title, detail: read.detail, action: error?.code === 'cloudflare-signed-out' ? connect : retry }} />)}
      </Pane>
    );
  }

  const account = n.account;
  const address = live ? `https://${domain!.name}` : worker?.url ?? null;
  const unpublished = s.changed > 0 || !n.published; // ledger 35/36
  const DOMAIN: Record<DomainState, { badge: StateBadge; notice?: Notice }> = { // ledger 53–62
    registering: { badge: { label: 'Registering', variant: 'info' } },
    'confirm-email': { badge: { label: 'Confirm email', variant: 'warning' }, notice: { title: 'Confirm your email.',
      detail: `Cloudflare sent a link to ${domain?.sentTo ?? 'your address'}. Click it, then check again.`, action: { label: 'Check again', onClick: recheck } } },
    'setting-up': { badge: { label: 'Setting up', variant: 'info' } },
    https: { badge: { label: 'Setting up HTTPS', variant: 'info' } },
    live: { badge: { label: 'Live', variant: 'success' } },
    failed: { badge: { label: 'Failed', variant: 'error' }, notice: { title: "Cloudflare couldn't register it.", detail: 'Nothing was registered.',
      action: { label: 'Use another domain', onClick: () => void run('domain', async () => { await client.cloudflareDomain(null); setSearching(true); }) } } },
    conflict: { badge: { label: 'Points elsewhere', variant: 'warning' }, notice: { title: `${domain?.name ?? 'The domain'} already points somewhere else.`,
      detail: 'Remove its DNS records on Cloudflare, then check again.', action: { label: 'Check again', onClick: recheck },
      links: account && domain ? [{ href: dash(account.id, `${domain.name}/dns/records`), label: 'Open DNS' }] : undefined } },
    detached: { badge: { label: 'Not connected', variant: 'warning' }, notice: { title: 'The domain is not connected to this site anymore.',
      action: { label: 'Connect again', onClick: () => void run('domain', async () => { await client.cloudflareDomain(domain!.name); watch(); }) } } },
    unknown: { badge: { label: 'Unknown', variant: 'default' }, notice: { title: "Can't check the domain right now.", action: { label: 'Check again', onClick: recheck } } }, // review 6
  };
  const view = domain && DOMAIN[domain.state];
  const toggleDomainMenu = () => setDomainMenu(o => !o);
  const closeMenu = (fn: () => void) => () => { setDomainMenu(false); fn(); };

  // U1 (owner 2026-11-10): no question — "you just unpublish and publish"; Publish brings the site back.
  const footer = (<>
    <Status>{busy === 'publish' ? BUSY : current ? (worker ? (unpublished ? 'Unpublished changes' : 'Everything is published') : null) : stays}</Status>
    {current && worker && <Button variant="ghost" size="lg" label="Unpublish" loading={busy === 'unpublish'} disabled={!!busy}
      onClick={() => void run('unpublish', client.cloudflareUnpublish)} />}
    {settling && !polling && !busy && <Button variant="ghost" size="lg" label="Check again" onClick={recheck} />}
    <Cancel />
    {current && worker ? primary('Publish', !unpublished) : primary('Publish to Cloudflare')}
  </>);

  return (
    <Pane footer={footer}>
      {list(<>
        {worker && address && reachable ? <Prop label="Address" value={bare(address)} icons={openIcon(address, 'Open site')} testId="publish-state" />
          : worker?.url ? <Prop label="Address" value={bare(worker.url)} caption="Going live… about a minute" testId="publish-state" />
          : worker ? <Prop label="Address" value={worker.name} caption="On Cloudflare" testId="publish-state" />
          : n.offline ? <Prop label="Address" value={bare(n.offline)} caption="Offline" testId="publish-state" />
          : <Prop label="Address" placeholder="Free address on workers.dev" testId="publish-state" />}
        {worker && account && (!domain ? <Prop label="Domain" actions={<Button variant="outline" size="md" label="Get a domain" disabled={!!busy} onClick={() => setSearching(true)} />} />
          : <Prop label="Domain" value={domain.name} onOpen={busy ? undefined : toggleDomainMenu} icons={<>
            <Badge variant={view!.badge.variant}>{view!.badge.label}</Badge>
            <Button ref={menuRef} variant="ghost" size="sm" iconOnly aria-label="Domain options" title="Domain options" disabled={!!busy}
              icon={<ChevronDownIcon className="w-4 h-4" />} onClick={toggleDomainMenu} />
          </>} />)}
        {n.connected && !account && ( // ledger 11: several accounts — asked once (app-wide); a waiting publish continues
          <Labeled label="Account">
            <Field as="select" size="lg" value="" onChange={id => { if (id) void choose(id); }} aria-label="Cloudflare account" placeholder="Choose an account"
              options={n.accounts.map(a => ({ value: a.id, label: a.name }))} disabled={!!busy} showChevron />
          </Labeled>
        )}
        {account && ( // the account (case 5): logging out is here, where it matters
          <Prop label="Account" value={account.name} actions={<Button variant="outline" size="md" label="Log out" loading={busy === 'signOut'} disabled={!!busy}
            onClick={() => void run('signOut', client.cloudflareDisconnect)} />} />
        )}
        <Notices flush>
          {waiting && n.connected && !account && <NoticeView notice={{ title: 'Choose the Cloudflare account to publish to.' }} />}
          {view?.notice && <NoticeView notice={view.notice} />}
          {s.merging && <NoticeView notice={{ title: 'Finish the merge in Versions, then publish.', action: { label: 'Open Versions', onClick: onOpenVersions } }} />}
          {notice && <NoticeView notice={notice} />}
        </Notices>
      </>)}
      <Menu isOpen={domainMenu} onClose={() => setDomainMenu(false)} triggerRef={menuRef} placement="bottom-end">
        {live && account && <MenuItem label="Manage on Cloudflare" onSelect={closeMenu(() => open(dash(account.id, 'domains/registrations')))} />}
        {domain?.state !== 'registering' && ( // ledger 66 / review 5: never stuck on one domain (while money is in flight: wait)
          <MenuItem label="Use another domain" onSelect={closeMenu(() => void run('domain', async () => { await client.cloudflareDomain(null); setSearching(true); }))} />
        )}
        {domain?.state === 'registering' && <MenuItem label="Registering… usually under a minute" disabled />}
      </Menu>
    </Pane>
  );
}
