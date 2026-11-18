import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'isomorphic-git/http/node';
import { createHash } from 'node:crypto';
import { createGitContext, encodeError, GIT_OPS, runGitOp } from '../src/git/ops.mjs';
import { createEngine } from '../src/git/engine.mjs';
import { writePagesFiles } from '../src/git/pages.mjs';
import { bareRepo, startGitServer } from './helpers/git-server.mjs';

const dirs = [];
const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-git-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fsp.rm(d, { recursive: true, force: true }))); });
let root; let server;
beforeAll(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-remote-')); server = await startGitServer(root); });
afterAll(async () => { await server.close(); await fsp.rm(root, { recursive: true, force: true }); });
const decode = e => JSON.parse(e.message.slice(e.message.indexOf('sq-git:') + 7));
const rejectsWith = async (p, code) => { const e = await p.then(() => null, x => x); expect(e, 'should reject').toBeTruthy(); expect(decode(e).code).toBe(code); return decode(e); };
const signedOut = { token: async () => null, user: async () => null, start: async () => { throw new Error('x'); }, cancel() {}, signOut: async () => {} };

it('allowlist: exactly the planned ops; unknown op and non-object args are refused', async () => {
  expect(GIT_OPS.sort()).toEqual(['abort', 'branches', 'cloudflareAccount', 'cloudflareAddress', 'cloudflareConnect', 'cloudflareDisconnect',
    'cloudflareDomain', 'cloudflarePublish', 'cloudflareSearch', 'cloudflareStatus', 'cloudflareUnpublish', 'createBranch', 'deployStatus', 'disconnect', 'discard',
    'finish', 'history', 'inspectRepo', 'makePublic', 'pagesBranch', 'publish', 'publishChanges', 'publishInto', 'pull', 'push', 'refresh', 'repos', 'resolve', 'restore', 'save',
    'setHost', 'signIn', 'signInCancel', 'signInWait', 'signOut', 'status', 'switchBranch', 'typeCheck', 'user'].sort());
  const ctx = createGitContext({ auth: signedOut, http });
  const dir = await tmp();
  await rejectsWith(runGitOp(ctx, dir, 'constructor', {}), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'rm', {}), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'save', 'x'), 'invalid');
});

it('validates per-op args: message length, oid shape, side', async () => {
  const ctx = createGitContext({ auth: signedOut, http }); const dir = await tmp();
  await rejectsWith(runGitOp(ctx, dir, 'save', { message: '' }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'save', { message: 'x'.repeat(201) }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'restore', { oid: 'HEAD' }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'resolve', { path: 'a', side: 'both' }), 'invalid');
});

it('signed out: save uses the Starquix author; status carries remote/ahead/behind/user', async () => {
  const ctx = createGitContext({ auth: signedOut, http }); const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await runGitOp(ctx, dir, 'save', { message: 'one' });
  const [v] = await runGitOp(ctx, dir, 'history');
  expect(v.author).toBe('Starquix');
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ changed: 0, branch: 'main', remote: null, github: null,
    ahead: 1, behind: 0, user: null, merging: false });
  await rejectsWith(runGitOp(ctx, dir, 'save', { message: 'two' }), 'nothing');
});

it('signed in: author = GitHub identity; publish creates the repo, sets origin and pushes', async () => {
  const url = server.url(bareRepo(root, 'pub'));
  const created = [];
  const auth = { ...signedOut, token: async () => 'tok', user: async () => ({ login: 'oleg', name: null, email: null, id: 7 }) };
  const github = { createRepo: async a => { created.push(a); return { owner: 'oleg', repo: 'pub', cloneUrl: url, htmlUrl: 'h' }; } };
  const ctx = createGitContext({ auth, github, http }); const dir = await tmp();
  await rejectsWith(runGitOp(ctx, dir, 'publish', { name: 'pub' }), 'nothing');
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await runGitOp(ctx, dir, 'save', { message: 'one' });
  expect((await runGitOp(ctx, dir, 'history'))[0].author).toBe('oleg');
  expect(await runGitOp(ctx, dir, 'publish', { name: 'pub' })).toMatchObject({ owner: 'oleg', repo: 'pub' });
  expect(created).toEqual([{ name: 'pub', private: true, owner: 'oleg' }]); // owner: an empty repo of theirs is adopted
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ remote: url, ahead: 0, behind: 0 });
  await runGitOp(ctx, dir, 'disconnect');
  expect((await runGitOp(ctx, dir, 'status')).remote).toBe(null);
});

it('encodeError maps network failures to offline and git 401 to signed-out, keeping extras', () => {
  expect(decode(encodeError(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })))).toEqual({ code: 'offline', message: 'You are offline' });
  expect(decode(encodeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).code).toBe('offline');
  expect(decode(encodeError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).code).toBe('offline'); // a hung Cloudflare read
  expect(decode(encodeError(Object.assign(new Error('HTTP Error: 401'), { code: 'HttpError', data: { statusCode: 401 } }))).code).toBe('signed-out');
  expect(decode(encodeError(Object.assign(new Error('HTTP Error: 404'), { code: 'HttpError', data: { statusCode: 404 } }))).code).toBe('repo-gone');
  expect(decode(encodeError(Object.assign(new Error('taken'), { code: 'name-taken', suggestion: 'x-2' })))).toEqual({ code: 'name-taken', message: 'taken', suggestion: 'x-2' });
});

it('account ops are exactly the ones that skip the project lane', async () => {
  const { ACCOUNT_OPS } = await import('../src/git/ops.mjs');
  expect([...ACCOUNT_OPS].sort()).toEqual(['cloudflareAccount', 'cloudflareConnect', 'cloudflareDisconnect', 'cloudflareSearch',
    'repos', 'signIn', 'signInCancel', 'signInWait', 'signOut', 'user']);
});

