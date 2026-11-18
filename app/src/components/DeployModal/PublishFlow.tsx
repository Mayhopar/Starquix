/**
 * The Publish window's sheet (desktop, docs/plans/2026-10-20-publish-sheet-design.md, drawn as the owner's Figma —
 * docs/plans/2026-10-21-publish-figma-ledger.md): the destination list — always there, the current host picked (S1) — with
 * the picked destination's items right under its row, and one footer. Nothing is written until Publish.
 * Cloudflare's rows are CloudflarePublish; the GitHub destinations' rows are here, with RepoChooser for a repo to create or
 * pick. The ops and their errors are the ledger cases of docs/plans/2026-10-14-github-publish-design.md,
 * docs/plans/2026-10-18-publish-into-existing-repo-design.md, docs/plans/2026-10-20-publish-branch-selection-design.md
 * (the site branch; another repository / Disconnect) and docs/plans/2026-10-20-prepublish-type-check-design.md.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@/assets/icons';
import { Button, Menu, MenuItem } from '@/components/ui';
import { GitHubSignIn } from '@/components/VersionPanel/GitHubSignIn';
import { GitError, parseGitError, type DeployStatus, type GitClient, type GitStatus, type TypeCheck } from '@/services/git/gitClient';
import { CloudflarePublish } from './CloudflarePublish';
import { chooserLabel, chooserNote, chooserReady, chosenRef, linkChosen, RepoList, RepoRows, useChooser } from './RepoChooser';
import { bare, Block, Cancel, destination, DestinationList, LoadingFooter, isDestination, noAccess, Notices, NoticeView, open, openIcon,
  adoptSiteAddress, Pane, Prop, stamp, Status, TypeErrors, useAdoptSiteAddress, usePoll, WATCH_MS, type Destination, type Notice, type StateBadge } from './publishParts';

const SILENT_MS = 120_000; // case 22: Actions disabled / out of minutes
/** Site ledger 8: a long branch name is shortened where it labels a value or an action (the action's tooltip has it whole). */
const short = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name);
/** Site ledger 15/16: where a repo admin lets a branch deploy (GitHub's github-pages environment). */
const envLink = (e: GitError) => (e.extra.settingsUrl ? [{ href: e.extra.settingsUrl, label: 'Open environment settings' }] : undefined);
/** The address GitHub Pages gives a repo: <owner>.github.io/<repo>, or the root for the <owner>.github.io repo. */
const pagesAddress = (owner: string, repo: string) => {
  const root = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === root ? root : `${root}/${repo}`;
};

interface Props {
  client: GitClient; projectName: string;
  /** The Export guard Publish to Cloudflare runs first (main builds the folder on disk). */
  check: () => Promise<void>;
  /** Swaps this window for Versions (merges, branches — cases 27/33/34). */
  onOpenVersions: () => void;
  /** The window is open: it reads when it opens. */
  active?: boolean;
}

