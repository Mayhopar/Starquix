// Publish into an existing repo (docs/plans/2026-10-18-publish-into-existing-repo-design.md): ledger numbers in the names.
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'isomorphic-git/http/node';
import { createEngine } from '../src/git/engine.mjs';
import { lfs, partition, unmanaged } from '../src/git/into.mjs';
import { createGitContext, runGitOp } from '../src/git/ops.mjs';
import { writePagesFiles } from '../src/git/pages.mjs';
import { startGitServer } from './helpers/git-server.mjs';

const dirs = [];
const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-into-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fsp.rm(d, { recursive: true, force: true }))); });
let root; let server; let n = 0;
beforeAll(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-into-remote-')); server = await startGitServer(root); });
afterAll(async () => { await server.close(); await fsp.rm(root, { recursive: true, force: true }); });
const author = { name: 'Starquix', email: 'noreply@starquix.app' };
const sh = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=GitHub', '-c', 'user.email=g@x', ...args], { cwd, encoding: 'utf8' }).trim();
const write = async (dir, files) => { for (const [f, t] of Object.entries(files)) { await fsp.mkdir(path.dirname(path.join(dir, f)), { recursive: true }); await fsp.writeFile(path.join(dir, f), t); } };
/** A "GitHub" repo with one commit of `files` (force-added: node_modules too) on `branch`; `work` = a clone to move it. */
async function github(files, { branch = 'master' } = {}) {
  const name = `gh${n++}`; const bare = path.join(root, `${name}.git`);
  execFileSync('git', ['init', '--bare', '-q', '-b', branch, bare]);
  const work = await tmp(); sh(work, 'init', '-q', '-b', branch);
  if (Object.keys(files).length) { await write(work, files); sh(work, 'add', '-A', '-f'); sh(work, 'commit', '-qm', 'GitHub v1'); sh(work, 'push', '-q', bare, branch); }
  sh(work, 'remote', 'add', 'origin', bare);
  return { bare, work, url: server.url(`${name}.git`), git: (...a) => sh(bare, ...a) };
}
/** The project: a few files saved as one version on main. */
async function project(files = { 'src/pages/index.astro': 'new', 'src/new.astro': 'n' }) {
  const dir = await tmp(); const engine = createEngine(dir, { http });
  await write(dir, files); await engine.save('one', author);
  return { dir, engine };
}
const OWNER_SITE = { 'src/pages/index.astro': 'old', 'src/old.astro': 'x', '.gitignore': 'node_modules\n.env\n',
  '.vscode/settings.json': '{}', 'node_modules/a.js': 'a' };
const refs = dir => sh(dir, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean);
const untouched = async ({ dir, engine }) => {
  expect(await engine.branch()).toBe('main');
  expect(await engine.remote()).toBe(null);
  expect(refs(dir)).toEqual(['refs/heads/main']);
  expect(fs.existsSync(path.join(dir, '.vscode'))).toBe(false);
  expect(fs.existsSync(path.join(dir, '.git/shallow'))).toBe(false);
};

const blob = (path, oid = `o-${path}`, mode = '100644') => ({ path, mode, type: 'blob', oid });

it('E3. unmanaged = what Import never brings in (dot-paths, build/dep dirs); everything else is the project\'s', () => {
  for (const p of ['.gitignore', '.github/workflows/deploy.yml', '.vscode/settings.json', '.astro/settings.json', 'src/.DS_Store',
    '.vercel/project.json', '.netlify/state.json', 'x/.output/a', 'node_modules/a/index.js', 'dist/index.html']) expect(unmanaged(p), p).toBe(true);
  for (const p of ['README.md', 'public/CNAME', 'src/pages/index.astro', 'package.json', 'src/dist-notes.md']) expect(unmanaged(p), p).toBe(false);
});

it('E2/E3/15. the owner\'s shape: the project replaces GitHub\'s files, GitHub\'s dot-files stay, node_modules leaves', () => {
  const remote = [
    blob('src/pages/index.astro', 'old-index'), blob('src/same.astro', 'same'), blob('src/components/WorkList.astro'),
    blob('.gitignore', 'their-ignore'), blob('.vscode/settings.json'), blob('.astro/settings.json'),
    blob('node_modules/a/index.js'), blob('node_modules/b/x.js'), blob('functions/node_modules/c.js'),
    { path: 'src', mode: '040000', type: 'tree', oid: 't' }, // REST trees list directories too
  ];
  const local = new Map([['src/pages/index.astro', 'new-index'], ['src/same.astro', 'same'], ['src/components/BlogSlot.astro', 'b'],
    ['.gitignore', 'our-ignore'], ['.astro/astro/content.d.ts', 'd']]);
  const p = partition(remote, local);
  expect(p.keep.map(e => e.path).sort()).toEqual(['.astro/settings.json', '.gitignore', '.vscode/settings.json']);
  expect(p.keep.find(e => e.path === '.gitignore').oid).toBe('their-ignore'); // both sides: GitHub's wins
  expect(p.removed).toEqual(['src/components/WorkList.astro']);
  expect(p.dropped).toEqual({ node_modules: 3 });
  expect(p.changed).toBe(1); // index.astro; same.astro is unchanged; .gitignore is GitHub's
  expect(p.added).toBe(2); // BlogSlot.astro + the project's own .astro/astro/content.d.ts
  expect(p.submodules).toBe(false);
});

it('E3. top-level .sq/ and dist/ leave the repo; a nested dist/ stays GitHub\'s (Import skips dist at any depth)', () => {
  const p = partition([blob('dist/index.html'), blob('dist/a.css'), blob('.sq/seed-complete.json'), blob('src/dist/x.js')], new Map());
  expect(p.dropped).toEqual({ dist: 2, '.sq': 1 });
  expect(p.removed).toEqual([]);
  expect(p.keep.map(e => e.path)).toEqual(['src/dist/x.js']);
});

it('21. a GitHub-only symlink, a .git segment, or a kept path that clashes with a project file/folder is not kept (listed as removed)', () => {
  const remote = [blob('.husky/pre', 'l', '120000'), blob('.cfg/.git/config'), blob('.tool'), blob('.env/x'), blob('.ok/a', 'a', '100755')];
  const local = new Map([['.tool/inner.json', 'i'], ['.env', 'e']]); // a folder where GitHub has a file, a file where GitHub has a folder
  const p = partition(remote, local);
  expect(p.removed.sort()).toEqual(['.cfg/.git/config', '.env/x', '.husky/pre', '.tool']);
  expect(p.keep).toEqual([{ path: '.ok/a', mode: '100755', type: 'blob', oid: 'a' }]); // executable bit kept
});

it('18. gitlinks (submodules) are flagged and never kept', () => {
  const p = partition([{ path: 'themes/x', mode: '160000', type: 'commit', oid: 'c' }, blob('.gitmodules')], new Map());
  expect(p.submodules).toBe(true);
  expect(p.keep.map(e => e.path)).toEqual(['.gitmodules']);
});

it('14/15. an empty repo or identical trees → nothing removed, nothing changed', () => {
  const local = new Map([['a.astro', 'x'], ['b.md', 'y']]);
  expect(partition([], local)).toMatchObject({ keep: [], removed: [], dropped: {}, changed: 0, added: 2 });
  expect(partition([blob('a.astro', 'x'), blob('b.md', 'y')], local)).toMatchObject({ keep: [], removed: [], changed: 0, added: 0 });
});

it('17. lfs(): a .gitattributes that routes files through Git LFS', () => {
  expect(lfs('*.psd filter=lfs diff=lfs merge=lfs -text\n')).toBe(true);
  expect(lfs('* text=auto\n*.png binary\n')).toBe(false);
  expect(lfs(null)).toBe(false);
});

it('E2/25/27/28. publishInto, unrelated history: one version on GitHub\'s tip with both parents; GitHub\'s dot-files land; node_modules leaves; main becomes master', async () => {
  const gh = await github(OWNER_SITE);
  const p = await project();
  const head = await p.engine.tip('HEAD');
  const tip = await p.engine.fetchTip(gh.url, 'master');
  expect(tip.oid).toBe(gh.git('rev-parse', 'master'));
  expect(tip.entries.map(e => e.path).sort()).toEqual(['.gitignore', '.vscode/settings.json', 'node_modules/a.js', 'src/old.astro', 'src/pages/index.astro']);
  const parts = partition(tip.entries, await p.engine.files());
  expect(await p.engine.publishInto({ url: gh.url, branch: 'master', tip: tip.oid, keep: parts.keep, author, message: 'Publish from Starquix' }))
    .toEqual({ wrote: true });
  expect(gh.git('log', '-1', '--format=%P %s', 'master')).toBe(`${head} ${tip.oid} Publish from Starquix`);
  expect(gh.git('ls-tree', '-r', '--name-only', 'master').split('\n')).toEqual(['.gitignore', '.vscode/settings.json', 'src/new.astro', 'src/pages/index.astro']);
  expect(gh.git('show', 'master:.gitignore')).toBe('node_modules\n.env\n.sq/\ndist/'); // GitHub's + our runtime entries
  expect(await p.engine.branch()).toBe('master');
  expect(await p.engine.remote()).toBe(gh.url);
  expect(await fsp.readFile(path.join(p.dir, '.vscode/settings.json'), 'utf8')).toBe('{}');
  expect(fs.existsSync(path.join(p.dir, 'node_modules'))).toBe(false);
  expect(await p.engine.status()).toMatchObject({ branch: 'master', changed: 0 });
  expect(await p.engine.counts()).toEqual({ ahead: 0, behind: 0 });
  const [top, ...older] = (await p.engine.history()).map(v => v.message); // both histories (same-second ties: any order)
  expect([top, older.sort()]).toEqual(['Publish from Starquix', ['GitHub v1', 'one']]);
  expect(refs(p.dir)).toEqual(['refs/heads/master', 'refs/remotes/origin/master']); // no temp refs left
});

it('29. GitHub moved between fetch and push → moved; nothing changed here', async () => {
  const gh = await github(OWNER_SITE);
  const p = await project();
  const tip = await p.engine.fetchTip(gh.url, 'master');
  await write(gh.work, { 'late.md': 'x' }); sh(gh.work, 'add', '-A'); sh(gh.work, 'commit', '-qm', 'late'); sh(gh.work, 'push', '-q', 'origin', 'master');
  const keep = partition(tip.entries, await p.engine.files()).keep;
  await expect(p.engine.publishInto({ url: gh.url, branch: 'master', tip: tip.oid, keep, author, message: 'Publish from Starquix' }))
    .rejects.toMatchObject({ code: 'moved' });
  await untouched(p);
  expect(gh.git('log', '-1', '--format=%s', 'master')).toBe('late');
});

it('30. GitHub refuses the update (protected branch) → push-refused with its reason; nothing changed here', async () => {
  const gh = await github(OWNER_SITE);
  await fsp.writeFile(path.join(gh.bare, 'hooks/pre-receive'), '#!/bin/sh\necho "protected branch" >&2\nexit 1\n', { mode: 0o755 });
  const p = await project();
  const tip = await p.engine.fetchTip(gh.url, 'master');
  const keep = partition(tip.entries, await p.engine.files()).keep;
  const e = await p.engine.publishInto({ url: gh.url, branch: 'master', tip: tip.oid, keep, author, message: 'Publish from Starquix' }).catch(x => x);
  expect(e).toMatchObject({ code: 'push-refused', branch: 'master' });
  expect(e.message).toMatch(/declined/);
  await untouched(p);
});

it('32. a fetch that fails (offline / gone) leaves nothing behind', async () => {
  const p = await project();
  await expect(p.engine.fetchTip(server.url('nope.git'), 'master')).rejects.toBeTruthy();
  await untouched(p);
});

it('26. GitHub\'s tip already in this project\'s history → a plain fast-forward push, no link version', async () => {
  const gh = await github({}, { branch: 'main' });
  const p = await project();
  await p.engine.setRemote(gh.url); await p.engine.push(); await p.engine.removeRemote();
  await write(p.dir, { 'src/new.astro': 'n2' }); await p.engine.save('two', author);
  const tip = await p.engine.fetchTip(gh.url, 'main');
  await p.engine.publishInto({ url: gh.url, branch: 'main', tip: tip.oid, keep: [], author, message: 'Publish from Starquix' });
  expect(gh.git('log', '--format=%s', 'main').split('\n')).toEqual(['two', 'one']);
});

it('14. an empty repo → the project\'s history is pushed as it is', async () => {
  const gh = await github({}, { branch: 'main' });
  const p = await project();
  expect(await p.engine.fetchTip(gh.url, 'main')).toBe(null);
  expect(await p.engine.publishInto({ url: gh.url, branch: 'main', tip: null, keep: [], author, message: 'Publish from Starquix' })).toEqual({ wrote: false });
  expect(gh.git('log', '--format=%s', 'main')).toBe('one');
  expect(await p.engine.remote()).toBe(gh.url);
});

it('43. restoring GitHub\'s old tip brings its files back, never node_modules / .sq / dist', async () => {
  const gh = await github({ ...OWNER_SITE, 'dist/index.html': 'built', '.sq/x': 'ours' });
  const p = await project();
  const tip = await p.engine.fetchTip(gh.url, 'master');
  await p.engine.publishInto({ url: gh.url, branch: 'master', tip: tip.oid, keep: partition(tip.entries, await p.engine.files()).keep, author, message: 'Publish from Starquix' });
  await p.engine.restore(tip.oid, author);
  expect(await fsp.readFile(path.join(p.dir, 'src/old.astro'), 'utf8')).toBe('x');
  expect(fs.existsSync(path.join(p.dir, 'src/new.astro'))).toBe(false);
  for (const f of ['node_modules/a.js', 'dist/index.html', '.sq/x']) expect(fs.existsSync(path.join(p.dir, f)), f).toBe(false);
});

it('44. Get latest refuses a GitHub version with node_modules at its root (it would write through the runtime-deps symlink)', async () => {
  const gh = await github(OWNER_SITE);
  const p = await project();
  const tip = await p.engine.fetchTip(gh.url, 'master');
  await p.engine.publishInto({ url: gh.url, branch: 'master', tip: tip.oid, keep: partition(tip.entries, await p.engine.files()).keep, author, message: 'Publish from Starquix' });
  sh(gh.work, 'pull', '-q', 'origin', 'master');
  await write(gh.work, { 'node_modules/b.js': 'b' }); sh(gh.work, 'add', '-A', '-f'); sh(gh.work, 'commit', '-qm', 'deps again'); sh(gh.work, 'push', '-q', 'origin', 'master');
  const head = await p.engine.tip('HEAD');
  await expect(p.engine.pull(author)).rejects.toMatchObject({ code: 'runtime-files' });
  expect(await p.engine.tip('HEAD')).toBe(head);
  expect(await p.engine.mergeState()).toBe(null);
  expect(fs.existsSync(path.join(p.dir, 'node_modules'))).toBe(false);
});

// ops (the IPC surface): inspectRepo = the preview, publishInto = the publish
const decode = e => JSON.parse(e.message.slice(e.message.indexOf('sq-git:') + 7));
const rejectsWith = async (p, code) => { const e = await p.then(() => null, x => x); expect(e, 'should reject').toBeTruthy(); expect(decode(e).code).toBe(code); return decode(e); };
const signedOut = { token: async () => null, user: async () => null, start: async () => { throw new Error('x'); }, cancel() {}, signOut: async () => {} };
const INFO = (over = {}) => ({ owner: 'o', repo: 'site', cloneUrl: 'https://github.com/o/site.git', htmlUrl: 'https://github.com/o/site',
  defaultBranch: 'master', private: false, archived: false, push: true, size: 1000, hasPages: false, ...over });
const fakeGithub = (over = {}) => ({ repo: async () => INFO(), tree: async () => ({ truncated: false, entries: [] }), text: async () => null,
  deployedBy: async () => null, ...over });
const ops = (github, extra = {}) => createGitContext({ auth: signedOut, http, github, ...extra });
const AT = { owner: 'o', repo: 'site' };

it('15/16/36. inspectRepo: counts against the work tree, the first removed paths, what leaves and stays, Astro or not, the host that deploys it', async () => {
  const dir = await tmp(); await write(dir, { 'src/pages/index.astro': 'new', 'src/new.astro': 'n' });
  const entries = [blob('src/pages/index.astro'), blob('src/components/WorkList.astro'), blob('.vscode/settings.json'), blob('.gitignore'),
    blob('node_modules/a.js'), blob('package.json'), { path: 'src', mode: '040000', type: 'tree', oid: 't' }];
  const ctx = ops(fakeGithub({ tree: async () => ({ truncated: false, entries }), deployedBy: async () => 'vercel',
    text: async (_o, _r, p) => (p === 'package.json' ? JSON.stringify({ dependencies: { react: '1' } }) : null) }));
  expect(await runGitOp(ctx, dir, 'inspectRepo', AT)).toEqual({ owner: 'o', repo: 'site', branch: 'master', private: false, large: false,
    empty: false, astro: false, changed: 1, added: 1, removed: ['package.json', 'src/components/WorkList.astro'], removedCount: 2,
    dropped: { node_modules: 1 }, kept: ['.gitignore', '.vscode/'], host: 'vercel', pagesWorkflow: null });
});

it('9/17/18/19. inspectRepo refuses archived, read-only, LFS, submodules and too-big trees — in the words the editor shows', async () => {
  const dir = await tmp(); await write(dir, { 'a.astro': 'a' });
  const cases = [
    [{ repo: async () => INFO({ archived: true }) }, 'repo-unsupported', 'site is archived on GitHub (read-only).'],
    [{ repo: async () => INFO({ push: false }) }, 'no-access', "You can't push to o/site."],
    [{ tree: async () => ({ truncated: true, entries: [] }) }, 'repo-unsupported', 'site has too many files to publish into.'],
    [{ tree: async () => ({ truncated: false, entries: [{ path: 'm', mode: '160000', type: 'commit', oid: 'c' }] }) }, 'repo-unsupported',
      "site uses Git submodules. Starquix can't publish into it yet."],
    [{ tree: async () => ({ truncated: false, entries: [blob('.gitattributes')] }), text: async () => '*.psd filter=lfs diff=lfs merge=lfs -text' },
      'repo-unsupported', "site stores files with Git LFS. Starquix can't publish into it yet."],
  ];
  for (const [over, code, message] of cases) expect((await rejectsWith(runGitOp(ops(fakeGithub(over)), dir, 'inspectRepo', AT), code)).message).toBe(message);
  for (const bad of [{ owner: 'o/x', repo: 'site' }, { owner: 'o', repo: '..' }, { owner: '', repo: 'site' }, { owner: 'o', repo: 'x'.repeat(101) }]) {
    await rejectsWith(runGitOp(ops(fakeGithub()), dir, 'inspectRepo', bad), 'invalid');
  }
});

it('14/20/37/38/39. inspectRepo: empty repo; its own Pages workflow → pages; Pages on without one → pages; nothing → null; large', async () => {
  const dir = await tmp(); await write(dir, { 'a.astro': 'a' });
  const run = over => runGitOp(ops(fakeGithub(over)), dir, 'inspectRepo', AT);
  expect(await run({ tree: async () => null })).toMatchObject({ empty: true, astro: true, changed: 0, removedCount: 0, kept: [], host: null });
  const wf = { tree: async () => ({ truncated: false, entries: [blob('.github/workflows/ci.yml'), blob('.github/workflows/sync-and-deploy.yml'), blob('package.json')] }),
    text: async (_o, _r, p) => (p.endsWith('sync-and-deploy.yml') ? 'uses: actions/deploy-pages@v4' : p === 'package.json' ? '{"devDependencies":{"astro":"^4"}}' : 'run: npm test') };
  expect(await run({ ...wf, repo: async () => INFO({ hasPages: true }), deployedBy: async () => 'vercel' }))
    .toMatchObject({ host: 'pages', pagesWorkflow: 'sync-and-deploy.yml', astro: true });
  expect(await run({ repo: async () => INFO({ hasPages: true }) })).toMatchObject({ host: 'pages', pagesWorkflow: null });
  expect(await run({})).toMatchObject({ host: null, astro: false });
  expect(await run({ repo: async () => INFO({ size: 372635 }) })).toMatchObject({ large: true });
});

it('E1/4/25/35. publishInto: saves the edits first, links the repo (one version on top, GitHub\'s dot-files kept) and returns where it went', async () => {
  const gh = await github(OWNER_SITE);
  const dir = await tmp(); await write(dir, { 'src/pages/index.astro': 'new', 'src/new.astro': 'n' });
  const ctx = ops(fakeGithub({ repo: async () => INFO({ cloneUrl: gh.url }) }));
  expect(await runGitOp(ctx, dir, 'publishInto', { ...AT, message: 'Publish site' }))
    .toEqual({ owner: 'o', repo: 'site', htmlUrl: 'https://github.com/o/site', wrote: true });
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ remote: gh.url, branch: 'master', changed: 0, ahead: 0, behind: 0 });
  const [top, ...older] = (await runGitOp(ctx, dir, 'history')).map(v => v.message);
  expect([top, older.sort()]).toEqual(['Publish from Starquix', ['GitHub v1', 'Publish site']]);
  expect(gh.git('log', '-1', '--format=%an <%ae>', 'master')).toBe('Starquix <noreply@starquix.app>'); // signed out here: the Starquix author
  expect(fs.existsSync(path.join(dir, '.vscode/settings.json'))).toBe(true);
});