it('typeCheck (docs/plans/2026-10-20-prepublish-type-check-design.md) is the site check of THIS project folder, in its lane', async () => {
  const seen = [];
  const ctx = createGitContext({ auth: signedOut, http, typeCheck: async d => { seen.push(d); return { ran: true, errors: [], total: 0 }; } });
  const dir = await tmp();
  expect(await runGitOp(ctx, dir, 'typeCheck', {})).toEqual({ ran: true, errors: [], total: 0 });
  expect(seen).toEqual([dir]);
});

// e2e G1: the first status on a never-versioned project raced git.init against counts()/remote()
// ("Could not find HEAD.") and the panel never loaded.
it('the first status on a never-versioned project succeeds', async () => {
  for (let i = 0; i < 5; i++) {
    const ctx = createGitContext({ auth: signedOut, http }); const dir = await tmp();
    await fsp.mkdir(path.join(dir, 'src/pages'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'src/pages/index.astro'), 'hi');
    expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ initialized: false, changed: 2, ahead: 0, remote: null });
  }
});

// docs/plans/2026-10-14-github-publish-design.md — host lives in .git/config (ledger 6: survives a restart).
it('setHost stores the host in the repo; a fresh context (app restart) still reads it', async () => {
  const ctx = createGitContext({ auth: signedOut, http }); const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await runGitOp(ctx, dir, 'save', { message: 'one' });
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ host: null, pagesStale: false });
  await rejectsWith(runGitOp(ctx, dir, 'setHost', { host: 'netlify' }), 'invalid'); // no remote yet
  await rejectsWith(runGitOp(ctx, dir, 'setHost', { host: 'vercel' }), 'invalid');
  await createEngine(dir, { http }).setRemote(server.url(bareRepo(root, 'host')));
  await rejectsWith(runGitOp(ctx, dir, 'setHost', { host: 'ftp' }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'setHost', { host: 'pages' }), 'invalid'); // Pages needs a GitHub remote
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'netlify' })).toEqual({ wrote: false });
  expect((await runGitOp(createGitContext({ auth: signedOut, http }), dir, 'status')).host).toBe('netlify');
});

const onGithub = async (ctx, dir) => {
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await runGitOp(ctx, dir, 'save', { message: 'one' });
  await createEngine(dir, { http }).setRemote('https://github.com/o/site.git');
};

it('setHost pages: saves pending edits as their OWN version first, then runs Pages enablement and stores the host', async () => {
  const ctx = createGitContext({ auth: signedOut, http, github: { defaultBranch: async () => 'main' },
    pages: { enable: async a => { ctx.enabled = [a.owner, a.repo]; return true; } } });
  const dir = await tmp(); await onGithub(ctx, dir);
  await fsp.writeFile(path.join(dir, 'b'), 'edit');
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'pages', message: 'Update site · now' })).toEqual({ wrote: true });
  expect(ctx.enabled).toEqual(['o', 'site']);
  expect((await runGitOp(ctx, dir, 'history'))[0].message).toBe('Update site · now');
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ host: 'pages', pagesStale: true }); // enable is stubbed: no files
});

// Owner live test 2026-10-14 (Mayhopar/new-project-test run 487b89e6) refused this as wrong-branch; since
// docs/plans/2026-10-20-publish-branch-selection-design.md (B5) the branch you're on becomes the site branch.
it('B5/38. setHost pages on a branch other than the GitHub default publishes that branch: it is the site branch', async () => {
  const ctx = createGitContext({ auth: signedOut, http, github: { defaultBranch: async () => 'main' },
    pages: { enable: async a => { ctx.enabled = { branch: a.branch, live: a.live, own: a.own }; return true; } } });
  const dir = await tmp(); await onGithub(ctx, dir);
  await runGitOp(ctx, dir, 'createBranch', { name: 'nnn' });
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'pages' })).toEqual({ wrote: true });
  expect(ctx.enabled).toEqual({ branch: 'nnn', live: 'main', own: false });
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ branch: 'nnn', host: 'pages' });
});

it('deployStatus: the live branch + Pages URL come from GitHub once and are cached; missing Pages files are stale', async () => {
  const asked = [];
  const ctx = createGitContext({ auth: signedOut, http, github: {
    defaultBranch: async () => { asked.push('branch'); return 'main'; },
    pagesBranch: async () => { asked.push('site'); return null; },
    pagesRule: async () => { asked.push('rule'); return { mode: 'list', list: [{ id: 1, name: 'main' }] }; },
    pagesUrl: async () => { asked.push('pages'); return 'https://o.github.io/site/'; },
    deployStatus: async () => { throw new Error('nothing pushed: no report to ask for'); } } });
  const dir = await tmp(); await onGithub(ctx, dir);
  await createEngine(dir, { http }).setConfig('starquix.host', 'pages');
  const want = { state: 'none', url: null, liveUrl: 'https://o.github.io/site/', liveBranch: 'main', defaultBranch: 'main', siteBlocked: false };
  expect(await runGitOp(ctx, dir, 'deployStatus')).toEqual(want);
  expect(await runGitOp(ctx, dir, 'deployStatus')).toEqual(want);
  expect(asked).toEqual(['branch', 'site', 'rule', 'pages']); // B1/48: the site branch and GitHub's rule are cached like the default branch
  expect((await runGitOp(ctx, dir, 'status')).pagesStale).toBe(true);
  await writePagesFiles(dir);
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ pagesStale: false, changed: 2 });
});

it('publish with a message saves pending edits first ("Publish site"), then creates the repo and pushes', async () => {
  const url = server.url(bareRepo(root, 'withmsg'));
  const ctx = createGitContext({ auth: signedOut, http, github: { createRepo: async () => ({ owner: 'o', repo: 'withmsg', cloneUrl: url, htmlUrl: 'h' }) } });
  const dir = await tmp();
  await runGitOp(ctx, dir, 'status');
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await runGitOp(ctx, dir, 'publish', { name: 'withmsg', private: false, message: 'Publish site' });
  expect((await runGitOp(ctx, dir, 'history')).map(v => v.message)).toEqual(['Publish site']);
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ changed: 0, ahead: 0, remote: url });
});

