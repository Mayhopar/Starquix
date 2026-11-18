/**
 * The Versions window (desktop, docs/plans/2026-10-20-publish-sheet-design.md S3, cases 65–77): saves versions (git commits)
 * of the project folder, restores old ones as new versions, branches, and Pull/Push with GitHub. Back up to GitHub links a
 * repository without a host (RepoChooser, a sub-view). Publishing is the Publish window. Talks ONLY to
 * services/git/gitClient (docs/plans/2026-10-07-git-versions-design.md).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreIcon, PlusIcon } from '@/assets/icons';
import { Button, cx, EmptyState, Field, Menu, MenuItem, OperationNotice, Row, SegmentedControl, type RowSlotSpec } from '@/components/ui';
import { act as rowAct, Block, CONTROL_ROW, FooterConfirm, Form, Notices, open, Pane, Spacer, useReportBusy, Window } from '@/components/DeployModal/publishParts';
import { chooserLabel, chooserReady, linkChosen, RepoList, RepoRows, useChooser } from '@/components/DeployModal/RepoChooser';
import { parseGitError, type GitClient, type GitError, type GitStatus, type GitVersion } from '@/services/git/gitClient';
import { GitHubSignIn } from './GitHubSignIn';

const COPY: Partial<Record<GitError['code'], { title: string; detail?: string }>> = {
  offline: { title: "You're offline.", detail: 'Pull and Push need a connection. Versions still save.' },
  'signed-out': { title: 'Sign in to GitHub again.' },
  'repo-gone': { title: 'The GitHub repository is gone or you lost access.', detail: 'Disconnect it, then back up again.' },
  unsaved: { title: 'You have unsaved changes.', detail: 'Save a version or discard them first.' },
  nothing: { title: 'Nothing changed since the last version.' },
  merging: { title: 'Finish or abort the merge first.' },
};
/** Back up into an existing repo: main writes these sentences (docs/plans/2026-10-18-publish-into-existing-repo-design.md). */
const MAINS = new Set<GitError['code']>(['repo-unsupported', 'branch-exists', 'runtime-files', 'no-access', 'branch-taken', 'push-refused', 'moved', 'invalid']);
const copyFor = (e: GitError) => COPY[e.code] ?? (MAINS.has(e.code) ? { title: e.message } : { title: "That didn't work.", detail: 'Try again.' });
const plural = (n: number) => `${n} unsaved change${n === 1 ? '' : 's'}`;

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000);
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  }
  return 'just now';
}
const meta = (t: string): RowSlotSpec => ({ type: 'custom', unboxed: true, node: <span className="text-xs text-text-secondary">{t}</span> });

/** The first read is pending: the window's own rows in the kit's loading state (Row `skeleton`) — branch, GitHub, history.
 *  Titles are typical lengths: their words are invisible, only the bars' widths show. */
const VersionsSkeleton = () => (
  <div role="status" aria-label="Loading versions">
    <Block>
      <Row size="sm" skeleton className={CONTROL_ROW} title="Branch" right={[{ type: 'custom', node: null, skeleton: 'w-44 h-6 rounded-inner' }]} />
      <Row size="sm" skeleton className={CONTROL_ROW} title="GitHub" rightText="owner/repository · Up to date" />
    </Block>
    <Block rule>
      <Row size="sm" skeleton className="px-2" title="History" />
      {['Update site · Oct 21, 2026, 9:41 PM', 'Fixed the hero spacing', 'Version 2'].map(m => (
        <Row key={m} size="sm" skeleton className={cx('rounded-outer', CONTROL_ROW)} title={m} rightText="2 min ago" />
      ))}
    </Block>
  </div>
);

/** The window: the rocket's sibling (the footer's clock). */
export function VersionsWindow({ isOpen, onClose, client, projectName }: { isOpen: boolean; onClose: () => void; client: GitClient; projectName: string }) {
  return (
    <Window isOpen={isOpen} onClose={onClose} title="Versions" closeButton>
      <VersionPanel client={client} projectName={projectName} active={isOpen} />
    </Window>
  );
}