it('2/9/27. publishInto refuses before saving or fetching: a project already on GitHub, an archived repo, a local branch named like GitHub\'s default', async () => {
  const dir = await tmp(); await write(dir, { 'a.astro': 'a' });
  const ctx = ops(fakeGithub({ repo: async () => INFO({ archived: true }) }));
  await rejectsWith(runGitOp(ctx, dir, 'publishInto', { ...AT, message: 'Publish site' }), 'repo-unsupported');
  expect(await runGitOp(ctx, dir, 'history')).toEqual([]); // nothing saved
  const engine = createEngine(dir, { http });
  await engine.save('one', author); await engine.createBranch('master'); await engine.switchBranch('main');
  const e = await rejectsWith(runGitOp(ops(fakeGithub()), dir, 'publishInto', AT), 'branch-taken');
  expect(e).toMatchObject({ branch: 'master', message: 'master is another branch in this project' });
  expect(fs.existsSync(path.join(dir, '.git/shallow'))).toBe(false); // nothing fetched
  await engine.setRemote('https://github.com/o/other.git');
  await rejectsWith(runGitOp(ops(fakeGithub()), dir, 'publishInto', AT), 'invalid');
});

it('17. LFS found in the fetched tip (GitHub moved since the preview) → refused; nothing pushed, nothing kept here', async () => {
  const gh = await github({ ...OWNER_SITE, '.gitattributes': '*.psd filter=lfs diff=lfs merge=lfs -text\n' });
  const p = await project();
  await rejectsWith(runGitOp(ops(fakeGithub({ repo: async () => INFO({ cloneUrl: gh.url }) })), p.dir, 'publishInto', AT), 'repo-unsupported');
  await untouched(p);
  expect(gh.git('log', '--format=%s', 'master')).toBe('GitHub v1');
});