it('publishChanges: saves what changed and pushes; clean + pushed is a no-op; a Pages host re-ensures its files', async () => {
  const ctx = createGitContext({ auth: signedOut, http }); const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await rejectsWith(runGitOp(ctx, dir, 'publishChanges', { message: 'Update' }), 'invalid'); // no remote
  await runGitOp(ctx, dir, 'status'); // as the UI does: the first status initializes the repo
  const engine = createEngine(dir, { http });
  await engine.setRemote(server.url(bareRepo(root, 'changes')));
  expect(await runGitOp(ctx, dir, 'publishChanges', { message: 'Publish site' })).toEqual({ wrote: false });
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ changed: 0, ahead: 0 });
  await runGitOp(ctx, dir, 'publishChanges', { message: 'Update' });
  expect((await runGitOp(ctx, dir, 'history')).map(v => v.message)).toEqual(['Publish site']);
  await engine.setConfig('starquix.host', 'pages');
  await fsp.writeFile(path.join(dir, 'a'), '2');
  expect(await runGitOp(ctx, dir, 'publishChanges', { message: 'Update 2' })).toEqual({ wrote: true });
  expect(fs.existsSync(path.join(dir, '.github/workflows/starquix-pages.yml'))).toBe(true);
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ changed: 0, ahead: 0, pagesStale: false });
  expect(await runGitOp(ctx, dir, 'publishChanges', { message: 'Update 3' })).toEqual({ wrote: false });
});

// Cloudflare (docs/plans/2026-10-16-cloudflare-one-click-design.md): ledger numbers in the names.
const BUILT = [{ path: '/about/index.html', bytes: Buffer.from('<h1>About</h1>'), type: 'text/html; charset=utf-8' },
  { path: '/index.html', bytes: Buffer.from('<h1>Hi</h1>'), type: 'text/html; charset=utf-8' }];
const INDEX_HASH = createHash('sha256').update(Buffer.from('<h1>Hi</h1>')).digest('hex'); // "Live" = this page answers (ledger 20/61)
function fakeCloudflare(over = {}) {
  const log = []; const workers = new Map(); const domains = new Map(); let n = 0;
  const state = { connected: true, account: { id: 'a1', name: 'Mine' }, accounts: [{ id: 'a1', name: 'Mine' }], sub: 'oleg',
    reachable: true, buyState: 'succeeded', zoneActive: true, registration: null, conflict: false };
  return { log, workers, domains, state,
    connected: async () => state.connected,
    account: async () => state.account,
    accounts: async () => state.accounts,
    chooseAccount: async id => { log.push(`choose:${id}`); },
    connect: async () => { log.push('connect'); },
    signOut: async () => { log.push('signOut'); },
    scripts: async () => [...workers].map(([name, tag]) => ({ name, tag })),
    // A script's tag is its immutable id: a re-upload keeps it, a deleted-and-recreated script gets a new one.
    upload: async (a, name, files) => { if (!workers.has(name)) workers.set(name, `t${++n}`); log.push(`upload:${a}:${name}:${files.length}`); return workers.get(name); },
    subdomain: async () => state.sub,
    createSubdomain: async (_a, slug) => { log.push(`createSubdomain:${slug}`); state.sub = slug; return slug; },
    enableWorkersDev: async (_a, name) => { log.push(`workersDev:${name}`); },
    reachable: async (url, hash) => { log.push(`reach:${url}`); expect(hash).toBe(INDEX_HASH); return state.reachable; },
    search: async (_a, q) => { log.push(`search:${q}`); return [{ name: q, kind: 'buy', price: '10.44', renewal: '10.44', currency: 'USD' }]; },
    buy: async (_a, d, quote, autoRenew) => { log.push(`buy:${d}:${quote.price}:${quote.currency}:${autoRenew}`); return state.buyState; },
    registration: async () => state.registration,
    attach: async (_a, w, d) => {
      log.push(`attach:${w}:${d}`);
      if (state.conflict) throw Object.assign(new Error('x'), { code: 'domain-conflict' });
      if (!state.zoneActive) return 'pending';
      domains.set(d, w); return 'attached';
    },
    attached: async (_a, w, d) => domains.get(d) === w,
    unpublish: async (_a, w) => { log.push(`unpublish:${w}`); workers.delete(w); for (const [d, x] of domains) if (x === w) domains.delete(d); },
    ...over };
}
function cfCtx(cf, build = async () => BUILT) {
  const builds = [];
  const ctx = createGitContext({ auth: signedOut, http, cloudflare: cf, build: async dir => { builds.push(dir); return build(dir); } });
  return Object.assign(ctx, { builds });
}
const cfg = (dir, key) => createEngine(dir, { http }).config(key);
const PUBLISH = (message = 'Publish site') => ({ name: 'My Site', message });
const published = async (cf, ctx) => { const dir = await tmp(); await fsp.writeFile(path.join(dir, 'a'), '1'); await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH()); return dir; };

it('47/C7. setHost cloudflare needs no GitHub (the config write inits the repo); deployStatus answers none for it', async () => {
  const ctx = cfCtx(fakeCloudflare()); const dir = await tmp();
  expect(await runGitOp(ctx, dir, 'setHost', { host: 'cloudflare' })).toEqual({ wrote: false });
  expect(await cfg(dir, 'starquix.host')).toBe('cloudflare');
  await createEngine(dir, { http }).setRemote('https://github.com/o/site.git');
  expect(await runGitOp(ctx, dir, 'deployStatus')).toEqual({ state: 'none', url: null, liveUrl: null, liveBranch: null, defaultBranch: null, siteBlocked: false });
});

