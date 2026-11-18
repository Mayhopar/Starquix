import { describe, expect, it, vi } from 'vitest';
import { createGitClient, GitError, parseGitError, type GitDeps } from '../gitClient';

function deps(result: unknown = undefined, error?: unknown): GitDeps & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    flush: vi.fn(async () => { log.push('flush'); }),
    call: vi.fn(async (_id: string, op: string) => { log.push(`call:${op}`); if (error) throw error; return result; }),
    remirror: vi.fn(async () => { log.push('remirror'); }),
  };
}

describe('gitClient', () => {
  it('save drains the journal to disk BEFORE the IPC (a version never misses the last edit)', async () => {
    const d = deps('oid');
    expect(await createGitClient('p', d).save('Hero copy')).toBe('oid');
    expect(d.log).toEqual(['flush', 'call:save']);
    expect(d.call).toHaveBeenCalledWith('p', 'save', { message: 'Hero copy' });
  });

  it.each(['restore', 'switchBranch', 'discard', 'pull'] as const)('%s flushes first and re-mirrors disk → Dexie after', async op => {
    const d = deps({ conflicts: [] });
    const c = createGitClient('p', d);
    await (op === 'restore' ? c.restore('a'.repeat(40)) : op === 'switchBranch' ? c.switchBranch('main') : c[op]());
    expect(d.log).toEqual(['flush', `call:${op}`, 'remirror']);
  });

  it.each(['resolve', 'finish', 'abort'] as const)('%s re-mirrors after (no flush: the tree is mid-merge)', async op => {
    const d = deps();
    const c = createGitClient('p', d);
    await (op === 'resolve' ? c.resolve('a.astro', 'theirs') : c[op]());
    expect(d.log).toEqual([`call:${op}`, 'remirror']);
  });

  // docs/plans/2026-10-14-github-publish-design.md: only a (re)made Pages setup writes files — re-mirror only then.
  it('setHost and publishChanges flush first and re-mirror only when they wrote files; makePublic only calls', async () => {
    const wrote = deps({ wrote: true });
    await createGitClient('p', wrote).setHost('pages', 'Update site');
    expect(wrote.log).toEqual(['flush', 'call:setHost', 'remirror']);
    expect(wrote.call).toHaveBeenCalledWith('p', 'setHost', { host: 'pages', message: 'Update site' });
    const clean = deps({ wrote: false });
    const c = createGitClient('p', clean);
    await c.publishChanges('Update site'); await c.makePublic();
    expect(clean.log).toEqual(['flush', 'call:publishChanges', 'call:makePublic']);
    expect(clean.call).toHaveBeenCalledWith('p', 'publishChanges', { message: 'Update site' });
  });

  // docs/plans/2026-10-20-prepublish-type-check-design.md 28: main checks a copy of the folder — the last edit must be in it.
  it('typeCheck drains the journal first and never re-mirrors (it writes nothing into the folder)', async () => {
    const d = deps({ ran: true, errors: [], total: 0 });
    expect(await createGitClient('p', d).typeCheck()).toEqual({ ran: true, errors: [], total: 0 });
    expect(d.log).toEqual(['flush', 'call:typeCheck']);
  });

  // docs/plans/2026-10-20-publish-branch-selection-design.md: the switch saves your edits (flush first) and may write the
  // Pages files (re-mirror only then).
  it('pagesBranch flushes first and re-mirrors only when it wrote files', async () => {
    const wrote = deps({ wrote: true });
    await createGitClient('p', wrote).pagesBranch('debugging', 'Update site');
    expect(wrote.log).toEqual(['flush', 'call:pagesBranch', 'remirror']);
    expect(wrote.call).toHaveBeenCalledWith('p', 'pagesBranch', { branch: 'debugging', message: 'Update site' });
    const clean = deps({ wrote: false });
    await createGitClient('p', clean).pagesBranch('main', 'Update site');
    expect(clean.log).toEqual(['flush', 'call:pagesBranch']);
  });

  it('read-only and account ops neither flush nor re-mirror', async () => {
    const d = deps([]);
    const c = createGitClient('p', d);
    await c.history(); await c.branches(); await c.signIn(); await c.signOut(); await c.deployStatus(); await c.user();
    expect(d.log).toEqual(['call:history', 'call:branches', 'call:signIn', 'call:signOut', 'call:deployStatus', 'call:user']);
  });

  it('a failed op does not re-mirror and surfaces a typed GitError with extras', async () => {
    const d = deps(undefined, new Error(`Error invoking remote method 'sq:git': Error: sq-git:${JSON.stringify({ code: 'name-taken', message: 'site exists', suggestion: 'site-2' })}`));
    const e = await createGitClient('p', d).publish('site', true).catch(x => x);
    expect(e).toBeInstanceOf(GitError);
    expect(e).toMatchObject({ code: 'name-taken', message: 'site exists', extra: { suggestion: 'site-2' } });
    expect(d.log).toEqual(['flush', 'call:publish']);
  });

  // docs/plans/2026-10-16-cloudflare-one-click-design.md: main builds the folder on disk — drain the journal first; nothing rewrites it.
  it('cloudflarePublish drains the journal first and never re-mirrors; the other Cloudflare ops only call', async () => {
    const d = deps({ wrote: false });
    const c = createGitClient('p', d);
    await c.cloudflarePublish('My Site', 'Publish site');
    expect(d.call).toHaveBeenCalledWith('p', 'cloudflarePublish', { name: 'My Site', message: 'Publish site' });
    await c.cloudflareStatus(); await c.cloudflareConnect(); await c.cloudflareAccount('a1'); await c.cloudflareSearch('bakery');
    await c.cloudflareDomain('bakery.com', { price: '10.44', currency: 'USD', autoRenew: false }); await c.cloudflareDomain('mine.dev');
    await c.cloudflareDomain(null); await c.cloudflareDisconnect(); await c.cloudflareUnpublish();
    expect(d.log).toEqual(['flush', 'call:cloudflarePublish', 'call:cloudflareStatus', 'call:cloudflareConnect', 'call:cloudflareAccount',
      'call:cloudflareSearch', 'call:cloudflareDomain', 'call:cloudflareDomain', 'call:cloudflareDomain', 'call:cloudflareDisconnect', 'call:cloudflareUnpublish']);
    expect(d.call).toHaveBeenCalledWith('p', 'cloudflareAccount', { id: 'a1' });
    expect(d.call).toHaveBeenCalledWith('p', 'cloudflareSearch', { q: 'bakery' });
    expect(d.call).toHaveBeenCalledWith('p', 'cloudflareDomain', { domain: 'bakery.com', price: '10.44', currency: 'USD', autoRenew: false });
    expect(d.call).toHaveBeenCalledWith('p', 'cloudflareDomain', { domain: 'mine.dev' });
    expect(d.call).toHaveBeenCalledWith('p', 'cloudflareDomain', { domain: null });
  });

  it('Cloudflare errors keep the extras the panel needs (the new price, the file, the status)', async () => {
    const encoded = (payload: object) => new Error(`Error invoking remote method 'sq:git': Error: sq-git:${JSON.stringify(payload)}`);
    const e = await createGitClient('p', deps(undefined, encoded({ code: 'price-changed', message: 'The price changed', price: '11.00', currency: 'USD' })))
      .cloudflareDomain('bakery.com', { price: '10.44', currency: 'USD', autoRenew: false }).catch(x => x);
    expect(e).toMatchObject({ code: 'price-changed', extra: { price: '11.00', currency: 'USD' } });
    const big = await createGitClient('p', deps(undefined, encoded({ code: 'file-too-big', message: 'x', file: '/v.mp4' }))).cloudflarePublish('S', 'm').catch(x => x);
    expect(big).toMatchObject({ code: 'file-too-big', extra: { file: '/v.mp4' } });
  });

  // docs/plans/2026-10-18-publish-into-existing-repo-design.md: the preview reads the work tree (ledger 5); the publish
  // writes GitHub's kept files only when it says so; the repo list is an account call.
  it('inspectRepo drains the journal and never re-mirrors; publishInto drains first and re-mirrors only when it wrote; repos only calls', async () => {
    const reads = deps({ owner: 'o', repo: 'site', changed: 1 }); // a preview / repo list carries no `wrote`
    const r = createGitClient('p', reads);
    await r.repos(); await r.inspectRepo('o', 'site');
    expect(reads.log).toEqual(['call:repos', 'flush', 'call:inspectRepo']);
    expect(reads.call).toHaveBeenCalledWith('p', 'inspectRepo', { owner: 'o', repo: 'site' });
    const d = deps({ wrote: true });
    await createGitClient('p', d).publishInto('o', 'site', 'Publish site');
    expect(d.log).toEqual(['flush', 'call:publishInto', 'remirror']);
    expect(d.call).toHaveBeenCalledWith('p', 'publishInto', { owner: 'o', repo: 'site', message: 'Publish site' });
    await createGitClient('p', d).publishInto('o', 'site', 'Publish site', 'starquix'); // E6: a new branch
    expect(d.call).toHaveBeenLastCalledWith('p', 'publishInto', { owner: 'o', repo: 'site', message: 'Publish site', branch: 'starquix' });
    const clean = deps({ wrote: false });
    await createGitClient('p', clean).publishInto('o', 'site', 'Publish site');
    expect(clean.log).toEqual(['flush', 'call:publishInto']);
  });

  it('parseGitError: unencoded errors become code "error"', () => {
    expect(parseGitError(new Error('Stale instance lease'))).toMatchObject({ code: 'error', message: 'Stale instance lease' });
    expect(parseGitError('sq-git:{bad json')).toMatchObject({ code: 'error' });
  });
});