interface Props {
  client: GitClient;
  /** Back up's new repository is named after it (case 2). */
  projectName: string;
  /** The window is open: it reads when it opens. */
  active?: boolean; epoch?: number;
  onBusy?: (busy: boolean) => void;
}

export function VersionPanel({ client, projectName, active = true, epoch = 0, onBusy }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [history, setHistory] = useState<GitVersion[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const [behind, setBehind] = useState(false);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const chooser = useChooser(projectName);
  useReportBusy(!!busy, onBusy);

  const reload = useCallback(async () => {
    const [s, h, b] = await Promise.all([client.status(), client.history(), client.branches()]);
    setStatus(s); setHistory(h); setBranches(b);
  }, [client]);
  useEffect(() => { if (active) reload().catch(e => setError(parseGitError(e))); }, [active, epoch, reload]);

  /** Runs one op; refreshes on success; routes behind/offline to their own states. */
  async function act(name: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(name); setError(null);
    try {
      await fn(); setBehind(false); setOffline(false); await reload(); return true;
    } catch (e) {
      const g = parseGitError(e);
      if (g.code === 'behind') setBehind(true);
      else if (g.code === 'offline') setOffline(true);
      else setError(g);
      await reload().catch(() => {});
      return false;
    } finally { setBusy(null); }
  }

  async function save() {
    if (await act('save', () => client.save(message.trim() || `Version ${history.length + 1}`))) setMessage('');
  }
  async function switchTo(name: string) {
    if (name === status?.branch) return;
    if (status?.changed) { setPendingSwitch(name); return; }
    await act('switch', () => client.switchBranch(name));
  }
  async function resolvePendingSwitch(mode: 'save' | 'discard') {
    const target = pendingSwitch!; setPendingSwitch(null);
    await act('switch', async () => {
      if (mode === 'save') await client.save(`Before switching to ${target}`); else await client.discard();
      await client.switchBranch(target);
    });
  }
  /** Back up (ux 21): links the chosen repo WITHOUT a host — a Cloudflare site keeps Cloudflare; name problems stay on the rows. */
  async function backUp() {
    setBusy('backup'); setError(null);
    try { if (await linkChosen(client, chooser, null, 'Back up to GitHub')) { setBackingUp(false); chooser.reset(); } }
    catch (e) { setError(parseGitError(e)); }
    finally { await reload().catch(() => {}); setBusy(null); }
  }

  const s = status;
  if (!s) return (
    <Pane>{error ? <Block>
      <OperationNotice {...copyFor(error)} action={{ label: 'Retry', onClick: () => { setError(null); void reload().catch(e => setError(parseGitError(e))); } }} />
    </Block> : <VersionsSkeleton />}</Pane>
  );
  const login = s.user?.login ?? '';
  const errorNotice = error && <OperationNotice {...copyFor(error)}
    action={error.code === 'repo-gone' ? { label: 'Disconnect', onClick: () => void act('disconnect', client.disconnect) } : undefined} />;

  if (backingUp) { // Back up to GitHub: the repository rows (sub-view); the list is its own sub-view
    if (chooser.c.listing !== false) return (
      <RepoList client={client} login={login} initial={chooser.c.listing} noticeFor={copyFor} onBack={() => chooser.patch({ listing: false })}
        onUse={p => chooser.patch({ listing: false, mode: 'existing', into: p, toNew: false, branch: '' })} />
    );
    return (
      <Pane footer={<>
        <Button variant="ghost" size="md" label="Back" disabled={!!busy} onClick={() => { setBackingUp(false); setError(null); }} />
        <Spacer />
        <Button variant="primary" size="md" label={chooserLabel(chooser.c, null)} loading={busy === 'backup'}
          disabled={!!busy || !s.user || !chooserReady(chooser.c, null)} onClick={() => void backUp()} />
      </>}>
        <Form>
          {!s.user ? <GitHubSignIn labeled client={client} onSignedIn={() => void reload()} />
            : <RepoRows chooser={chooser} login={login} host={null} disabled={!!busy} />}
          <Notices flush>{errorNotice}</Notices>
        </Form>
      </Pane>
    );
  }

  const connected = !!s.remote;
  const merging = !!s.merging;
  const locked = !!busy || merging;
  const gh = s.github;
  const canSync = connected && !offline && !merging;
  const pr = gh && s.branch !== 'main' ? `https://github.com/${gh.owner}/${gh.repo}/compare/${s.branch}?expand=1` : null;
  const counts = offline ? 'Offline' : s.ahead || s.behind ? `${s.ahead} to push · ${s.behind} to pull` : 'Up to date';
  const closeMenu = (fn: () => void) => () => { setMenu(false); fn(); };

  // The footer holds the decision at hand: a dirty branch switch (save or discard), a merge, else the save composer.
  // Restore and Disconnect act at once (owner 2026-11-10): a restore is saved as a new version, a disconnected repo
  // stays on GitHub — nothing to ask.
  const footer = pendingSwitch ? (
    <FooterConfirm question={`You have ${plural(s.changed)}. Save or discard them before switching to ${pendingSwitch}.`}
      actions={<>
        <Button variant="ghost" size="md" label="Cancel" onClick={() => setPendingSwitch(null)} />
        <Button variant="danger" size="md" label="Discard & switch" onClick={() => void resolvePendingSwitch('discard')} />
        <Button variant="primary" size="md" label="Save version & switch" onClick={() => void resolvePendingSwitch('save')} />
      </>} />
  ) : merging ? (<>
    <Spacer />
    <Button variant="ghost" size="md" label="Abort" disabled={!!busy} onClick={() => void act('abort', client.abort)} />
    <Button variant="primary" size="md" label="Finish merge" loading={busy === 'finish'} disabled={!!busy} onClick={() => void act('finish', client.finish)} />
  </>) : (<>
    <span className="shrink-0 text-xs text-text-secondary" data-testid="changed-count">{s.changed ? plural(s.changed) : 'All changes saved'}</span>
    <div className="flex-1 min-w-0">
      <Field value={message} onChange={setMessage} placeholder="Describe this version" aria-label="Version message"
        disabled={locked} onKeyDown={e => { if (e.key === 'Enter' && s.changed) void save(); }} />
    </div>
    <Button variant="primary" size="md" label="Save version" loading={busy === 'save'} disabled={locked || !s.changed} onClick={() => void save()} />
  </>);

  return (
    <Pane footer={footer}>
      <Block>
        <section aria-label="Branches">
          <Row size="sm" className={CONTROL_ROW} hover={false} title="Branch"
            right={[{ type: 'custom', unboxed: true, node: (
              <div className="w-44"><Field as="select" size="sm" value={s.branch} onChange={v => void switchTo(v)} disabled={locked} aria-label="Branch"
                options={branches.map(b => ({ value: b, label: b }))} showChevron /></div>) },
            ...(newBranch === null ? [{ type: 'custom' as const, unboxed: true, node: <Button variant="ghost" size="sm" iconOnly aria-label="New branch" title="New branch"
              disabled={locked} icon={<PlusIcon className="w-4 h-4" />} onClick={() => setNewBranch('')} /> }] : [])]} />
          {newBranch !== null && (
            <Row size="sm" className={CONTROL_ROW} hover={false} title="New branch"
              right={[{ type: 'custom', unboxed: true, node: <div className="w-44"><Field size="sm" value={newBranch} onChange={setNewBranch} aria-label="New branch name" placeholder="redesign" /></div> },
                rowAct('Create', () => void act('branch', () => client.createBranch(newBranch.trim())).then(ok => { if (ok) setNewBranch(null); }),
                  { disabled: !newBranch.trim() || locked }),
                rowAct('Cancel', () => setNewBranch(null))]} />
          )}
        </section>
        <section aria-label="GitHub">
          {!connected ? (
            <Row size="sm" className={CONTROL_ROW} hover={false} title="GitHub"
              right={[meta('Not backed up'), rowAct('Back up', () => { setError(null); setBackingUp(true); }, { disabled: locked })]} />
          ) : !s.user ? (
            <GitHubSignIn client={client} onSignedIn={() => void reload()} />
          ) : (
            <Row size="sm" className={CONTROL_ROW} hover={false} title="GitHub"
              right={[{ type: 'custom', unboxed: true, node: <span className="max-w-48 truncate text-xs text-text" title={gh ? `${gh.owner}/${gh.repo}` : s.remote!}>{gh ? `${gh.owner}/${gh.repo}` : s.remote}</span> },
                meta(`· ${counts}`),
                rowAct('Pull', () => void act('pull', client.pull), { disabled: locked || !canSync, loading: busy === 'pull' }),
                rowAct('Push', () => void act('push', client.push), { disabled: locked || !canSync || !s.ahead, loading: busy === 'push' }),
                { type: 'custom', unboxed: true, node: <Button ref={menuRef} variant="ghost" size="sm" iconOnly aria-label="GitHub options" title="GitHub options"
                  disabled={!!busy} icon={<MoreIcon className="w-4 h-4" />} onClick={() => setMenu(o => !o)} /> }]} />
          )}
        </section>
        <Notices>
          {behind && <OperationNotice title="GitHub has newer versions." detail="Pull them first, then push."
            action={{ label: 'Pull', onClick: () => void act('pull', client.pull), busy: busy === 'pull' }} />}
          {errorNotice}
        </Notices>
      </Block>

      {merging && s.conflicts && ( // per-file Mine/Theirs; Finish/Abort in the footer
        <section aria-label="Merge">
          <Block rule>
            <Row size="sm" className="px-2" hover={false} title="Merge" />
            <OperationNotice title="GitHub and this computer both changed the same files." detail="Pick which version of each file to keep." />
            <div className="pt-2">
              {Object.entries(s.conflicts).map(([file, side]) => (
                <Row key={file} title={file} size="sm" className={CONTROL_ROW} hover={false}
                  right={[{ type: 'custom', unboxed: true, node: (
                    <div className="shrink-0 w-36">
                      <SegmentedControl value={side} onChange={v => void act('resolve', () => client.resolve(file, v as 'mine' | 'theirs'))}
                        options={[{ value: 'mine', label: 'Mine' }, { value: 'theirs', label: 'Theirs' }]} />
                    </div>) }]} />
              ))}
            </div>
          </Block>
        </section>
      )}

      <section aria-label="History">
        <Block rule>
          <Row size="sm" className="px-2" hover={false} title="History" />
          {!history.length && <EmptyState title="No versions yet" />}
          {history.map((v, i) => (
            <Row key={v.oid} size="sm" title={<span className="text-text">{v.message}</span>} rowProps={{ title: `${v.message}\n${new Date(v.at).toLocaleString()} · ${v.author}` }}
              className={cx('rounded-outer', CONTROL_ROW)}
              right={[
                ...(connected && i < (s.ahead ?? 0) ? [{ type: 'badge' as const, label: 'Not pushed', variant: 'warning' as const }] : []),
                ...(i > 0 ? [{ type: 'custom' as const, unboxed: true, showOnHover: true, node: (
                  <Button variant="ghost" size="sm" label="Restore" disabled={locked || !!s.changed}
                    title={s.changed ? 'Save or discard your unsaved changes first' : undefined}
                    onClick={() => { setPendingSwitch(null); void act('restore', () => client.restore(v.oid)); }} />) }] : []),
                meta(ago(v.at)),
              ]} />
          ))}
        </Block>
      </section>

      <Menu isOpen={menu} onClose={() => setMenu(false)} triggerRef={menuRef} placement="bottom-end">
        <MenuItem label="Check GitHub" disabled={locked || !canSync} onSelect={closeMenu(() => void act('refresh', client.refresh))} />
        {gh && <MenuItem label="Open on GitHub" onSelect={closeMenu(() => open(`https://github.com/${gh.owner}/${gh.repo}`))} />}
        {pr && <MenuItem label="Open pull request" onSelect={closeMenu(() => open(pr))} />}
        {gh && <MenuItem label="Disconnect" disabled={locked} onSelect={closeMenu(() => { setPendingSwitch(null); void act('disconnect', client.disconnect); })} />}
      </Menu>
    </Pane>
  );
}