it('16/C6. first publish: saves the edits, builds, names the Worker after the project, stores account + name, uploads, stores tag + commit, turns workers.dev on', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  expect(await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH())).toEqual({ wrote: false });
  const [v] = await runGitOp(ctx, dir, 'history');
  expect(v.message.trim()).toBe('Publish site');
  expect(ctx.builds).toEqual([dir]);
  expect(cf.log).toEqual(['upload:a1:my-site:2', 'workersDev:my-site']);
  expect(await cfg(dir, 'starquix.host')).toBe('cloudflare');
  expect(await cfg(dir, 'starquix.cloudflareAccount')).toBe('a1');
  expect(await cfg(dir, 'starquix.cloudflareWorker')).toBe('my-site');
  expect(await cfg(dir, 'starquix.cloudflareTag')).toBe('t1');
  expect(await cfg(dir, 'starquix.cloudflarePublished')).toBe(v.oid);
  // Later: same Worker, overwritten in place; workers.dev left as the user set it.
  await fsp.writeFile(path.join(dir, 'a'), '2');
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(cf.log.slice(2)).toEqual(['upload:a1:my-site:2']);
  expect(await cfg(dir, 'starquix.cloudflareTag')).toBe('t1');
});

it('SEO D5. cloudflareAddress: the address the publish will serve, known before the build; the publish then uses that Worker', async () => {
  const cf = fakeCloudflare(); cf.state.sub = null; const ctx = cfCtx(cf); const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  expect(await runGitOp(ctx, dir, 'cloudflareAddress', { name: 'My Site' })).toEqual({ url: 'https://my-site.my-site.workers.dev' });
  expect(cf.log).toEqual(['createSubdomain:my-site']); // a new account gets its workers.dev subdomain here, once
  expect(ctx.builds).toEqual([]); // nothing built, saved or uploaded
  expect(await cfg(dir, 'starquix.cloudflareWorker')).toBe('my-site');
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH());
  expect(cf.log).toEqual(['createSubdomain:my-site', 'upload:a1:my-site:2', 'workersDev:my-site']);
  expect(await runGitOp(ctx, dir, 'cloudflareAddress', { name: 'My Site' })).toEqual({ url: 'https://my-site.my-site.workers.dev' });
  // A domain (even one still being set up) is the address, never the interim workers.dev one.
  await createEngine(dir, { http }).setConfig('starquix.cloudflareDomain', 'bakery.com');
  expect(await runGitOp(ctx, dir, 'cloudflareAddress', { name: 'My Site' })).toEqual({ url: 'https://bakery.com' });
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareAddress', { name: '' }), 'invalid');
});

it('C6. publish args are validated before anything is saved or built', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', { ...PUBLISH(), name: '' }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', { ...PUBLISH(), message: '' }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', { ...PUBLISH(), name: 'x'.repeat(1001) }), 'invalid');
  expect(ctx.builds).toEqual([]);
  expect(await runGitOp(ctx, dir, 'history')).toEqual([]);
});

it('8/11. no sign-in → cloudflare-signed-out; several accounts and none chosen → choose-account; nothing saved, nothing built', async () => {
  for (const [state, code] of [[{ connected: false, account: null }, 'cloudflare-signed-out'], [{ account: null }, 'choose-account']]) {
    const cf = fakeCloudflare(); Object.assign(cf.state, state); const ctx = cfCtx(cf); const dir = await tmp();
    await fsp.writeFile(path.join(dir, 'a'), '1');
    await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH()), code);
    expect(ctx.builds).toEqual([]);
    expect(await runGitOp(ctx, dir, 'history')).toEqual([]);
  }
});

it('21/23. a failed build keeps the saved version, uploads nothing and leaves the host alone; its code passes through', async () => {
  const cf = fakeCloudflare();
  const ctx = cfCtx(cf, async () => { throw Object.assign(new Error('Transform failed with 1 error: x'), { code: 'build-failed' }); });
  const dir = await tmp(); await fsp.writeFile(path.join(dir, 'a'), '1');
  expect(await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH()), 'build-failed')).toMatchObject({ message: 'Transform failed with 1 error: x' });
  expect(await runGitOp(ctx, dir, 'history')).toHaveLength(1);
  expect(cf.log).toEqual([]);
  expect(await cfg(dir, 'starquix.host')).toBe(null);
  const big = cfCtx(cf, async () => { throw Object.assign(new Error('/v.mp4 is over 25 MB'), { code: 'file-too-big', file: '/v.mp4' }); });
  expect(await rejectsWith(runGitOp(big, dir, 'cloudflarePublish', PUBLISH()), 'file-too-big')).toMatchObject({ file: '/v.mp4' });
});

it('17. a Worker with our name that is not ours is never overwritten: the slug gets a suffix', async () => {
  const cf = fakeCloudflare(); cf.workers.set('my-site', 'theirs'); const ctx = cfCtx(cf);
  const dir = await published(cf, ctx);
  const name = await cfg(dir, 'starquix.cloudflareWorker');
  expect(name).toMatch(/^my-site-[a-z0-9]{4}$/);
  expect(cf.workers.get('my-site')).toBe('theirs');
});

it('18. our Worker deleted on Cloudflare → recreated under the same name (workers.dev on again); replaced by someone else → a new name; no stored tag (killed mid-publish) → adopted', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  cf.workers.delete('my-site');
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(await cfg(dir, 'starquix.cloudflareWorker')).toBe('my-site');
  expect(cf.log.slice(-2)).toEqual(['upload:a1:my-site:2', 'workersDev:my-site']);

  cf.workers.set('my-site', 'someone-else');
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(await cfg(dir, 'starquix.cloudflareWorker')).toMatch(/^my-site-[a-z0-9]{4}$/);
  expect(cf.workers.get('my-site')).toBe('someone-else');

  const adopt = await tmp(); await fsp.writeFile(path.join(adopt, 'a'), '1');
  const e = createEngine(adopt, { http });
  await e.setConfig('starquix.cloudflareAccount', 'a1'); await e.setConfig('starquix.cloudflareWorker', 'half-done');
  cf.workers.set('half-done', 'tX');
  await runGitOp(ctx, adopt, 'cloudflarePublish', PUBLISH());
  expect(await cfg(adopt, 'starquix.cloudflareWorker')).toBe('half-done');
});

