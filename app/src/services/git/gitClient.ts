/**
 * Versions + GitHub, renderer side. The ONLY module the UI talks to; today it rides the
 * desktop IPC (`sq:git`, desktop/src/git/ops.mjs). A future web runtime swaps this module's
 * transport and nothing else (docs/plans/2026-10-07-git-versions-design.md).
 *
 * Rules: every op that reads or rewrites the folder first drains the durable journal to disk
 * (a version must not miss the last edit; a restore must not be clobbered by a late write);
 * every op that rewrites the folder re-mirrors disk → Dexie afterwards.
 */
import { awaitProjectFiles } from '@/services/durableEdits/sourceMaterialization';
import { desktopDriver } from '@/services/desktopDriver';

export type GitErrorCode = 'behind' | 'signed-out' | 'denied' | 'expired' | 'cancelled' | 'name-taken' | 'repo-gone'
  | 'pages-unavailable' | 'unsaved' | 'merging' | 'offline' | 'nothing' | 'invalid' | 'not-configured' | 'no-keychain'
  // The Pages site branch (docs/plans/2026-10-20-publish-branch-selection-design.md): message = the sentence to show.
  | 'pages-admin' | 'pages-protected' | 'pages-not-set-up' | 'pages-not-started'
  | 'unavailable' | 'github' | 'error'
  // Cloudflare (docs/plans/2026-10-16-cloudflare-one-click-design.md)
  | 'cloudflare-signed-out' | 'cloudflare' | 'rate-limited' | 'choose-account' | 'no-account' | 'build-failed' | 'not-static'
  | 'file-too-big' | 'price-changed' | 'domain-taken' | 'no-contact' | 'no-payment' | 'registrar-refused' | 'domain-conflict' | 'invalid-domain'
  | 'refused' // the renderer's own Export guard before a publish (DeployModal): message = title, extra.detail
  // Publish into an existing repo (docs/plans/2026-10-18-publish-into-existing-repo-design.md); repo-unsupported/no-access/
  // runtime-files: message = the sentence to show.
  | 'repo-unsupported' | 'no-access' | 'branch-taken' | 'branch-exists' | 'moved' | 'push-refused' | 'runtime-files';

export interface GitErrorExtra {
  suggestion?: string; settingsUrl?: string; snippet?: string; branch?: string;
  /** Cloudflare: its HTTP status (never its body), a changed price, the file over the size limit. */
  status?: number; price?: string; currency?: string; file?: string;
  /** 'refused': the curated detail line. */
  detail?: string;
}
export class GitError extends Error {
  constructor(public code: GitErrorCode, message: string, public extra: GitErrorExtra = {}) { super(message); this.name = 'GitError'; }
}

