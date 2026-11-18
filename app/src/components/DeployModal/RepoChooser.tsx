/**
 * Choosing the GitHub repository (docs/plans/2026-10-20-publish-sheet-design.md): New (name + visibility) or Existing (the
 * Choose-a-repository sub-view, its preview, what changes on GitHub, the branch it goes to). Publish (a GitHub destination
 * without a repo, or Use another repository) and Versions (Back up) use it; they own the ops and the footer. The states are
 * ledger cases of docs/plans/2026-10-18-publish-into-existing-repo-design.md (E1–E6) and docs/plans/2026-10-14-github-publish-design.md (12–14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Field, InputGroup, Labeled, Row, SearchField, SegmentedControl } from '@/components/ui';
import { parseGitError, type GitClient, type GitError, type Host, type RepoPreview, type RepoSummary } from '@/services/git/gitClient';
import { Block, Busy, ChoiceRow, destination, isDestination, noAccess, Notices, NoticeView, Pane, Prop, slug, Spacer, type Notice } from './publishParts';

export type RepoRef = { owner: string; repo: string };
const fullName = (r: RepoRef) => `${r.owner}/${r.repo}`;
const REPO_SKELETON = ['owner/repository', 'owner/site', 'owner/a-longer-repository-name', 'owner/docs', 'owner/website'];
const pushedOn = (at: string) => new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' });
export const PAGES_PRIVATE = 'Private repositories need a paid GitHub plan for Pages.'; // GitHub case 17 / P4

export interface Chooser {
  mode: 'new' | 'existing';
  name: string; isPrivate: boolean;
  /** Cases 12–14: "<name> already exists" (+ a free name), or GitHub's sentence. */
  nameError: { message: string; suggestion?: string; taken?: string } | null;
  /** Existing: the repo taken from the list, with its preview. */
  into: RepoPreview | null;
  /** E6: a new branch (`branch`) instead of the live one. */
  toNew: boolean; branch: string;
  /** The Choose-a-repository sub-view is open, starting on this pick (null = none); false = closed. */
  listing: RepoRef | null | false;
}
const fresh = (projectName: string): Chooser => ({ mode: 'new', name: slug(projectName), isPrivate: false, nameError: null, into: null,
  toNew: false, branch: '', listing: false });
export function useChooser(projectName: string) {
  const [c, setC] = useState(() => fresh(projectName));
  const patch = useCallback((p: Partial<Chooser>) => setC(prev => ({ ...prev, ...p })), []);
  const reset = useCallback(() => setC(fresh(projectName)), [projectName]);
  return { c, patch, reset };
}
export type ChooserApi = ReturnType<typeof useChooser>;

/** E6/56: our Pages workflow builds the site branch only (the repo's own workflow deploys once a branch is merged), so a new
 *  branch is offered only where something will deploy it; null host = Back up (no host is set). */
export const newBranchAllowed = (p: RepoPreview, host: Host | null) => !(host === 'pages' && !p.pagesWorkflow);
/** E6: the branch publishing goes to — the live one unless a new name is given ('' while the new name is empty). */
export const target = (p: RepoPreview, host: Host | null, toNew: boolean, branch: string) =>
  (toNew && newBranchAllowed(p, host) ? branch.trim() : p.branch);