it('31. GitHub answers 403 to the push (org OAuth restriction / access removed) → no-access; nothing changed here', async () => {
  const gh = await github(OWNER_SITE);
  const p = await project();
  const forbidden = { request: async req => (/git-receive-pack/.test(req.url)
    ? { url: req.url, method: req.method, statusCode: 403, statusMessage: 'Forbidden', headers: {}, body: (async function* () {})() }
    : http.request(req)) };
  const e = await rejectsWith(runGitOp(ops(fakeGithub({ repo: async () => INFO({ cloneUrl: gh.url }) }), { http: forbidden }), p.dir, 'publishInto', AT), 'no-access');
  expect(e.message).toBe("Starquix can't push to o/site.");
  await untouched(p);
});

// E5 / ledger 37: the repo's own Pages workflow stays the deployer.
it('37. a linked repo\'s own Pages workflow: status names it (never stale), setHost pages writes nothing, Publish changes never adds ours, status reads its runs', async () => {
  const gh = await github({ ...OWNER_SITE, '.github/workflows/sync-and-deploy.yml': 'jobs:\n  d:\n    steps:\n      - uses: actions/deploy-pages@v4\n' });
  const dir = await tmp(); await write(dir, { 'src/pages/index.astro': 'new' });
  const asked = [];
  const fake = fakeGithub({ repo: async () => INFO({ cloneUrl: gh.url }), defaultBranch: async () => 'master', pagesUrl: async () => 'https://o.github.io/site/',
    deployStatus: async (...a) => { asked.push(a.slice(3)); return { state: 'success', url: 'run' }; } });
  const enabled = [];
  const ctx = ops(fake, { pages: { enable: async a => { enabled.push(a.own); return false; } } });
  await runGitOp(ctx, dir, 'publishInto', { ...AT, message: 'Publish site' });
  await createEngine(dir, { http }).setRemote('https://github.com/o/site.git'); // a github.com remote, as in the app
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ pagesWorkflow: 'sync-and-deploy.yml', host: null });
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'pages', message: 'Update site' })).toEqual({ wrote: false });
  expect(enabled).toEqual([true]);
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ host: 'pages', pagesStale: false });
  await write(dir, { 'src/pages/index.astro': 'newer' });
  expect(await runGitOp(createGitContext({ auth: signedOut, http }), dir, 'status')).toMatchObject({ pagesStale: false, changed: 1 });
  expect(await runGitOp(ops(fake), dir, 'deployStatus')).toMatchObject({ state: 'success' });
  expect(asked).toEqual([['pages', 'sync-and-deploy.yml']]);
  await createEngine(dir, { http }).setRemote(gh.url); // back to the test server to push
  expect(await runGitOp(ctx, dir, 'publishChanges', { message: 'Update' })).toEqual({ wrote: false });
  expect(fs.existsSync(path.join(dir, '.github/workflows/starquix-pages.yml'))).toBe(false);
  await writePagesFiles(dir); // ours appearing next to theirs (an old setup) still never makes the project stale
  expect((await runGitOp(createGitContext({ auth: signedOut, http }), dir, 'status')).pagesWorkflow).toBe('sync-and-deploy.yml');
});