/** Main encodes `sq-git:{json}`; Electron wraps it as "Error invoking remote method …: Error: sq-git:{…}". */
export function parseGitError(e: unknown): GitError {
  if (e instanceof GitError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const at = text.indexOf('sq-git:');
  if (at < 0) return new GitError('error', text);
  try {
    const { code, message, ...extra } = JSON.parse(text.slice(at + 7)) as { code: GitErrorCode; message: string } & GitErrorExtra;
    return new GitError(code, message, extra);
  } catch { return new GitError('error', text); }
}

/** Where a published site lives (docs/plans/2026-10-14-github-publish-design.md); kept in the repo's .git/config. */
export type Host = 'pages' | 'netlify' | 'vercel' | 'github' | 'cloudflare';

export interface GitUser { login: string; name: string | null; email: string | null; avatarUrl: string; id: number }
export interface GitStatus {
  initialized: boolean; branch: string; changed: number; files: string[]; merging: boolean;
  conflicts: Record<string, 'mine' | 'theirs'> | null;
  remote: string | null; github: { owner: string; repo: string } | null; ahead: number; behind: number; user: GitUser | null;
  /** pagesStale = a Pages host whose workflow/rebase files on disk are missing or old (Publish changes repairs them).
   *  pagesWorkflow = the repo's own workflow that deploys Pages: it stays the deployer, Publish writes none of ours. */
  host: Host | null; pagesStale: boolean; pagesWorkflow: string | null;
}
/** A repository the signed-in user can publish into. */
export interface RepoSummary { owner: string; repo: string; private: boolean; pushedAt: string }
/** What publishing into a repo would change (counts vs the project's files; `removed` = the first 20 of `removedCount`;
 *  `dropped` = GitHub paths the project folder can't hold, per top folder; `kept` = GitHub's own files, top-level names). */
export interface RepoPreview {
  owner: string; repo: string; branch: string; private: boolean; large: boolean; empty: boolean; astro: boolean;
  changed: number; added: number; removed: string[]; removedCount: number; dropped: Record<string, number>; kept: string[];
  host: Exclude<Host, 'github' | 'cloudflare'> | null; pagesWorkflow: string | null;
}
/** One error the site's own `astro check` reports (docs/plans/2026-10-20-prepublish-type-check-design.md): project path, 1-based. */
export interface TypeCheckError { file: string; line: number; column: number; code: string; message: string }
/** ran = its build runs `astro check` and it ran here; errors = the first 100 of `total`. */
export interface TypeCheck { ran: boolean; errors: TypeCheckError[]; total: number }
export interface GitVersion { oid: string; message: string; at: number; author: string; parents: string[] }
export interface MergeState { ours: string; theirs: string; files: Record<string, 'mine' | 'theirs'> }
/** `url` = the report's details/log page; `liveUrl` = the site itself; `liveBranch` = the branch the site shows (Pages: the
 *  site branch Publish picked, else the default); `defaultBranch` = GitHub's default branch (both null until known);
 *  `siteBlocked` = GitHub's github-pages rule refuses that branch (docs/plans/2026-10-20-publish-branch-selection-design.md 48). */
export interface DeployStatus { state: 'success' | 'pending' | 'failure' | 'none'; url: string | null; liveUrl: string | null;
  liveBranch: string | null; defaultBranch: string | null; siteBlocked: boolean }

export interface CloudflareAccount { id: string; name: string }
/** registering → confirm-email → setting-up → https → live; failed / conflict / detached need the user (ledger 53–62);
 *  unknown = Cloudflare could not be asked right now (the site stays usable). */
export type DomainState = 'registering' | 'confirm-email' | 'setting-up' | 'https' | 'live' | 'failed' | 'conflict' | 'detached' | 'unknown';
export interface CloudflareStatus {
  connected: boolean; account: CloudflareAccount | null;
  /** Filled only while no account is chosen (the picker). */
  accounts: CloudflareAccount[];
  /** url = the workers.dev address (null until the account has a subdomain); reachable = it answers (DNS + TLS). */
  worker: { name: string; url: string | null; reachable: boolean } | null;
  /** HEAD is the commit the last publish uploaded. */
  published: boolean;
  /** holder (conflict only) = the account's other Worker that has the hostname; null = DNS records hold it. */
  domain: { name: string; state: DomainState; sentTo: string | null; holder?: string | null } | null;
  /** Unpublished: the address "Publish again" brings back (the Worker name + domain are kept). */
  offline: string | null;
}
/** A search row: buy (price per year) · owned (active zone in the account) · inactive (a zone not active yet) · taken ·
 *  dashboard (buy on Cloudflare) · unavailable. */
export interface DomainRow { name: string; kind: 'buy' | 'owned' | 'inactive' | 'taken' | 'dashboard' | 'unavailable'; price?: string; renewal?: string; currency?: string }

const FLUSH_FIRST = new Set(['status', 'save', 'restore', 'switchBranch', 'createBranch', 'discard', 'pull', 'push', 'publish', 'setHost', 'publishChanges',
  'pagesBranch', 'cloudflarePublish', 'inspectRepo', 'publishInto', 'typeCheck']);
const REWRITES_DISK = new Set(['restore', 'switchBranch', 'discard', 'pull', 'resolve', 'finish', 'abort']);

export interface GitDeps {
  call(projectId: string, op: string, args?: Record<string, unknown>): Promise<unknown>;
  flush(projectId: string): Promise<void>;
  remirror(projectId: string): Promise<void>;
}
const desktopDeps: GitDeps = {
  call: (id, op, args) => desktopDriver.git(id, op, args),
  flush: awaitProjectFiles,
  remirror: id => desktopDriver.remirror(id),
};

export function createGitClient(projectId: string, deps: GitDeps = desktopDeps) {
  async function run<T>(op: string, args?: Record<string, unknown>): Promise<T> {
    if (FLUSH_FIRST.has(op)) await deps.flush(projectId);
    let result: unknown;
    try { result = await deps.call(projectId, op, args); } catch (e) { throw parseGitError(e); }
    // setHost/publishChanges write .github/ only when a Pages setup is (re)made, publishInto when it kept GitHub's files —
    // they say so: re-mirror only then.
    if (REWRITES_DISK.has(op) || (result as { wrote?: boolean } | undefined)?.wrote) await deps.remirror(projectId);
    return result as T;
  }
  return {
    status: () => run<GitStatus>('status'),
    history: () => run<GitVersion[]>('history'),
    branches: () => run<string[]>('branches'),
    save: (message: string) => run<string>('save', { message }),
    restore: (oid: string) => run<string>('restore', { oid }),
    createBranch: (name: string) => run<void>('createBranch', { name }),
    switchBranch: (name: string) => run<void>('switchBranch', { name }),
    discard: () => run<void>('discard'),
    refresh: () => run<{ ahead: number; behind: number }>('refresh'),
    pull: () => run<{ conflicts: string[] }>('pull'),
    resolve: (path: string, side: 'mine' | 'theirs') => run<void>('resolve', { path, side }),
    finish: () => run<string>('finish'),
    abort: () => run<void>('abort'),
    push: () => run<void>('push'),
    /** `message`: pending edits are saved under it first (the Publish flow saves for the user). */
    publish: (name: string, isPrivate: boolean, message?: string) =>
      run<{ owner: string; repo: string; htmlUrl: string }>('publish', { name, private: isPrivate, message }),
    /** Publish into an existing repo: the repos you can push to, the preview, the publish (main saves the edits first). */
    repos: () => run<RepoSummary[]>('repos'),
    inspectRepo: (owner: string, repo: string) => run<RepoPreview>('inspectRepo', { owner, repo }),
    /** `branch`: a NEW branch on GitHub instead of its default (live) one — merged there with a pull request. */
    publishInto: (owner: string, repo: string, message: string, branch?: string) =>
      run<{ owner: string; repo: string; htmlUrl: string; wrote: boolean }>('publishInto', { owner, repo, message, ...(branch ? { branch } : {}) }),
    disconnect: () => run<void>('disconnect'),
    signIn: () => run<{ userCode: string; verificationUri: string }>('signIn'),
    signInWait: () => run<GitUser | null>('signInWait'),
    signInCancel: () => run<void>('signInCancel'),
    signOut: () => run<void>('signOut'),
    /** The signed-in GitHub user (an account op: no project lane, no tree read) — the window's accounts menu. */
    user: () => run<GitUser | null>('user'),
    deployStatus: () => run<DeployStatus>('deployStatus'),
    setHost: (host: Host, message?: string) => run<{ wrote: boolean }>('setHost', { host, message }),
    publishChanges: (message: string) => run<{ wrote: boolean }>('publishChanges', { message }),
    /** What the site's own `astro check` says about the folder on disk (main checks a copy; the journal is drained first). */
    typeCheck: () => run<TypeCheck>('typeCheck'),
    /** The branch GitHub Pages shows: the branch you're on (your edits are saved under `message` and pushed) or the default
     *  branch (docs/plans/2026-10-20-publish-branch-selection-design.md). */
    pagesBranch: (branch: string, message: string) => run<{ wrote: boolean }>('pagesBranch', { branch, message }),
    makePublic: () => run<void>('makePublic'),
    cloudflareStatus: () => run<CloudflareStatus>('cloudflareStatus'),
    cloudflareConnect: () => run<void>('cloudflareConnect'),
    cloudflareAccount: (id: string) => run<void>('cloudflareAccount', { id }),
    /** The address the next publish serves (domain, else workers.dev): written into astro.config before the build. */
    cloudflareAddress: (name: string) => run<{ url: string }>('cloudflareAddress', { name }),
    /** Main saves the edits under `message`, builds the folder on disk and uploads it (the journal is drained first). */
    cloudflarePublish: (name: string, message: string) => run<{ wrote: boolean }>('cloudflarePublish', { name, message }),
    cloudflareSearch: (q: string) => run<DomainRow[]>('cloudflareSearch', { q }),
    /** `buy` = the price the user saw (main refuses any other); none = a domain already theirs; `takeOver` = move it off
     *  the account's other Worker ("Use it here"); null = forget the shown one. */
    cloudflareDomain: (domain: string | null, buy?: { price: string; currency: string; autoRenew: boolean } | { takeOver: true }) =>
      run<{ state: string | null }>('cloudflareDomain', { domain, ...buy }),
    cloudflareDisconnect: () => run<void>('cloudflareDisconnect'),
    /** Takes the site offline (the Worker leaves Cloudflare); the domain stays registered. */
    cloudflareUnpublish: () => run<{ wrote: boolean }>('cloudflareUnpublish'),
  };
}
export type GitClient = ReturnType<typeof createGitClient>;