const existing = (c: Chooser) => (c.mode === 'existing' && c.into ? c.into : null);
/** It can be published to: New needs a name; Existing a preview and a branch. */
export const chooserReady = (c: Chooser, host: Host | null) => {
  const p = existing(c);
  return p ? !!target(p, host, c.toNew, c.branch) : c.mode === 'new' && !!c.name.trim();
};
/** The primary: Publish to <Host> / Back up to GitHub (New); <verb> into <repo> / <verb> to <branch> (Existing). */
export function chooserLabel(c: Chooser, host: Host | null) {
  const p = existing(c);
  if (!p) return isDestination(host) ? `Publish to ${destination(host).title}` : 'Back up to GitHub';
  const verb = host ? 'Publish' : 'Back up';
  const to = target(p, host, c.toNew, c.branch);
  return to !== p.branch ? `${verb} to ${to || 'a new branch'}` : `${verb} into ${p.repo}`;
}
/** The footer's line for the chosen repo: the Pages plan rule (P4), or a large repo's first download (into 20). */
export function chooserNote(c: Chooser, host: Host | null) {
  const p = existing(c);
  if (host === 'pages' && (p ? p.private : c.isPrivate)) return PAGES_PRIVATE;
  return p?.large ? `The first publish downloads ${p.repo}; it can take a minute.` : null;
}
/** Where the code will be (the Pages address preview). */
export const chosenRef = (c: Chooser, login: string): RepoRef => existing(c) ?? { owner: login, repo: c.name.trim() || 'my-site' };

/** Creates (New) or publishes into (Existing) the chosen repository — main saves the pending edits under `message` first
 *  (P3/E1). A name problem lands on the chooser and resolves false (cases 12–14); anything else throws. null host = Back up. */
export async function linkChosen(client: GitClient, { c, patch }: ChooserApi, host: Host | null, message: string) {
  const p = existing(c);
  if (p) {
    const to = target(p, host, c.toNew, c.branch);
    await client.publishInto(p.owner, p.repo, message, ...(to !== p.branch ? [to] : []));
    return true;
  }
  const name = c.name.trim();
  patch({ nameError: null });
  try { await client.publish(name, c.isPrivate, message); } catch (e) {
    const g = parseGitError(e);
    if (g.code !== 'name-taken' && g.code !== 'invalid') throw g;
    patch({ nameError: { message: g.code === 'name-taken' ? `${name} already exists` : g.message, suggestion: g.extra.suggestion,
      taken: g.code === 'name-taken' ? name : undefined } });
    return false;
  }
  return true;
}

/** The chosen repository as window form items (label on top; the parent lays them out 16px apart). New: Repository (name) +
 *  Use existing, a free name after a clash, Visibility. Existing: the repo + New / Change, what changes on GitHub (E4),
 *  Publish to (E6), the host clash (W5), not Astro (into 16). */