// E6 (owner, 2026-10-18): publish into a branch, review it on GitHub, merge = live.
it('E6/53. publishInto a NEW branch: the version sits on the default branch\'s tip, pushed as that branch; the live branch is untouched', async () => {
  const gh = await github(OWNER_SITE);
  const dir = await tmp(); await write(dir, { 'src/pages/index.astro': 'new' });
  const asked = [];
  const ctx = ops(fakeGithub({ repo: async () => INFO({ cloneUrl: gh.url }), branchExists: async (...a) => { asked.push(a); return false; } }));
  await runGitOp(ctx, dir, 'publishInto', { ...AT, message: 'Publish site', branch: 'starquix' });
  expect(asked).toEqual([['o', 'site', 'starquix']]);
  expect(gh.git('log', '-1', '--format=%s', 'master')).toBe('GitHub v1'); // the live branch: untouched
  expect(gh.git('log', '-1', '--format=%P', 'starquix').split(' ')[1]).toBe(gh.git('rev-parse', 'master')); // on top of its history
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ branch: 'starquix', remote: gh.url, changed: 0, ahead: 0, behind: 0 });
  // Naming the default branch is the default: no lookup.
  const again = await github(OWNER_SITE);
  const other = await tmp(); await write(other, { 'a.astro': 'a' });
  await runGitOp(ops(fakeGithub({ repo: async () => INFO({ cloneUrl: again.url }), branchExists: async () => { throw new Error('no lookup'); } })),
    other, 'publishInto', { ...AT, message: 'Publish site', branch: 'master' });
  expect(again.git('log', '-1', '--format=%s', 'master')).toBe('Publish from Starquix');
});