it('15. the stored Worker belongs to another account → not published here; publishing makes a new one in this account', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  cf.state.account = { id: 'a2', name: 'Work' }; cf.state.accounts = [cf.state.account];
  expect(await runGitOp(ctx, dir, 'cloudflareStatus')).toMatchObject({ connected: true, account: { id: 'a2' }, worker: null, published: false, domain: null });
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(await cfg(dir, 'starquix.cloudflareAccount')).toBe('a2');
  expect(cf.log.at(-2)).toMatch(/^upload:a2:my-site/);
});

it('19. an account without a workers.dev subdomain gets one named after the project before workers.dev is turned on', async () => {
  const cf = fakeCloudflare(); cf.state.sub = null; const ctx = cfCtx(cf);
  await published(cf, ctx);
  expect(cf.log).toEqual(['upload:a1:my-site:2', 'createSubdomain:my-site', 'workersDev:my-site']);
});

it('cloudflareStatus: not connected → empty, no .git; several accounts → the list; live → URL, reachable (true cached), published until the next save', async () => {
  const dir = await tmp();
  const off = fakeCloudflare(); off.state.connected = false;
  expect(await runGitOp(cfCtx(off), dir, 'cloudflareStatus')).toEqual({ connected: false, account: null, accounts: [], worker: null, published: false, domain: null, offline: null });
  expect(fs.existsSync(path.join(dir, '.git'))).toBe(false); // polled: never engine.status (it git-inits)
  const many = fakeCloudflare(); many.state.account = null; many.state.accounts = [{ id: 'a1', name: 'Mine' }, { id: 'a2', name: 'Work' }];
  expect(await runGitOp(cfCtx(many), dir, 'cloudflareStatus')).toMatchObject({ connected: true, account: null, accounts: many.state.accounts });

  const cf = fakeCloudflare(); cf.state.reachable = false; const ctx = cfCtx(cf); const site = await published(cf, ctx);
  expect(await runGitOp(ctx, site, 'cloudflareStatus')).toEqual({ connected: true, account: { id: 'a1', name: 'Mine' }, accounts: [],
    worker: { name: 'my-site', url: 'https://my-site.oleg.workers.dev', reachable: false }, published: true, domain: null, offline: null });
  cf.state.reachable = true;
  expect((await runGitOp(ctx, site, 'cloudflareStatus')).worker.reachable).toBe(true);
  const probes = cf.log.filter(l => l.startsWith('reach:')).length;
  await runGitOp(ctx, site, 'cloudflareStatus');
  expect(cf.log.filter(l => l.startsWith('reach:')).length).toBe(probes); // once reachable, never probed again
  await fsp.writeFile(path.join(site, 'a'), '2'); await runGitOp(ctx, site, 'save', { message: 'later' });
  expect((await runGitOp(ctx, site, 'cloudflareStatus')).published).toBe(false); // ledger 36
});

it('C8. cloudflareDomain: Buy carries the shown price + currency + auto-renew; without a price it NEVER buys (owned → attach only)', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'bakery.com', price: '10.44', currency: 'USD', autoRenew: false });
  expect(cf.log.slice(-2)).toEqual(['buy:bakery.com:10.44:USD:false', 'attach:my-site:bakery.com']);
  expect(await cfg(dir, 'starquix.cloudflareDomain')).toBe('bakery.com');
  const owned = await published(cf, ctx);
  await runGitOp(ctx, owned, 'cloudflareDomain', { domain: 'mine.dev' });
  expect(cf.log.filter(l => l.startsWith('buy:'))).toHaveLength(1);
  expect(cf.log.at(-1)).toBe(`attach:${await cfg(owned, 'starquix.cloudflareWorker')}:mine.dev`); // 45: its own Worker (my-site-xxxx)
});

it('69. cloudflareDomain validates the domain, price and currency, and needs a published Worker in this account', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await tmp();
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'bakery.com' }), 'invalid'); // nothing published
  const site = await published(cf, ctx);
  for (const bad of [{ domain: 'Bakery.com' }, { domain: 'bäkery.com' }, { domain: 'bakery' }, { domain: '-x.com' }, { domain: 'x'.repeat(250) + '.com' },
    { domain: 'bakery.com', price: '10,44', currency: 'USD' }, { domain: 'bakery.com', price: '10.44', currency: 'usd' },
    { domain: 'bakery.com', price: '10.44' }, { domain: 'bakery.com', price: '10.44', currency: 'USD', autoRenew: 'yes' }]) {
    await rejectsWith(runGitOp(ctx, site, 'cloudflareDomain', bad), 'invalid');
  }
  expect(cf.log.filter(l => l.startsWith('buy:') || l.startsWith('attach:'))).toEqual([]);
});

it('53–62. domain states: registering → confirm-email → setting-up (re-attached by the poll) → https → live; detached after live is never re-attached; failed; conflict; forget', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  const domainOf = async () => (await runGitOp(ctx, dir, 'cloudflareStatus')).domain;
  cf.state.buyState = 'in_progress';
  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'bakery.com', price: '10.44', currency: 'USD', autoRenew: true });
  expect(cf.log.at(-1)).toBe('buy:bakery.com:10.44:USD:true'); // 54: no attach while registering
  cf.state.registration = { state: 'in_progress', action: null, sentTo: null };
  expect(await domainOf()).toEqual({ name: 'bakery.com', state: 'registering', sentTo: null });
  cf.state.registration = { state: 'action_required', action: 'registrant_email_confirmation_pending', sentTo: 'a***@x.com' };
  expect(await domainOf()).toEqual({ name: 'bakery.com', state: 'confirm-email', sentTo: 'a***@x.com' });
  cf.state.registration = { state: 'succeeded', action: null, sentTo: null }; cf.state.zoneActive = false;
  expect(await domainOf()).toMatchObject({ state: 'setting-up' });
  cf.state.zoneActive = true; cf.state.reachable = false;
  expect(await domainOf()).toMatchObject({ state: 'https' }); // 58: the poll attached it
  expect(cf.domains.get('bakery.com')).toBe('my-site');
  cf.state.reachable = true;
  expect(await domainOf()).toEqual({ name: 'bakery.com', state: 'live', sentTo: null });
  cf.domains.delete('bakery.com');
  const attaches = cf.log.filter(l => l.startsWith('attach:')).length;
  expect(await domainOf()).toMatchObject({ state: 'detached' }); // 62
  expect(cf.log.filter(l => l.startsWith('attach:')).length).toBe(attaches);
  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'bakery.com' }); // Connect again: attach only
  expect(await domainOf()).toMatchObject({ state: 'live' });

  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: null }); // 56/66: forget (Cloudflare untouched)
  expect(await domainOf()).toBe(null);
  cf.state.buyState = 'in_progress';
  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'fail.com', price: '10.44', currency: 'USD', autoRenew: false });
  cf.state.registration = { state: 'failed', action: null, sentTo: null };
  expect(await domainOf()).toMatchObject({ name: 'fail.com', state: 'failed' });
  cf.state.registration = null; cf.state.conflict = true;
  expect(await domainOf()).toMatchObject({ state: 'conflict' }); // 59
});