export function RepoRows({ chooser, login, host, disabled, onUseHost }: {
  chooser: ChooserApi; login: string; host: Host | null; disabled: boolean; onUseHost?: (h: Host) => void;
}) {
  const { c, patch } = chooser;
  const p = existing(c);
  const field = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);
  const isNew = !!p && c.toNew && newBranchAllowed(p, host);
  useEffect(() => { // the name field may sit below the fold: bring it in and type into it
    if (!isNew) return;
    field.current?.focus({ preventScroll: true });
    field.current?.scrollIntoView?.({ block: 'center' });
  }, [isNew]);

  if (!p) {
    const e = c.nameError;
    return (
      <>
        <Labeled label="Repository" error={e?.message}>
          <InputGroup layout="row" gap={2}>
            <Field size="lg" value={c.name} onChange={v => patch({ name: v, nameError: null })} aria-label="Repository name" error={!!e} disabled={disabled}
              className="flex-1" />
            {/* case 12: a name that is taken by a repo of theirs opens the list with it picked */}
            <Button variant="outline" size="md" label="Use existing" disabled={disabled}
              onClick={() => patch({ listing: e?.taken ? { owner: login, repo: e.taken } : null, nameError: null })} />
          </InputGroup>
        </Labeled>
        {e?.suggestion && <Prop label="Free name" value={e.suggestion}
          actions={<Button variant="outline" size="md" label="Use it" disabled={disabled} onClick={() => patch({ name: e.suggestion!, nameError: null })} />} />}
        <Labeled label="Visibility">
          <InputGroup layout="row"><SegmentedControl size="lg" className="w-48" value={c.isPrivate ? 'private' : 'public'} onChange={v => patch({ isPrivate: v === 'private' })}
            options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} /></InputGroup>
        </Labeled>
      </>
    );
  }
  const clash = isDestination(host) && p.host && p.host !== host ? p.host : null;
  const allowed = newBranchAllowed(p, host);
  const more = p.removedCount > 3 ? `\n…and ${p.removedCount - 3} more` : '';
  const dropped = Object.entries(p.dropped).map(([dir, n]) => `${dir}/ (${n.toLocaleString()} file${n === 1 ? '' : 's'})`).join(', ');
  const changes = p.empty ? 'Empty: your site becomes its first version' // 14
    : p.changed + p.added + p.removedCount === 0 ? 'No files change'
    : `${p.changed.toLocaleString()} changed · ${p.added.toLocaleString()} new · ${p.removedCount.toLocaleString()} removed`;
  const history = p.empty ? '' : 'GitHub keeps the history.';
  return (
    <>
      <Prop label="Repository" value={fullName(p)} caption={p.private ? 'Private' : 'Public'} actions={<>
        <Button variant="outline" size="md" label="New" disabled={disabled} onClick={() => patch({ mode: 'new', into: null })} />
        <Button variant="outline" size="md" label="Change" disabled={disabled} onClick={() => patch({ listing: p })} />
      </>} />
      <Prop label="Changes" value={changes} testId="into-preview"
        tooltip={[history, p.removedCount ? `Removed:\n${p.removed.slice(0, 3).join('\n')}${more}` : ''].filter(Boolean).join('\n')} />
      {dropped && <Prop label="Leaves GitHub" value={dropped} tooltip="Hosts install and build these themselves." />}
      {p.kept.length > 0 && <Prop label="Stays" value={p.kept.join(', ')} tooltip="GitHub's own files" />}
      <Labeled label="Publish to">
        <div role="radiogroup" aria-label="Publish to">
          <ChoiceRow title={p.branch} label={p.branch} checked={!isNew} onPick={() => patch({ toNew: false })} disabled={disabled}
            meta={!host ? "The repository's default branch" : 'Goes live right away'} />
          <ChoiceRow title="A new branch" label="A new branch" checked={isNew} onPick={() => patch({ toNew: true })} disabled={disabled || !allowed}
            meta={allowed ? 'Goes live when you merge it on GitHub' : `GitHub Pages only publishes ${p.branch}`} />
        </div>
      </Labeled>
      {isNew && (
        <Labeled label="Branch name">
          <Field size="lg" ref={field} value={c.branch} onChange={v => patch({ branch: v })} aria-label="Branch name" placeholder="starquix" disabled={disabled} />
        </Labeled>
      )}
      <Notices flush>
        {clash && isDestination(host) && ( // W5: the pick stands until the nudge is taken
          <NoticeView notice={{ title: `${destination(clash).title} already deploys ${p.repo}.`, detail: `${destination(host).title} would be a second site.`,
            action: { label: `Use ${destination(clash).title} instead`, onClick: () => onUseHost?.(clash) } }} />
        )}
        {!p.astro && <NoticeView notice={{ title: `${p.repo} isn't an Astro site.`, detail: 'Publishing replaces its files with this site.' }} />}
      </Notices>
    </>
  );
}

interface ListProps {
  client: GitClient;
  /** The signed-in GitHub login (another owner's refusal gets the organization hint). */
  login: string;
  /** Picked on open (Change, or "<name> already exists"). */
  initial: RepoRef | null;
  /** Use another repository (docs/plans/2026-10-20-publish-branch-selection-design.md R2): the one in use is not offered. */
  exclude?: RepoRef | null;
  /** The window's copy for the errors every view shares (signed out, unknown). */
  noticeFor: (e: GitError) => Notice;
  onBack: () => void;
  /** Use <repo>: the picked repo's preview. */
  onUse: (p: RepoPreview) => void;
}

/** Choose a repository (sub-view): the repos the user can push to, a search, a typed owner/name, the preview of the pick
 *  (into 6–13, 17–22, 31). Use waits for the preview; only the newest pick's answer counts. */