export function PublishFlow({ client, projectName, check, onOpenVersions, active = true }: Props) {
  const [s, setS] = useState<GitStatus | null>(null);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cfBusy, setCfBusy] = useState(false);
  const [error, setError] = useState<GitError | null>(null);
  const [typeErrors, setTypeErrors] = useState<TypeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [pick, setPick] = useState<Destination>('cloudflare');
  const [cfBadge, setCfBadge] = useState<StateBadge | null>(null); // reported by Cloudflare's rows, kept while another is picked
  const [switching, setSwitching] = useState(false); // R2: Use another repository — in place, the host kept
  const [repoMenu, setRepoMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [siteMenu, setSiteMenu] = useState(false);
  const siteRef = useRef<HTMLButtonElement>(null);
  const chooser = useChooser(projectName);
  const [since, setSince] = useState(() => Date.now()); // last push / open / Check again — case 40 (how long to poll)
  // Only a Publish from this window starts a build; opening it or signing in never does (owner 2026-10-22: "it must not deploy
  // automatically after login") — so "Building" and the no-build hint (case 22) count from the last push, not from the open.
  const [pushedAt, setPushedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef(true);

  const refresh = useCallback(async () => {
    const next = await client.status();
    // S1: the current host; none (or the retired "GitHub only") → Pages when a repo is linked, else Cloudflare.
    if (first.current) { first.current = false; setPick(isDestination(next.host) ? next.host : next.remote ? 'pages' : 'cloudflare'); }
    setS(next);
    if (next.remote && isDestination(next.host) && next.host !== 'cloudflare') setDeploy(await client.deployStatus().catch(() => null));
    return next;
  }, [client]);
  useEffect(() => { if (active) refresh().catch(e => setError(parseGitError(e))); }, [active, refresh]);

  const host = s?.host ?? null;
  const current = pick === host;
  const gh = s?.github ?? null;
  const linked = !!s?.remote;
  const live = current && linked; // the picked destination is where the site lives: its own rows (status, site branch)
  useAdoptSiteAddress(live && pick !== 'pages' ? deploy?.liveUrl : null); // Pages: before the push (publish)
  const state = deploy?.state ?? 'none';
  const settled = state === 'success' || state === 'failure';
  const offLive = !!deploy?.liveBranch && s?.branch !== deploy.liveBranch; // case 35
  const watching = state === 'pending' || now - since < WATCH_MS; // case 40
  const polling = active && live && pick !== 'cloudflare' && !settled && !offLive && watching && !switching;
  usePoll(polling, async () => { setNow(Date.now()); setDeploy(await client.deployStatus()); });

  /** One op at a time; its error lands in the notice; status is re-read either way (case 39); `done` runs after the
   *  re-read when the op went through (`false` = it stopped on purpose) — the view never flips before the status does. */
  async function run(name: string, fn: () => Promise<unknown>, done?: () => void) {
    setBusy(name); setError(null); setTypeErrors(null);
    let ok = false;
    try { ok = (await fn()) !== false; } catch (e) { setError(parseGitError(e)); }
    finally {
      await refresh().catch(() => {});
      if (ok) done?.();
      setBusy(null);
    }
  }
  /** docs/plans/2026-10-20-prepublish-type-check-design.md 1–7/17: Netlify/Vercel may run `astro check` — check first so a type
   *  error stops here, not in the host's build after the push. Pages never runs it; `anyway` skips it; a check that couldn't
   *  run never blocks. false = stopped on the errors. */
  async function typesPass(anyway: boolean) {
    if (anyway || pick === 'pages') return true;
    setChecking(true);
    let r: TypeCheck | null = null;
    try { r = await client.typeCheck(); } catch { /* couldn't check */ } finally { setChecking(false); }
    if (!r?.errors.length) return true;
    setTypeErrors(r);
    return false;
  }
  const watch = () => { setSince(Date.now()); setNow(Date.now()); };
  const pushed = () => { watch(); setPushedAt(Date.now()); };
  const justPushed = pushedAt !== null && now - pushedAt < WATCH_MS;
  const reset = () => { setSwitching(false); chooser.reset(); };
  const choosing = !linked || switching;
  /** Publish to the picked GitHub destination: a new or chosen repo first (R4: the old one is left only now), else the linked
   *  one; the host is set when it changes (53); main saves the pending edits and pushes (P3). */
  const publish = (anyway = false) => run('publish', async () => {
    if (!(await typesPass(anyway))) return false;
    // GitHub Pages knows its address before the push: the live one, else the owner's github.io (Astro's `site` is the origin).
    const owner = (choosing ? chosenRef(chooser.c, s?.user?.login ?? '') : gh)?.owner;
    if (pick === 'pages') await adoptSiteAddress((live ? deploy?.liveUrl : null) ?? (owner ? `https://${owner.toLowerCase()}.github.io` : null));
    if (choosing) {
      if (switching && s?.remote) await client.disconnect();
      if (!(await linkChosen(client, chooser, pick, 'Publish site'))) return false;
      pushed();
      await client.setHost(pick, stamp()); // a refused host (17, site 15/16) stays picked with its notice: Publish retries it
      return true;
    }
    if (!current) await client.setHost(pick, stamp());
    await client.publishChanges(stamp());
    pushed();
  }, reset);

  // Every error → its copy and the one action that recovers from it.
  const into = chooser.c.mode === 'existing' ? chooser.c.into : null;
  const NOTICE: Partial<Record<GitError['code'], (e: GitError) => Notice>> = {
    offline: () => ({ title: "You're offline.", detail: 'Publishing needs a connection.', action: { label: 'Retry', onClick: () => void run('retry', async () => {}) } }),
    'signed-out': () => ({ title: 'Sign in to GitHub again.', detail: 'Use an account that can push to this repository.',
      action: { label: 'Sign in again', onClick: () => void run('signOut', client.signOut) } }),
    'repo-gone': () => ({ title: 'The GitHub repository is gone or you lost access.', action: { label: 'Publish again', onClick: () => void run('disconnect', client.disconnect) } }),
    behind: () => ({ title: 'GitHub has newer changes.', detail: 'Get them first, then publish.', action: { label: 'Get latest', busy: busy === 'pull',
      onClick: () => void run('pull', async () => { if ((await client.pull()).conflicts.length) throw new GitError('merging', 'Conflicts'); }) } }),
    merging: () => ({ title: 'Some files changed both here and on GitHub.', detail: 'Pick which version to keep in Versions.',
      action: { label: 'Resolve in Versions', onClick: onOpenVersions } }),
    'pages-unavailable': e => ({ title: 'GitHub Pages needs a public repository on the free plan.', // case 17
      detail: 'Making the repository public also makes its code and history public.', // into 40: an existing repo has history
      action: { label: 'Make public & retry', busy: busy === 'public', onClick: () => void run('public', async () => {
        await client.makePublic(); await client.setHost('pages', stamp()); pushed();
      }, reset) },
      links: e.extra.settingsUrl ? [{ href: e.extra.settingsUrl, label: 'Open Pages settings' }] : undefined }),
    nothing: () => ({ title: 'Nothing to publish yet.' }),
    // The Pages site branch (docs/plans/2026-10-20-publish-branch-selection-design.md): main writes the sentences.
    'pages-admin': e => ({ title: e.message, links: envLink(e) }), // 15
    'pages-protected': e => ({ title: e.message, detail: 'Protect the branch on GitHub, or allow it in the github-pages environment.', links: envLink(e) }), // 16
    'pages-not-set-up': e => ({ title: e.message, detail: 'Switch to it in Versions, then publish.', action: { label: 'Open Versions', onClick: onOpenVersions } }), // 27
    'pages-not-started': e => ({ title: e.message, detail: 'The site switches on its next build.', // 22
      links: e.extra.settingsUrl ? [{ href: e.extra.settingsUrl, label: 'Run it in Actions' }] : undefined }),
    // Publish into (docs/plans/2026-10-18-publish-into-existing-repo-design.md): main writes these sentences.
    'repo-unsupported': e => ({ title: e.message }),
    'branch-exists': e => ({ title: e.message }), // 54
    'runtime-files': e => ({ title: e.message }), // 44: Get latest
    'no-access': e => noAccess(e, into?.owner ?? gh?.owner ?? '', s?.user?.login ?? ''), // 31
    'branch-taken': e => ({ title: `${e.message}.`, detail: `Switch to ${e.extra.branch ?? 'it'} in Versions, then publish.`, // 27
      action: { label: 'Open Versions', onClick: onOpenVersions } }),
    moved: () => ({ title: `${into?.repo ?? 'The repository'} changed on GitHub while publishing.`, // 29
      action: { label: 'Try again', busy: busy === 'publish', onClick: () => void publish() } }),
    'push-refused': e => { // 30
      const r = into ?? gh;
      return { title: `GitHub refused the update to ${e.extra.branch ?? 'the branch'}.`, detail: `GitHub said: ${e.message}`,
        links: r ? [{ href: `https://github.com/${r.owner}/${r.repo}/settings/branches`, label: 'Open branch settings' }] : undefined };
    },
  };
  const noticeFor = (e: GitError) => NOTICE[e.code]?.(e) ?? { title: "That didn't work.", detail: e.message };

  if (!s) {
    const n = error && noticeFor(error);
    return ( // owner 2026-10-21: the loading screen is the 4 options in their loading state, not a lone "Loading…" row
      <Pane footer={<LoadingFooter />}>{!n ? <DestinationList skeleton /> : <Block><NoticeView notice={{ ...n,
        action: { label: 'Retry', onClick: () => { setError(null); refresh().catch(e => setError(parseGitError(e))); } } }} /></Block>}
      </Pane>
    );
  }
  const login = s.user?.login ?? '';
  if (chooser.c.listing !== false) return ( // Choose a repository (sub-view)
    <RepoList client={client} login={login} initial={chooser.c.listing} exclude={switching ? gh : null} noticeFor={noticeFor}
      onBack={() => chooser.patch({ listing: false })}
      onUse={p => chooser.patch({ listing: false, mode: 'existing', into: p, toNew: false, branch: '' })} /> // into 52: on the live branch
  );

  const onGitHub = isDestination(host) && host !== 'cloudflare';
  const ghBadge: StateBadge | null = !onGitHub || !linked || !s.user || !deploy || offLive ? null
    : state === 'success' ? { label: 'Live', variant: 'success' }
    : state === 'failure' ? { label: 'Build failed', variant: 'error' }
    : state === 'pending' ? { label: 'Building', variant: 'info' }
    // GitHub reports no build for this version: Netlify/Vercel wait for their connection; Pages builds only after our push.
    : destination(host).connectUrl ? { label: 'Waiting', variant: 'warning' }
    : justPushed ? { label: 'Building', variant: 'info' } : null;
  const list = (group: ReactNode) => (
    <DestinationList pick={pick} current={isDestination(host) ? host : null} badge={host === 'cloudflare' ? cfBadge : ghBadge} disabled={!!busy || cfBusy}
      onPick={d => { setPick(d); setError(null); setTypeErrors(null); setSwitching(false); }}>{group}</DestinationList>
  );
  // What stays when Publish moves the site (cases 30/45, Cloudflare 46).
  const stays = current || !isDestination(host) ? null
    : host === 'cloudflare' ? 'Your Cloudflare site stays online.'
    : host === 'pages' ? 'GitHub Pages stays online.'
    : `${destination(host).title} keeps building the repository.`;

  if (pick === 'cloudflare') return (
    <CloudflarePublish client={client} status={s} projectName={projectName} check={check} list={list} current={host === 'cloudflare'} stays={stays}
      onBadge={setCfBadge} onChanged={() => void refresh().catch(() => {})} onOpenVersions={onOpenVersions} onBusy={setCfBusy} />
  );

  // GitHub Pages · Netlify · Vercel.
  const info = destination(pick);
  const signedIn = !!s.user;
  const main = deploy?.defaultBranch ?? null;
  const site = deploy?.liveBranch ?? null;
  const ours = pick === 'pages' && !s.pagesWorkflow;
  const ref = choosing ? (signedIn ? chosenRef(chooser.c, login) : null) : gh;
  const liveUrl = live ? deploy?.liveUrl ?? null : null;
  const predicted = pick === 'pages' && ref ? pagesAddress(ref.owner, ref.repo) : null; // GitHub Pages' address is known up front
  const address = liveUrl ? <Prop label="Address" value={bare(liveUrl)} icons={openIcon(liveUrl, 'Open site')} testId="publish-state" />
    : live && state === 'success' && deploy?.url && pick !== 'pages' // case 28: the host reports success, no address known
      ? <Prop label="Address" placeholder={`On ${info.title}`} icons={openIcon(deploy.url, 'View deploy')} testId="publish-state" />
    : live && predicted ? <Prop label="Address" value={predicted} icons={openIcon(`https://${predicted}`, 'Open site')} testId="publish-state" />
    : <Prop label="Address" testId="publish-state" placeholder={predicted ?? (live ? 'After the first build' : `Free address on ${info.free}`)} />;
  const workflow = pick === 'pages' ? (choosing ? into?.pagesWorkflow : s.pagesWorkflow) ?? null : null; // into 37: the repo's own
  const pr = gh && main && s.branch !== main ? `https://github.com/${gh.owner}/${gh.repo}/compare/${main}...${s.branch}?expand=1` : null; // E6/53
  // The site branch (B4, site ledger 1–8, 48): Starquix's own Pages workflow, always shown (owner 2026-10-20: "can't select
  // anything" when it hid) as a dropdown field (owner 2026-10-21: "why site branch has no chevron?"). Its menu lists the
  // default branch and the one you are on (only those can be published there), the shown one checked — re-pickable only while
  // GitHub refuses it. Pages never runs the site's own astro check (prepublish ledger 3), so the switch publishes without it.
  const blocked = !!deploy?.siteBlocked;
  const siteTo = busy?.startsWith('site:') ? busy.slice(5) : null;
  const toSite = (to: string) => { setSiteMenu(false); void run(`site:${to}`, async () => { await client.pagesBranch(to, stamp()); pushed(); }); };
  const toggleSiteMenu = () => setSiteMenu(o => !o);
  const siteRow = live && ours && site && main && (
    <Prop label="Site branch" value={short(site)} testId="site-branch" onOpen={busy || s.merging ? undefined : toggleSiteMenu}
      caption={siteTo ? `Switching to ${short(siteTo)}…` : blocked ? "GitHub won't deploy it yet" : null}
      icons={<Button ref={siteRef} variant="ghost" size="sm" iconOnly aria-label="Site branch options" title="Site branch options"
        disabled={!!busy || s.merging} icon={<ChevronDownIcon className="w-4 h-4" />} onClick={toggleSiteMenu} />} />
  );
  const shown = error ?? (s.merging ? new GitError('merging', 'Merge in progress') : null); // case 34
  const notice = shown && noticeFor(shown);
  const unpublished = s.changed > 0 || s.ahead > 0 || s.pagesStale; // case 48: a stale Pages setup is repaired by publishing
  const ready = signedIn && (!choosing || chooserReady(chooser.c, pick));
  const status = checking ? 'Checking the site…'
    : (choosing && chooserNote(chooser.c, pick))
    || (switching && gh ? `${gh.owner}/${gh.repo} stays on GitHub as it is.` : null) // R3
    || (live ? (unpublished ? 'Unpublished changes' : 'Everything is published') : stays);
  const close = (fn: () => void) => () => { setRepoMenu(false); fn(); };
  const toggleRepoMenu = () => setRepoMenu(o => !o);

  return (
    <Pane footer={(<>
      <Status>{status}</Status>
      {live && signedIn && !polling && !settled && !offLive && (
        <Button variant="ghost" size="lg" label="Check again" disabled={!!busy} onClick={() => { watch(); void refresh().catch(() => {}); }} />
      )}
      {typeErrors && <Button variant="ghost" size="lg" label="Publish anyway" disabled={!!busy} onClick={() => void publish(true)} />}
      {/* R2: while switching repositories, Cancel keeps the repo; otherwise it closes the window */}
      <Cancel disabled={switching && !!busy} onClick={switching ? () => { setSwitching(false); chooser.reset(); setError(null); } : undefined} />
      <Button variant="primary" size="lg" label={choosing ? chooserLabel(chooser.c, pick) : current ? 'Publish' : `Publish to ${info.title}`}
        loading={busy === 'publish'} disabled={!!busy || !ready || s.merging || (live && !switching && !unpublished)} onClick={() => void publish()} />
    </>)}>
      {list(<>
        {address}
        {linked && !switching && (
          <Prop label="Repository" value={gh ? `${gh.owner}/${gh.repo}` : s.remote} onOpen={busy || s.merging ? undefined : toggleRepoMenu}
            icons={<Button ref={menuRef} variant="ghost" size="sm" iconOnly aria-label="Repository options" title="Repository options"
              disabled={!!busy || s.merging} icon={<ChevronDownIcon className="w-4 h-4" />} onClick={toggleRepoMenu} />} />
        )}
        {choosing && signedIn && <RepoRows chooser={chooser} login={login} host={pick} disabled={!!busy} onUseHost={h => { if (isDestination(h)) setPick(h); }} />}
        {workflow && <Prop label="Workflow" value={workflow} tooltip="The repository's own workflow publishes it." />}
        {siteRow}
        {live && !ours && offLive && ( // Netlify/Vercel, or a Pages workflow of the repo's own: the live site follows another branch
          <Prop label="Branch" value={short(s.branch)} caption={`${info.title} builds ${deploy?.liveBranch}`}
            actions={pr && <Button variant="outline" size="md" label="Pull request" onClick={() => open(pr)} />} />
        )}
        {live && state === 'none' && info.connectUrl && gh && ( // 26/27: connect the repository once on the host
          <Prop label={info.title} caption="Not connected yet" tooltip={`On ${info.title}, choose GitHub, then pick ${gh.owner}/${gh.repo}. Build settings are detected.`}
            actions={<Button variant="outline" size="md" label="Connect" onClick={() => open(info.connectUrl!)} />} />
        )}
        {signedIn ? ( // the account (case 5): signing out is here, where it matters
          <Prop label="GitHub" value={login} actions={<Button variant="outline" size="md" label="Log out" loading={busy === 'signOut'} disabled={!!busy}
            onClick={() => void run('signOut', client.signOut)} />} />
        ) : <GitHubSignIn labeled client={client} onSignedIn={() => void refresh()} />}
        <Notices flush>
          {typeErrors && <TypeErrors check={typeErrors} />}
          {live && state === 'failure' && ( // 21
            <NoticeView notice={{ title: 'The last build failed.', detail: pick === 'pages' ? 'GitHub Pages keeps the last good version online.' : undefined,
              links: deploy?.url ? [{ href: deploy.url, label: 'Build log' }] : undefined }} />
          )}
          {live && pick === 'pages' && state === 'none' && !offLive && pushedAt !== null && now - pushedAt > SILENT_MS && gh && ( // 22
            <NoticeView notice={{ title: "GitHub hasn't started the build yet.", links: [{ href: `https://github.com/${gh.owner}/${gh.repo}/actions`, label: 'Open Actions' }] }} />
          )}
          {notice && <NoticeView notice={notice} />}
        </Notices>
      </>)}
      <Menu isOpen={repoMenu} onClose={() => setRepoMenu(false)} triggerRef={menuRef} placement="bottom-end">
        {gh && <MenuItem label="Open on GitHub" onSelect={close(() => open(`https://github.com/${gh.owner}/${gh.repo}`))} />}
        {pr && <MenuItem label="Open pull request" onSelect={close(() => open(pr))} />}
        <MenuItem label="Use another repository" onSelect={close(() => { setError(null); setTypeErrors(null); chooser.reset(); setSwitching(true); })} />
        {/* R9 (owner 2026-11-10): no question — the repo stays on GitHub and connects again from here. */}
        <MenuItem label="Disconnect" onSelect={close(() => { setError(null); setTypeErrors(null); void run('disconnect', client.disconnect, reset); })} />
      </Menu>
      {siteRow && (
        <Menu isOpen={siteMenu} onClose={() => setSiteMenu(false)} triggerRef={siteRef} placement="bottom-end">
          {[...new Set([main!, s.branch, site!])].map(b => (
            <MenuItem key={b} label={short(b)} title={b} selected={b === site} onSelect={() => toSite(b)}
              caption={b === main ? 'The default branch' : b === s.branch ? "The branch you're on" : undefined}
              disabled={!(b === main || b === s.branch) || (b === site && !blocked)} />
          ))}
        </Menu>
      )}
    </Pane>
  );
}