it('50/69. cloudflareSearch: trimmed, lower-cased, spaces collapsed; accents/symbols → invalid-domain; empty → invalid; needs the account', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await tmp();
  expect(await runGitOp(ctx, dir, 'cloudflareSearch', { q: '  Bakery.COM ' })).toEqual([{ name: 'bakery.com', kind: 'buy', price: '10.44', renewal: '10.44', currency: 'USD' }]);
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareSearch', { q: 'bäckerei' }), 'invalid-domain');
  expect((await runGitOp(ctx, dir, 'cloudflareSearch', { q: ' My   Bakery ' }))[0].name).toBe('my bakery'); // keywords are fine
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareSearch', { q: '  ' }), 'invalid');
  cf.state.account = null;
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareSearch', { q: 'bakery' }), 'choose-account');
});

it('1/11/14. cloudflareConnect, cloudflareAccount and cloudflareDisconnect pass through to the account', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await tmp();
  await runGitOp(ctx, dir, 'cloudflareConnect');
  await runGitOp(ctx, dir, 'cloudflareAccount', { id: 'a1' });
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareAccount', { id: '' }), 'invalid');
  await runGitOp(ctx, dir, 'cloudflareDisconnect');
  expect(cf.log).toEqual(['connect', 'choose:a1', 'signOut']);
});

it('encodeError forwards the Cloudflare extras the editor needs (status, price, currency, file), never Cloudflare\'s errors', () => {
  const e = decode(encodeError(Object.assign(new Error('Cloudflare answered 403'), { code: 'cloudflare', status: 403, errors: [{ message: 'raw body' }] })));
  expect(e).toEqual({ code: 'cloudflare', message: 'Cloudflare answered 403', status: 403 });
  expect(decode(encodeError(Object.assign(new Error('The price changed'), { code: 'price-changed', price: '11.00', currency: 'USD' }))))
    .toEqual({ code: 'price-changed', message: 'The price changed', price: '11.00', currency: 'USD' });
});

// Final review (2026-10-16): each failed before its fix.
it('review 2. workers.dev failing on the first publish leaves the Worker untagged: the next publish adopts it and turns workers.dev on', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await tmp();
  const enable = cf.enableWorkersDev;
  cf.enableWorkersDev = async () => { throw Object.assign(new Error('Cloudflare is busy'), { code: 'rate-limited' }); };
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH()), 'rate-limited');
  expect(await cfg(dir, 'starquix.cloudflareTag')).toBe(null);
  expect(await cfg(dir, 'starquix.cloudflarePublished')).toBe(null);
  cf.enableWorkersDev = enable;
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(cf.log.slice(-2)).toEqual(['upload:a1:my-site:2', 'workersDev:my-site']);
  expect(await cfg(dir, 'starquix.cloudflareTag')).toBe('t1');
  // Recreated after a deletion, then the same failure: the old tag never makes the new Worker "someone else's".
  cf.workers.delete('my-site');
  cf.enableWorkersDev = async () => { throw Object.assign(new Error('x'), { code: 'offline' }); };
  await rejectsWith(runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site')), 'offline');
  cf.enableWorkersDev = enable;
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(await cfg(dir, 'starquix.cloudflareWorker')).toBe('my-site');
  expect(cf.log.at(-1)).toBe('workersDev:my-site');
});

it('review 9. PUT answers without a tag: ownership is not lost — the tag comes from the account list on the next publish', async () => {
  const cf = fakeCloudflare(); const upload = cf.upload;
  cf.upload = async (...args) => { await upload(...args); return null; }; // never a tag in the answer
  const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  expect(await cfg(dir, 'starquix.cloudflareTag')).toBe(null);
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Update site'));
  expect(await cfg(dir, 'starquix.cloudflareTag')).toBe('t1'); // ledger 18's "another tag → not ours" can fire again
});

it('review 3a. charged, then the attach fails (busy / offline): the purchase still lands — the domain is stored and the poll attaches it', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  const attach = cf.attach;
  cf.attach = async () => { throw Object.assign(new Error('Cloudflare is busy'), { code: 'rate-limited' }); };
  expect(await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'bakery.com', price: '10.44', currency: 'USD', autoRenew: false })).toEqual({ state: 'succeeded' });
  expect(await cfg(dir, 'starquix.cloudflareDomain')).toBe('bakery.com');
  cf.attach = attach; cf.state.reachable = false;
  expect((await runGitOp(ctx, dir, 'cloudflareStatus')).domain).toMatchObject({ name: 'bakery.com', state: 'https' });
});