export function RepoList({ client, login, initial, exclude = null, noticeFor, onBack, onUse }: ListProps) {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [listError, setListError] = useState<GitError | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<RepoRef | null>(null);
  const [preview, setPreview] = useState<RepoPreview | null>(null);
  const [error, setError] = useState<GitError | null>(null);
  const latest = useRef(0);

  const load = useCallback(() => {
    setListError(null); setRepos(null);
    client.repos().then(setRepos, e => setListError(parseGitError(e)));
  }, [client]);
  useEffect(load, [load]);
  const pick = useCallback((r: RepoRef) => {
    const n = ++latest.current;
    setPicked(r); setPreview(null); setError(null);
    client.inspectRepo(r.owner, r.repo).then(p => { if (n === latest.current) setPreview(p); },
      e => { if (n === latest.current) setError(parseGitError(e)); });
  }, [client]);
  useEffect(() => { if (initial) pick(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on open

  const notice = (e: GitError, retry: () => void): Notice => {
    if (e.code === 'repo-unsupported') return { title: e.message }; // 9/17–19: main's sentence
    if (e.code === 'no-access') return noAccess(e, picked?.owner ?? '', login);
    if (e.code === 'repo-gone') return { title: 'That repository is gone or you lost access.', detail: 'Pick another one.' }; // 22
    if (e.code === 'offline') return { title: "You're offline.", detail: 'Checking a repository needs a connection.', action: { label: 'Retry', onClick: retry } };
    return noticeFor(e);
  };
  const q = query.trim();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const inUse = !!exclude && same(q, fullName(exclude));
  const shown = (repos ?? []).filter(r => fullName(r).toLowerCase().includes(q.toLowerCase()) && !(exclude && same(fullName(r), fullName(exclude))));
  // 8: a full owner/name the list doesn't show (more than 100 repos, or not listed) is checked like any other.
  const typed = /^[\w.-]+\/[\w.-]+$/.test(q) && !inUse && !shown.some(r => same(fullName(r), q)) ? q : null;
  return (
    <Pane footer={<>
      <Button variant="ghost" size="lg" label="Back" onClick={onBack} />
      <Spacer />
      <Button variant="primary" size="lg" label={preview ? `Use ${preview.repo}` : 'Use repository'} disabled={!preview} onClick={() => onUse(preview!)} />
    </>}>
      <Block>
        <SearchField value={query} onChange={setQuery} placeholder="Find a repository" aria-label="Find a repository" autoFocus />
      </Block>
      <Block rule>
        {listError ? <NoticeView notice={notice(listError, load)} />
          : !repos ? ( // the list's own rows in their loading state; the titles are typical lengths (their words are invisible)
            <div role="status" aria-label="Loading your repositories">
              {REPO_SKELETON.map(t => <ChoiceRow key={t} skeleton title={t} label={t} meta="Pushed Oct 21, 2026" checked={false} onPick={() => {}} />)}
            </div>
          )
          : (
            <div role="radiogroup" aria-label="Your repositories">
              {shown.map(r => (
                <ChoiceRow key={fullName(r)} title={fullName(r)} label={fullName(r)} checked={!!picked && same(fullName(picked), fullName(r))}
                  onPick={() => pick(r)} meta={`Pushed ${pushedOn(r.pushedAt)}`} badge={r.private ? { label: 'Private', variant: 'default' } : null} />
              ))}
              {!shown.length && <Row size="sm" className="px-2" hover={false}
                title={inUse ? "That's the repository you're using." : repos.length ? 'No repository matches.' : 'No repositories you can publish into.'} />}
              {typed && <Row title={`Use ${typed}`} size="sm" className="rounded-outer px-2" onClick={() => { const [owner, repo] = typed.split('/'); pick({ owner, repo }); }} />}
            </div>
          )}
        <Notices>
          {picked && (error ? <NoticeView notice={notice(error, () => pick(picked))} /> : !preview && <Busy label={`Checking ${fullName(picked)}…`} />)}
        </Notices>
      </Block>
    </Pane>
  );
}
