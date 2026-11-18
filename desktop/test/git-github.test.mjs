import { expect, it } from 'vitest';
import { createGithub, parseRemote } from '../src/git/github.mjs';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function api(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`;
    calls.push({ key, init, body: init.body && JSON.parse(init.body) });
    const r = routes[key]; if (!r) throw new Error(`unexpected ${key}`);
    return typeof r === 'function' ? r() : r;
  };
  return { gh: createGithub({ fetch, token: async () => 'tok' }), calls };
}

it('every call carries bearer token, accept and API version headers', async () => {
  const { gh, calls } = api({ 'POST /user/repos': json({ owner: { login: 'o' }, name: 'site', clone_url: 'https://github.com/o/site.git', html_url: 'https://github.com/o/site' }, 201) });
  expect(await gh.createRepo({ name: 'site', private: true })).toEqual({ owner: 'o', repo: 'site', cloneUrl: 'https://github.com/o/site.git', htmlUrl: 'https://github.com/o/site' });
  expect(calls[0].body).toEqual({ name: 'site', private: true, auto_init: false });
  expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer tok', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' });
});

it('createRepo: 422 name exists → code name-taken with a suggestion', async () => {
  const { gh } = api({ 'POST /user/repos': json({ errors: [{ message: 'name already exists on this account' }] }, 422) });
  await expect(gh.createRepo({ name: 'site', private: true })).rejects.toMatchObject({ code: 'name-taken', suggestion: 'site-2' });
});

// Ledger 13/16: an EMPTY repo of the signed-in user (an interrupted publish, or one made on github.com) is adopted.
it('createRepo: an existing empty repo of the owner is adopted; one with commits is name-taken; other 422s are invalid', async () => {
  const repo = { owner: { login: 'o' }, name: 'site', clone_url: 'https://github.com/o/site.git', html_url: 'https://github.com/o/site' };
  const exists = json({ errors: [{ message: 'name already exists on this account' }] }, 422);
  const { gh, calls } = api({ 'POST /user/repos': exists,
    'GET /repos/o/site/commits?per_page=1': json({ message: 'Git Repository is empty.' }, 409), 'GET /repos/o/site': json(repo) });
  expect(await gh.createRepo({ name: 'site', private: false, owner: 'o' }))
    .toEqual({ owner: 'o', repo: 'site', cloneUrl: 'https://github.com/o/site.git', htmlUrl: 'https://github.com/o/site' });
  expect(calls.map(c => c.key)).toEqual(['POST /user/repos', 'GET /repos/o/site/commits?per_page=1', 'GET /repos/o/site']);
  const { gh: full } = api({ 'POST /user/repos': exists, 'GET /repos/o/site/commits?per_page=1': json([{ sha: 'x' }]) });
  await expect(full.createRepo({ name: 'site', private: true, owner: 'o' })).rejects.toMatchObject({ code: 'name-taken', suggestion: 'site-2' });
  const { gh: bad } = api({ 'POST /user/repos': json({ message: 'Repository creation failed.', errors: [{ message: 'name is too long (maximum is 100 characters)' }] }, 422) });
  await expect(bad.createRepo({ name: 'x', private: true, owner: 'o' })).rejects.toMatchObject({ code: 'invalid', message: 'name is too long (maximum is 100 characters)' });
});

it('defaultBranch (the only one Pages lets deploy) and pagesUrl (404 → null)', async () => {
  const { gh } = api({ 'GET /repos/o/r': json({ default_branch: 'main' }), 'GET /repos/o/r/pages': json({ html_url: 'https://o.github.io/r/' }) });
  expect(await gh.defaultBranch('o', 'r')).toBe('main');
  expect(await gh.pagesUrl('o', 'r')).toBe('https://o.github.io/r/');
  const { gh: off } = api({ 'GET /repos/o/r/pages': json({ message: 'Not Found' }, 404) });
  expect(await off.pagesUrl('o', 'r')).toBe(null);
});

it('makePublic: PATCH private:false', async () => {
  const { gh, calls } = api({ 'PATCH /repos/o/r': json({ private: false }) });
  await gh.makePublic('o', 'r');
  expect(calls[0].body).toEqual({ private: false });
});

it('signed out → code signed-out without calling GitHub', async () => {
  const gh = createGithub({ fetch: async () => { throw new Error('no call'); }, token: async () => null });
  await expect(gh.createRepo({ name: 'x', private: true })).rejects.toMatchObject({ code: 'signed-out' });
});

it('deployStatus (Netlify/Vercel) merges their commit statuses and check runs; failure > pending > success', async () => {
  const base = '/repos/o/r/commits/abc';
  const cases = [
    [{ statuses: [] }, { check_runs: [] }, { state: 'none', url: null }],
    [{ statuses: [{ context: 'Vercel', state: 'success', target_url: 'https://vercel/x' }] }, { check_runs: [] }, { state: 'success', url: 'https://vercel/x' }],
    [{ statuses: [{ context: 'Vercel', state: 'success', target_url: 'v' }] }, { check_runs: [{ app: { slug: 'vercel' }, status: 'in_progress', conclusion: null, html_url: 'p' }] }, { state: 'pending', url: 'p' }],
    [{ statuses: [{ context: 'Vercel – site', state: 'error', target_url: 'e' }] }, { check_runs: [{ app: { slug: 'vercel' }, status: 'completed', conclusion: 'success', html_url: 'p' }] }, { state: 'failure', url: 'e' }],
    [{ statuses: [] }, { check_runs: [{ app: { slug: 'vercel' }, status: 'completed', conclusion: 'failure', html_url: 'f' }] }, { state: 'failure', url: 'f' }],
  ];
  for (const [statuses, checks, want] of cases) {
    const { gh } = api({ [`GET ${base}/status`]: json(statuses), [`GET ${base}/check-runs`]: json(checks) });
    expect(await gh.deployStatus('o', 'r', 'abc', 'vercel')).toEqual(want);
  }
});

it('enablePages: 201 = on; 409 (already on, maybe built from a branch) → PUT build_type workflow; 403/422 = pages-unavailable', async () => {
  const { gh, calls } = api({ 'POST /repos/o/r/pages': json({}, 201) });
  await gh.enablePages('o', 'r');
  expect(calls.map(c => c.key)).toEqual(['POST /repos/o/r/pages']);
  expect(calls[0].body).toEqual({ build_type: 'workflow' });
  const { gh: on, calls: onCalls } = api({ 'POST /repos/o/r/pages': json({}, 409), 'PUT /repos/o/r/pages': json({}, 204) });
  await on.enablePages('o', 'r');
  expect(onCalls.map(c => c.key)).toEqual(['POST /repos/o/r/pages', 'PUT /repos/o/r/pages']);
  expect(onCalls[1].body).toEqual({ build_type: 'workflow' });
  for (const status of [403, 422]) {
    const { gh: g } = api({ 'POST /repos/o/r/pages': json({}, status) });
    await expect(g.enablePages('o', 'r')).rejects.toMatchObject({ code: 'pages-unavailable', settingsUrl: 'https://github.com/o/r/settings/pages' });
  }
});

// Ledger 21/30: Pages = OUR workflow's run (a project's own CI never counts); other hosts' reports never count.
it('deployStatus(host): Pages reads starquix-pages.yml runs; Netlify/Vercel only their own reports; GitHub only asks nothing', async () => {
  const runs = '/repos/o/r/actions/workflows/starquix-pages.yml/runs?head_sha=abc&per_page=1';
  const run = (status, conclusion) => json({ workflow_runs: [{ status, conclusion, html_url: 'https://github.com/o/r/actions/runs/1' }] });
  for (const [r, state] of [[run('in_progress', null), 'pending'], [run('completed', 'success'), 'success'],
    [run('completed', 'skipped'), 'none'], [run('completed', 'failure'), 'failure'], [run('completed', 'cancelled'), 'failure']]) {
    const { gh } = api({ [`GET ${runs}`]: r });
    expect(await gh.deployStatus('o', 'r', 'abc', 'pages')).toEqual({ state, url: 'https://github.com/o/r/actions/runs/1' });
  }
  const { gh: none } = api({ [`GET ${runs}`]: json({ message: 'Not Found' }, 404) }); // not registered yet
  expect(await none.deployStatus('o', 'r', 'abc', 'pages')).toEqual({ state: 'none', url: null });
  const base = '/repos/o/r/commits/abc';
  const mixed = { [`GET ${base}/status`]: json({ statuses: [
      { context: 'netlify/site/deploy-preview', state: 'success', target_url: 'https://app.netlify.com/sites/site/deploys/1' },
      { context: 'Vercel', state: 'failure', target_url: 'https://vercel.com/o/r/x' }] }),
    [`GET ${base}/check-runs`]: json({ check_runs: [{ app: { slug: 'github-actions' }, name: 'lint', status: 'in_progress', conclusion: null, html_url: 'ci' }] }) };
  const { gh: netlify } = api(mixed);
  expect(await netlify.deployStatus('o', 'r', 'abc', 'netlify')).toEqual({ state: 'success', url: 'https://app.netlify.com/sites/site/deploys/1' });
  const { gh: vercel } = api(mixed);
  expect(await vercel.deployStatus('o', 'r', 'abc', 'vercel')).toEqual({ state: 'failure', url: 'https://vercel.com/o/r/x' });
  const { gh: only, calls } = api({});
  expect(await only.deployStatus('o', 'r', 'abc', 'github')).toEqual({ state: 'none', url: null });
  expect(calls).toEqual([]);
});

it('deploymentUrl: the newest deployment the host created for the sha → its environment_url', async () => {
  const { gh } = api({
    'GET /repos/o/r/deployments?sha=abc&per_page=10': json([
      { id: 2, creator: { login: 'vercel[bot]' }, environment: 'Production' }, { id: 3, creator: { login: 'netlify[bot]' }, environment: 'Production' }]),
    'GET /repos/o/r/deployments/3/statuses?per_page=1': json([{ state: 'success', environment_url: 'https://site.netlify.app' }]) });
  expect(await gh.deploymentUrl('o', 'r', 'abc', 'netlify')).toBe('https://site.netlify.app');
  const { gh: empty } = api({ 'GET /repos/o/r/deployments?sha=abc&per_page=10': json([]) });
  expect(await empty.deploymentUrl('o', 'r', 'abc', 'vercel')).toBe(null);
});

it('404 on a repo call → repo-gone; 401 → signed-out', async () => {
  const { gh } = api({ 'GET /repos/o/r/commits/abc/status': json({}, 404), 'GET /repos/o/r/commits/abc/check-runs': json({}, 404) });
  await expect(gh.deployStatus('o', 'r', 'abc', 'netlify')).rejects.toMatchObject({ code: 'repo-gone' });
  const { gh: g2 } = api({ 'POST /repos/o/r/pages': json({}, 401) });
  await expect(g2.enablePages('o', 'r')).rejects.toMatchObject({ code: 'signed-out' });
});

it('parseRemote reads owner/repo from GitHub https urls only', () => {
  expect(parseRemote('https://github.com/o/site.git')).toEqual({ owner: 'o', repo: 'site' });
  expect(parseRemote('https://github.com/o/site')).toEqual({ owner: 'o', repo: 'site' });
  expect(parseRemote('http://127.0.0.1:9/x.git')).toBe(null);
  expect(parseRemote(null)).toBe(null);
});

// docs/plans/2026-10-18-publish-into-existing-repo-design.md (ledger numbers in the names)
const GH_REPO = (over = {}) => ({ owner: { login: 'o' }, name: 'site', clone_url: 'https://github.com/o/site.git', html_url: 'https://github.com/o/site',
  default_branch: 'master', private: false, archived: false, permissions: { push: true }, size: 372635, has_pages: true, pushed_at: '2025-02-06T21:49:54Z', ...over });

it('8/9/11. repos: the 100 most recently pushed you can push to (owner, collaborator, org member); archived and read-only ones are left out', async () => {
  const { gh, calls } = api({ 'GET /user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100': json([
    GH_REPO(), GH_REPO({ name: 'old', archived: true }), GH_REPO({ owner: { login: 'org' }, name: 'ro', permissions: { push: false } }),
    GH_REPO({ owner: { login: 'org' }, name: 'team', private: true })]) });
  expect(await gh.repos()).toEqual([{ owner: 'o', repo: 'site', private: false, pushedAt: '2025-02-06T21:49:54Z' },
    { owner: 'org', repo: 'team', private: true, pushedAt: '2025-02-06T21:49:54Z' }]);
  expect(calls).toHaveLength(1);
});

it('repo: what Publish into needs to know about one repository', async () => {
  const { gh } = api({ 'GET /repos/o/site': json(GH_REPO()) });
  expect(await gh.repo('o', 'site')).toEqual({ owner: 'o', repo: 'site', cloneUrl: 'https://github.com/o/site.git', htmlUrl: 'https://github.com/o/site',
    defaultBranch: 'master', private: false, archived: false, push: true, size: 372635, hasPages: true });
});

it('14/19. tree: GitHub\'s flat tree of a branch (truncated flag); an empty repo (409) → null', async () => {
  const { gh } = api({ 'GET /repos/o/site/git/trees/master?recursive=1': json({ truncated: false, tree: [
    { path: 'src', mode: '040000', type: 'tree', sha: 't1' }, { path: 'src/a.astro', mode: '100644', type: 'blob', sha: 'b1', size: 3 }] }) });
  expect(await gh.tree('o', 'site', 'master')).toEqual({ truncated: false, entries: [
    { path: 'src', mode: '040000', type: 'tree', oid: 't1' }, { path: 'src/a.astro', mode: '100644', type: 'blob', oid: 'b1' }] });
  const { gh: empty } = api({ 'GET /repos/o/site/git/trees/master?recursive=1': json({ message: 'Git Repository is empty.' }, 409) });
  expect(await empty.tree('o', 'site', 'master')).toBe(null);
});

it('16/17/37. text: a file at a branch (base64 contents API), null when it is not there', async () => {
  const { gh } = api({ 'GET /repos/o/site/contents/.github/workflows/deploy.yml?ref=master': json({ content: Buffer.from('uses: actions/deploy-pages@v4').toString('base64') }),
    'GET /repos/o/site/contents/.gitattributes?ref=master': json({ message: 'Not Found' }, 404) });
  expect(await gh.text('o', 'site', '.github/workflows/deploy.yml', 'master')).toBe('uses: actions/deploy-pages@v4');
  expect(await gh.text('o', 'site', '.gitattributes', 'master')).toBe(null);
});

it('36. deployedBy: the Vercel/Netlify bot behind the newest deployments, else null', async () => {
  const route = 'GET /repos/o/site/deployments?per_page=10';
  const { gh } = api({ [route]: json([{ creator: { login: 'github-actions[bot]' } }, { creator: { login: 'vercel[bot]' }, environment: 'Production – site' }]) });
  expect(await gh.deployedBy('o', 'site')).toBe('vercel');
  const { gh: n } = api({ [route]: json([{ creator: { login: 'netlify[bot]' } }]) });
  expect(await n.deployedBy('o', 'site')).toBe('netlify');
  const { gh: none } = api({ [route]: json([]) });
  expect(await none.deployedBy('o', 'site')).toBe(null);
});

it('37. deployStatus(pages) reads the repo\'s OWN Pages workflow when it has one', async () => {
  const { gh } = api({ 'GET /repos/o/r/actions/workflows/sync-and-deploy.yml/runs?head_sha=abc&per_page=1':
    json({ workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'run' }] }) });
  expect(await gh.deployStatus('o', 'r', 'abc', 'pages', 'sync-and-deploy.yml')).toEqual({ state: 'success', url: 'run' });
});

it('E6. branchExists: is that branch on GitHub (404 → no)', async () => {
  const { gh } = api({ 'GET /repos/o/site/branches/starquix': json({ name: 'starquix' }),
    'GET /repos/o/site/branches/feature/x': json({ message: 'Branch not found' }, 404) });
  expect(await gh.branchExists('o', 'site', 'starquix')).toBe(true);
  expect(await gh.branchExists('o', 'site', 'feature/x')).toBe(false);
});

// docs/plans/2026-10-20-publish-branch-selection-design.md (ledger numbers in the names)
const VAR = '/repos/o/r/actions/variables/STARQUIX_PAGES_BRANCH';
const ENV = '/repos/o/r/environments/github-pages';

it('B1. pagesBranch: the repository variable, 404 → null (the default branch)', async () => {
  const { gh } = api({ [`GET ${VAR}`]: json({ name: 'STARQUIX_PAGES_BRANCH', value: 'debugging' }) });
  expect(await gh.pagesBranch('o', 'r')).toBe('debugging');
  const { gh: unset } = api({ [`GET ${VAR}`]: json({ message: 'Not Found' }, 404) });
  expect(await unset.pagesBranch('o', 'r')).toBe(null);
});

it('B1. setPagesBranch: PATCH; not there yet → POST; null → DELETE (already gone is fine)', async () => {
  const { gh, calls } = api({ [`PATCH ${VAR}`]: json({}, 204) });
  await gh.setPagesBranch('o', 'r', 'debugging');
  expect(calls.map(c => [c.key, c.body])).toEqual([[`PATCH ${VAR}`, { name: 'STARQUIX_PAGES_BRANCH', value: 'debugging' }]]);
  const { gh: first, calls: made } = api({ [`PATCH ${VAR}`]: json({ message: 'Not Found' }, 404), 'POST /repos/o/r/actions/variables': json({}, 201) });
  await first.setPagesBranch('o', 'r', 'debugging');
  expect(made.map(c => [c.key, c.body])).toEqual([[`PATCH ${VAR}`, { name: 'STARQUIX_PAGES_BRANCH', value: 'debugging' }],
    ['POST /repos/o/r/actions/variables', { name: 'STARQUIX_PAGES_BRANCH', value: 'debugging' }]]);
  for (const status of [204, 404]) {
    const { gh: back, calls: gone } = api({ [`DELETE ${VAR}`]: json({}, status) });
    await back.setPagesBranch('o', 'r', null);
    expect(gone.map(c => c.key)).toEqual([`DELETE ${VAR}`]);
  }
});

it('B3/16–18. pagesRule: no environment → missing; no branch rule → open; protected → protected; a list → its branch entries', async () => {
  const { gh: missing } = api({ [`GET ${ENV}`]: json({ message: 'Not Found' }, 404) });
  expect(await missing.pagesRule('o', 'r')).toEqual({ mode: 'missing' });
  const { gh: open } = api({ [`GET ${ENV}`]: json({ name: 'github-pages', deployment_branch_policy: null }) });
  expect(await open.pagesRule('o', 'r')).toEqual({ mode: 'open' });
  const { gh: prot } = api({ [`GET ${ENV}`]: json({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }) });
  expect(await prot.pagesRule('o', 'r')).toEqual({ mode: 'protected' });
  const { gh: list } = api({ [`GET ${ENV}`]: json({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }),
    [`GET ${ENV}/deployment-branch-policies?per_page=100`]: json({ total_count: 3, branch_policies: [
      { id: 63751911, name: 'main', type: 'branch' }, { id: 2, name: 'v*', type: 'tag' }, { id: 3, name: 'old' }] }) });
  expect(await list.pagesRule('o', 'r')).toEqual({ mode: 'list', list: [{ id: 63751911, name: 'main' }, { id: 3, name: 'old' }] });
});

it('B3/15/18/19. allowPages: POST the branch (303 = already there); create = the environment with a branch list first; not an admin → pages-admin', async () => {
  const { gh, calls } = api({ [`POST ${ENV}/deployment-branch-policies`]: json({ id: 9, name: 'debugging' }) });
  await gh.allowPages('o', 'r', 'debugging');
  expect(calls.map(c => [c.key, c.body])).toEqual([[`POST ${ENV}/deployment-branch-policies`, { name: 'debugging', type: 'branch' }]]);
  const { gh: there } = api({ [`POST ${ENV}/deployment-branch-policies`]: json({}, 303) });
  await there.allowPages('o', 'r', 'debugging');
  const { gh: create, calls: made } = api({ [`PUT ${ENV}`]: json({}), [`POST ${ENV}/deployment-branch-policies`]: json({ id: 9 }) });
  await create.allowPages('o', 'r', 'debugging', true);
  expect(made.map(c => [c.key, c.body])).toEqual([[`PUT ${ENV}`, { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }],
    [`POST ${ENV}/deployment-branch-policies`, { name: 'debugging', type: 'branch' }]]);
  for (const status of [403, 404]) {
    const { gh: no } = api({ [`POST ${ENV}/deployment-branch-policies`]: json({ message: 'Must have admin rights to Repository.' }, status) });
    await expect(no.allowPages('o', 'r', 'debugging')).rejects.toMatchObject({ code: 'pages-admin',
      message: 'Only an admin of o/r can change the GitHub Pages branch.', settingsUrl: 'https://github.com/o/r/settings/environments' });
  }
  const { gh: limited } = api({ [`POST ${ENV}/deployment-branch-policies`]: json({ message: 'API rate limit exceeded for user ID 7.' }, 403) });
  await expect(limited.allowPages('o', 'r', 'debugging')).rejects.toMatchObject({ code: 'github', status: 403 });
});

it('B3/29. disallowPages: DELETE the entry; already gone is fine', async () => {
  for (const status of [204, 404]) {
    const { gh, calls } = api({ [`DELETE ${ENV}/deployment-branch-policies/63751911`]: json({}, status) });
    await gh.disallowPages('o', 'r', 63751911);
    expect(calls.map(c => c.key)).toEqual([`DELETE ${ENV}/deployment-branch-policies/63751911`]);
  }
});

it('12/22/28. dispatchPages: starts the workflow on a branch; refused → pages-not-started with the workflow page', async () => {
  const route = 'POST /repos/o/r/actions/workflows/starquix-pages.yml/dispatches';
  const { gh, calls } = api({ [route]: json({}, 204) });
  await gh.dispatchPages('o', 'r', 'debugging');
  expect(calls[0].body).toEqual({ ref: 'debugging' });
  for (const status of [404, 422]) {
    const { gh: no } = api({ [route]: json({ message: "Workflow does not have 'workflow_dispatch' trigger" }, status) });
    await expect(no.dispatchPages('o', 'r', 'debugging')).rejects.toMatchObject({ code: 'pages-not-started',
      message: "GitHub didn't start the build.", settingsUrl: 'https://github.com/o/r/actions/workflows/starquix-pages.yml' });
  }
});