it('review 6. a failing domain lookup never breaks the status read (the site + Publish changes stay); a sign-out still does', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'mine.dev' });
  cf.attached = async () => { throw Object.assign(new Error('Cloudflare answered 400'), { code: 'cloudflare', status: 400 }); };
  expect(await runGitOp(ctx, dir, 'cloudflareStatus')).toMatchObject({ worker: { name: 'my-site' }, published: true,
    domain: { name: 'mine.dev', state: 'unknown', sentTo: null } });
  cf.attached = async () => { throw Object.assign(new Error('x'), { code: 'cloudflare-signed-out' }); };
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareStatus'), 'cloudflare-signed-out');
});

// Unpublish (docs/plans/2026-10-16-cloudflare-one-click-design.md, ledger U2–U10).
it('U2–U4. unpublish takes the Worker down and keeps name + account + domain; Publish brings the same address back, the domain re-attaches', async () => {
  const cf = fakeCloudflare(); const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  await runGitOp(ctx, dir, 'cloudflareDomain', { domain: 'bakery.com', price: '10.44', currency: 'USD', autoRenew: false });
  expect((await runGitOp(ctx, dir, 'cloudflareStatus')).domain).toMatchObject({ state: 'live' });
  expect(await runGitOp(ctx, dir, 'cloudflareUnpublish')).toEqual({ wrote: false });
  expect(cf.log.at(-1)).toBe('unpublish:my-site');
  expect(await runGitOp(ctx, dir, 'cloudflareStatus')).toEqual({ connected: true, account: { id: 'a1', name: 'Mine' }, accounts: [],
    worker: null, published: false, domain: null, offline: 'https://my-site.oleg.workers.dev' });
  for (const k of ['tag', 'published', 'probe', 'attached']) expect(await cfg(dir, `starquix.cloudflare${k[0].toUpperCase()}${k.slice(1)}`)).toBe(null);
  expect(await cfg(dir, 'starquix.cloudflareWorker')).toBe('my-site');
  expect(await cfg(dir, 'starquix.cloudflareDomain')).toBe('bakery.com');
  await runGitOp(ctx, dir, 'cloudflarePublish', PUBLISH('Publish site'));
  expect(cf.log.slice(-2)).toEqual(['upload:a1:my-site:2', 'workersDev:my-site']); // recreated under the same name (U4)
  const back = await runGitOp(ctx, dir, 'cloudflareStatus');
  expect(back).toMatchObject({ worker: { name: 'my-site' }, published: true, offline: null });
  expect(back.domain).toMatchObject({ name: 'bakery.com', state: 'https' }); // the poll re-attached it (setup phase)…
  expect((await runGitOp(ctx, dir, 'cloudflareStatus')).domain).toMatchObject({ state: 'live' }); // …and it answers
  expect(cf.domains.get('bakery.com')).toBe('my-site');
});

it('U5/U8. an unpublish Cloudflare refuses changes nothing locally; nothing published on this account → invalid', async () => {
  const cf = fakeCloudflare({ unpublish: async () => { throw Object.assign(new Error('Cloudflare answered 403'), { code: 'cloudflare', status: 403 }); } });
  const ctx = cfCtx(cf); const dir = await published(cf, ctx);
  await rejectsWith(runGitOp(ctx, dir, 'cloudflareUnpublish'), 'cloudflare');
  expect(await runGitOp(ctx, dir, 'cloudflareStatus')).toMatchObject({ worker: { name: 'my-site' }, published: true, offline: null });
  await rejectsWith(runGitOp(ctx, await tmp(), 'cloudflareUnpublish'), 'invalid');
});


// docs/plans/2026-10-20-publish-branch-selection-design.md (ledger numbers in the names): which branch GitHub Pages shows.
let sites = 0;
/** A Pages project whose github.com remote is served by the local git server (the op needs a GitHub remote AND a push). */
async function pagesSite({ github = {}, pages = {} } = {}) {
  const url = server.url(bareRepo(root, `site${++sites}`));
  const viaServer = { request: o => http.request({ ...o, url: o.url.replace('https://github.com/o/site.git', url) }) };
  const log = [];
  const ctx = createGitContext({ auth: signedOut, http: viaServer,
    github: { defaultBranch: async () => 'main', pagesBranch: async () => null, pagesRule: async () => ({ mode: 'open' }), pagesUrl: async () => null, text: async () => 'workflow',
      deployStatus: async () => ({ state: 'pending', url: 'run' }), dispatchPages: async (_o, _r, ref) => { log.push(`dispatch:${ref}`); }, ...github },
    pages: { setSiteBranch: async a => { log.push(`site:${a.owner}/${a.repo}:${a.branch}:${a.live}`); }, ...pages } });
  const dir = await tmp();
  await fsp.writeFile(path.join(dir, 'a'), '1');
  await runGitOp(ctx, dir, 'save', { message: 'one' });
  const engine = createEngine(dir, { http: viaServer });
  await engine.setRemote('https://github.com/o/site.git');
  await engine.push();
  await engine.setConfig('starquix.host', 'pages');
  return { ctx, dir, engine, log };
}

it('10–14. Show <current> here: GitHub\'s side first, then the Pages files + the edits as one version + the push that builds it; again with nothing new → the workflow is started', async () => {
  const { ctx, dir, engine, log } = await pagesSite();
  await runGitOp(ctx, dir, 'createBranch', { name: 'debugging' });
  await fsp.writeFile(path.join(dir, 'a'), 'fixed grid');
  ctx.pages.setSiteBranch = async a => { log.push(`site:${a.branch}:${a.live}:${await engine.tip('refs/remotes/origin/debugging')}`); };
  expect(await runGitOp(ctx, dir, 'pagesBranch', { branch: 'debugging', message: 'Update site · now' })).toEqual({ wrote: true });
  expect(log).toEqual(['site:debugging:main:null']); // before the push: GitHub had no debugging yet (11)
  expect((await runGitOp(ctx, dir, 'history'))[0].message).toBe('Update site · now');
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ branch: 'debugging', changed: 0, ahead: 0, pagesStale: false });
  expect(await runGitOp(ctx, dir, 'pagesBranch', { branch: 'debugging', message: 'Update site · later' })).toEqual({ wrote: false });
  expect(log.slice(1)).toEqual(['site:debugging:main:' + await engine.tip('HEAD'), 'dispatch:debugging']); // 12
  expect((await runGitOp(ctx, dir, 'history'))[0].message).toBe('Update site · now');
});