it('E6/54/55. a branch that already exists on GitHub (not the default) is refused; a bad name is invalid; nothing is saved', async () => {
  const dir = await tmp(); await write(dir, { 'a.astro': 'a' });
  const e = await rejectsWith(runGitOp(ops(fakeGithub({ branchExists: async () => true })), dir, 'publishInto', { ...AT, branch: 'dev', message: 'Publish site' }), 'branch-exists');
  expect(e.message).toBe('dev already exists on site. Pick a new branch name, or master.');
  for (const branch of ['', 'a..b', '-x', 'x.lock', 'a b', 'x/.y', 7]) {
    await rejectsWith(runGitOp(ops(fakeGithub()), dir, 'publishInto', { ...AT, branch, message: 'Publish site' }), 'invalid');
  }
  expect(await runGitOp(ops(fakeGithub()), dir, 'history')).toEqual([]);
});

// docs/plans/2026-10-20-publish-branch-selection-design.md B5: off the default branch, ours publishes the branch you're on
// (it used to refuse wrong-branch); the repo's own workflow still writes nothing and gets no site branch.
it('E6/56/B5. Pages off the default branch: ours makes it the site branch; the repo\'s own workflow writes nothing', async () => {
  const dir = await tmp(); await write(dir, { 'a.astro': 'a' });
  const engine = createEngine(dir, { http });
  await engine.save('one', author); await engine.setRemote('https://github.com/o/site.git'); await engine.createBranch('starquix');
  const enabled = [];
  const ctx = ops(fakeGithub({ defaultBranch: async () => 'main' }), { pages: { enable: async a => { enabled.push([a.own, a.branch, a.live]); return false; } } });
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'pages' })).toEqual({ wrote: false });
  await write(dir, { '.github/workflows/sync-and-deploy.yml': 'steps:\n  - uses: actions/deploy-pages@v4\n' });
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'pages', message: 'Update site' })).toEqual({ wrote: false });
  expect(enabled).toEqual([[false, 'starquix', 'main'], [true, null, null]]);
});