it('9. after a switch the live view shows the new site branch without asking GitHub again', async () => {
  const asked = [];
  const { ctx, dir } = await pagesSite({ github: { pagesBranch: async () => { asked.push('site'); return null; } } });
  await runGitOp(ctx, dir, 'createBranch', { name: 'debugging' });
  await runGitOp(ctx, dir, 'pagesBranch', { branch: 'debugging', message: 'm' });
  expect(await runGitOp(ctx, dir, 'deployStatus')).toMatchObject({ state: 'pending', liveBranch: 'debugging', defaultBranch: 'main' });
  await runGitOp(ctx, dir, 'pagesBranch', { branch: 'main', message: 'm' });
  expect(await runGitOp(ctx, dir, 'deployStatus')).toMatchObject({ liveBranch: 'main', defaultBranch: 'main' });
  expect(asked).toEqual([]);
});

it('27/28. Back to main from another branch: main needs Starquix\'s workflow on GitHub; then GitHub\'s side + the workflow on main; your edits stay', async () => {
  const { ctx, dir, log } = await pagesSite({ github: { text: async () => null } });
  await runGitOp(ctx, dir, 'createBranch', { name: 'debugging' });
  await fsp.writeFile(path.join(dir, 'a'), 'wip');
  expect(await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: 'main', message: 'm' }), 'pages-not-set-up')).toMatchObject({ branch: 'main' });
  expect(log).toEqual([]);
  ctx.github.text = async (_o, _r, file, ref) => (file === '.github/workflows/starquix-pages.yml' && ref === 'main' ? 'yml' : null);
  expect(await runGitOp(ctx, dir, 'pagesBranch', { branch: 'main', message: 'm' })).toEqual({ wrote: false });
  expect(log).toEqual(['site:o/site:main:main', 'dispatch:main']);
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ branch: 'debugging', changed: 1 });
});

it('15/16. a refusal on GitHub (not an admin, protected only) saves, writes and pushes nothing', async () => {
  const { ctx, dir, engine } = await pagesSite({ pages: { setSiteBranch: async () => {
    throw Object.assign(new Error('Only an admin of o/site can change the GitHub Pages branch.'), { code: 'pages-admin', settingsUrl: 'https://github.com/o/site/settings/environments' }); } } });
  await runGitOp(ctx, dir, 'createBranch', { name: 'debugging' });
  await fsp.writeFile(path.join(dir, 'a'), 'edit');
  expect(await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: 'debugging', message: 'm' }), 'pages-admin'))
    .toMatchObject({ settingsUrl: 'https://github.com/o/site/settings/environments' });
  expect(await runGitOp(ctx, dir, 'status')).toMatchObject({ changed: 1 });
  expect(fs.existsSync(path.join(dir, '.github'))).toBe(false);
  expect(await engine.tip('refs/remotes/origin/debugging')).toBe(null);
});

it('6/24. pagesBranch refuses: another host, the repo\'s own Pages workflow, a branch that is neither yours nor the default, a merge in progress', async () => {
  const { ctx, dir, engine, log } = await pagesSite();
  await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: 'other', message: 'm' }), 'invalid');
  await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: '', message: 'm' }), 'invalid');
  await engine.setConfig('starquix.host', 'netlify');
  await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: 'main', message: 'm' }), 'invalid');
  await engine.setConfig('starquix.host', 'pages');
  await fsp.mkdir(path.join(dir, '.github/workflows'), { recursive: true });
  await fsp.writeFile(path.join(dir, '.github/workflows/deploy.yml'), 'steps:\n  - uses: actions/deploy-pages@v4\n');
  await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: 'main', message: 'm' }), 'invalid');
  await fsp.rm(path.join(dir, '.github'), { recursive: true });
  await fsp.writeFile(path.join(dir, '.git/sq-merge.json'), JSON.stringify({ ours: 'x', theirs: 'y', files: {} }));
  await rejectsWith(runGitOp(ctx, dir, 'pagesBranch', { branch: 'main', message: 'm' }), 'merging');
  expect(log).toEqual([]);
});

// Owner's personal-site, 2026-10-20 evening: the default branch became debugging while github-pages still listed only main —
// every deploy refused, and nothing in the view said why. Now deployStatus says so (ledger 48) and the switch repairs it.
it('48. GitHub does not let the site branch deploy → siteBlocked; a wildcard entry or no rule never alarms; the switch re-reads the rule', async () => {
  let rule = { mode: 'list', list: [{ id: 1, name: 'main' }] };
  const { ctx, dir } = await pagesSite({ github: { defaultBranch: async () => 'debugging', pagesRule: async () => rule } });
  expect(await runGitOp(ctx, dir, 'deployStatus')).toMatchObject({ liveBranch: 'debugging', defaultBranch: 'debugging', siteBlocked: true });
  await runGitOp(ctx, dir, 'createBranch', { name: 'debugging' });
  rule = { mode: 'list', list: [{ id: 1, name: 'main' }, { id: 2, name: 'debugging' }] }; // what the switch's allow did
  await runGitOp(ctx, dir, 'pagesBranch', { branch: 'debugging', message: 'm' });
  expect(await runGitOp(ctx, dir, 'deployStatus')).toMatchObject({ liveBranch: 'debugging', siteBlocked: false });
  for (const r of [{ mode: 'list', list: [{ id: 3, name: 'deb*' }] }, { mode: 'open' }, { mode: 'missing' }]) {
    const fresh = await pagesSite({ github: { defaultBranch: async () => 'debugging', pagesRule: async () => r } });
    expect((await runGitOp(fresh.ctx, fresh.dir, 'deployStatus')).siteBlocked).toBe(false);
  }
});
