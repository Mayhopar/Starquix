import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'isomorphic-git/http/node';
import { createEngine } from '../src/git/engine.mjs';
import { createPages, ownPagesWorkflow, pagesFilesCurrent, workflowYaml, writePagesFiles } from '../src/git/pages.mjs';
import { bareRepo, startGitServer } from './helpers/git-server.mjs';

const at = { owner: 'oleg', repo: 'site' };

it('workflow: runs on every push but builds only the site branch (STARQUIX_PAGES_BRANCH, else the default; no branch baked in); configure-pages gives site + base; then the rebase', () => {
  const y = workflowYaml();
  expect(y.split('\n')[0]).toContain('STARQUIX_PAGES_BRANCH');
  expect(y).toContain('on:\n  push:\n  workflow_dispatch:\n');
  expect(y).toContain('if: github.ref_name == (vars.STARQUIX_PAGES_BRANCH || github.event.repository.default_branch)');
  expect(y).toContain('uses: actions/configure-pages@v6');
  expect(y).toContain('npx astro build --site "$SITE" ${BASE:+--base "$BASE"}');
  expect(y).toContain('SITE: ${{ steps.pages.outputs.origin }}');
  expect(y).toContain('BASE: ${{ steps.pages.outputs.base_path }}');
  expect(y).toContain('node .github/starquix/rebase.mjs dist "$BASE"');
  expect(y.indexOf('rebase.mjs')).toBeGreaterThan(y.indexOf('npx astro build'));
  expect(y.indexOf('rebase.mjs')).toBeLessThan(y.indexOf('upload-pages-artifact'));
  expect(y).toContain('actions/deploy-pages@v5');
  expect(y).toContain('url: ${{ steps.deployment.outputs.page_url }}');
});

it('workflow: every action is a Node 24 major (GitHub retired Node 20); no package cache (often no lockfile); dotfiles still deploy', () => {
  const y = workflowYaml();
  const node24 = { checkout: 5, 'setup-node': 5, 'configure-pages': 6, 'upload-pages-artifact': 5, 'deploy-pages': 5 };
  const used = [...y.matchAll(/uses: actions\/([\w-]+)@v(\d+)/g)];
  expect(used.map(m => m[1]).sort()).toEqual(Object.keys(node24).sort());
  for (const [, name, major] of used) expect(Number(major), name).toBeGreaterThanOrEqual(node24[name]);
  expect(y).toContain('package-manager-cache: false');
  expect(y).toContain('include-hidden-files: true');
});

const dirs = [];
const tmp = async () => { const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-git-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fsp.rm(d, { recursive: true, force: true }))); });
let root; let server;
beforeAll(async () => { root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sq-remote-')); server = await startGitServer(root); });
afterAll(async () => { await server.close(); await fsp.rm(root, { recursive: true, force: true }); });
const author = { name: 't', email: 't@t' };
const quiet = { pagesRule: async () => ({ mode: 'open' }), pagesBranch: async () => null, setPagesBranch: async () => {} };
const ON_MAIN = { branch: 'main', live: 'main' };

it('enable: turns Pages on FIRST, then writes starquix-pages.yml + rebase script (never the astro config), saves, pushes', async () => {
  const dir = await tmp(); const engine = createEngine(dir, { http });
  await fsp.writeFile(path.join(dir, 'astro.config.mjs'), 'export default defineConfig({});\n');
  await engine.save('one', author); await engine.setRemote(server.url(bareRepo(root, 'pages'))); await engine.push();
  const seen = [];
  const pages = createPages({ github: { ...quiet, enablePages: async (o, r) => {
    seen.push({ at: [o, r], head: (await engine.history())[0].message, files: fs.existsSync(path.join(dir, '.github')) });
  } } });
  expect(await pages.enable({ engine, ...at, author, ...ON_MAIN })).toBe(true);
  expect(seen).toEqual([{ at: ['oleg', 'site'], head: 'one', files: false }]);
  expect((await engine.history())[0].message).toBe('Enable GitHub Pages');
  expect(await engine.counts()).toEqual({ ahead: 0, behind: 0 });
  expect(await fsp.readFile(path.join(dir, '.github/workflows/starquix-pages.yml'), 'utf8')).toBe(workflowYaml());
  expect(fs.existsSync(path.join(dir, '.github/workflows/deploy.yml'))).toBe(false); // Astro's guide owns that name
  expect(await fsp.readFile(path.join(dir, '.github/starquix/rebase.mjs'), 'utf8'))
    .toBe(await fsp.readFile(new URL('../src/git/pages-rebase.mjs', import.meta.url), 'utf8'));
  expect(await fsp.readFile(path.join(dir, 'astro.config.mjs'), 'utf8')).toBe('export default defineConfig({});\n');
});

// Ledger 17: a private repo on the free plan is refused BEFORE anything is committed.
it('enable: a refused Pages commits and writes nothing', async () => {
  const dir = await tmp(); const engine = createEngine(dir, { http });
  await fsp.writeFile(path.join(dir, 'a'), '1'); await engine.save('one', author);
  const pages = createPages({ github: { ...quiet, enablePages: async () => { throw Object.assign(new Error('no'), { code: 'pages-unavailable' }); } } });
  await expect(pages.enable({ engine, ...at, author, ...ON_MAIN })).rejects.toMatchObject({ code: 'pages-unavailable' });
  expect((await engine.history()).map(v => v.message)).toEqual(['one']);
  expect(fs.existsSync(path.join(dir, '.github'))).toBe(false);
});

it('writePagesFiles reports whether it wrote and leaves identical files alone; pagesFilesCurrent tracks both files', async () => {
  const dir = await tmp();
  expect(await pagesFilesCurrent(dir)).toBe(false);
  expect(await writePagesFiles(dir)).toBe(true);
  const file = path.join(dir, '.github/workflows/starquix-pages.yml');
  const before = (await fsp.stat(file)).mtimeMs;
  await new Promise(r => setTimeout(r, 20));
  expect(await writePagesFiles(dir)).toBe(false);
  expect((await fsp.stat(file)).mtimeMs).toBe(before);
  expect(await pagesFilesCurrent(dir)).toBe(true);
  await fsp.rm(path.join(dir, '.github/starquix/rebase.mjs'));
  expect(await pagesFilesCurrent(dir)).toBe(false);
});

// docs/plans/2026-10-18-publish-into-existing-repo-design.md E5 / ledger 37 (the owner's PaulGrahamEssays: sync-and-deploy.yml)
it('ownPagesWorkflow: a workflow of the repo (not ours) that deploys Pages; CI-only workflows and ours never count', async () => {
  const dir = await tmp();
  expect(await ownPagesWorkflow(dir)).toBe(null); // no .github at all
  await writePagesFiles(dir);
  const wf = f => path.join(dir, '.github/workflows', f);
  await fsp.writeFile(wf('ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: npm test\n');
  expect(await ownPagesWorkflow(dir)).toBe(null);
  await fsp.writeFile(wf('sync-and-deploy.yaml'), 'jobs:\n  deploy:\n    steps:\n      - uses: withastro/action@v5\n      - uses: actions/deploy-pages@v4\n');
  expect(await ownPagesWorkflow(dir)).toBe('sync-and-deploy.yaml');
});

it('37. enable with the repo\'s own Pages workflow: Pages turned on, nothing written, saved or pushed', async () => {
  const dir = await tmp(); const engine = createEngine(dir, { http });
  await fsp.writeFile(path.join(dir, 'a'), '1'); await engine.save('one', author);
  const asked = [];
  const pages = createPages({ github: { enablePages: async (o, r) => { asked.push([o, r]); } } }); // own: no site-branch calls either
  expect(await pages.enable({ engine, ...at, author, own: true, ...ON_MAIN })).toBe(false);
  expect(asked).toEqual([['oleg', 'site']]);
  expect(fs.existsSync(path.join(dir, '.github'))).toBe(false);
  expect((await engine.history()).map(v => v.message)).toEqual(['one']); // no push either: there is no remote to push to
});

// docs/plans/2026-10-20-publish-branch-selection-design.md (ledger numbers in the names): GitHub's side of a site-branch switch.
function fakeGithub({ rule = { mode: 'list', list: [{ id: 1, name: 'main' }] }, picked = null, allow } = {}) {
  const log = [];
  return { log, pagesRule: async () => rule, pagesBranch: async () => picked,
    allowPages: async (_o, _r, b, create) => { if (allow) await allow(b); log.push(`allow:${b}${create ? ':create' : ''}`); },
    setPagesBranch: async (_o, _r, b) => { log.push(`var:${b}`); },
    disallowPages: async (_o, _r, id) => { log.push(`disallow:${id}`); } };
}
const site = (github, branch, live = 'main') => createPages({ github }).setSiteBranch({ ...at, branch, live });

it('14/B3. Show debugging here: allow it → the variable → drop main (exactly the site branch may deploy)', async () => {
  const gh = fakeGithub();
  await site(gh, 'debugging');
  expect(gh.log).toEqual(['allow:debugging', 'var:debugging', 'disallow:1']);
});

it('28/29. Back to main: allow main → the variable goes → drop debugging', async () => {
  const gh = fakeGithub({ rule: { mode: 'list', list: [{ id: 2, name: 'debugging' }] }, picked: 'debugging' });
  await site(gh, 'main');
  expect(gh.log).toEqual(['allow:main', 'var:null', 'disallow:2']);
});

it('1. already the site branch (the common case) → reads only, no writes', async () => {
  const gh = fakeGithub();
  await site(gh, 'main');
  expect(gh.log).toEqual([]);
});

it('19. a branch already listed is not added again; one allowed only by a wildcard leaves nothing to remove', async () => {
  const listed = fakeGithub({ rule: { mode: 'list', list: [{ id: 1, name: 'main' }, { id: 2, name: 'debugging' }] } });
  await site(listed, 'debugging');
  expect(listed.log).toEqual(['var:debugging', 'disallow:1']);
  const wild = fakeGithub({ rule: { mode: 'list', list: [{ id: 3, name: '*' }] } });
  await site(wild, 'x');
  expect(wild.log).toEqual(['allow:x', 'var:x']);
});

it('16. protected branches only → pages-protected before any write; the default branch still passes', async () => {
  const gh = fakeGithub({ rule: { mode: 'protected' }, picked: 'debugging' });
  await expect(site(gh, 'feature')).rejects.toMatchObject({ code: 'pages-protected', settingsUrl: 'https://github.com/oleg/site/settings/environments' });
  expect(gh.log).toEqual([]);
  await site(gh, 'main');
  expect(gh.log).toEqual(['var:null']);
});

it('17/18. no branch rule → only the variable; no environment yet → created with the branch (the default branch creates nothing)', async () => {
  const open = fakeGithub({ rule: { mode: 'open' } });
  await site(open, 'debugging');
  expect(open.log).toEqual(['var:debugging']);
  const missing = fakeGithub({ rule: { mode: 'missing' } });
  await site(missing, 'debugging');
  expect(missing.log).toEqual(['allow:debugging:create', 'var:debugging']);
  const onMain = fakeGithub({ rule: { mode: 'missing' } });
  await site(onMain, 'main');
  expect(onMain.log).toEqual([]);
});

it('15. a refused allow (not an admin) changes nothing', async () => {
  const gh = fakeGithub({ allow: async () => { throw Object.assign(new Error('Only an admin'), { code: 'pages-admin' }); } });
  await expect(site(gh, 'debugging')).rejects.toMatchObject({ code: 'pages-admin' });
  expect(gh.log).toEqual([]);
});

it('B5/38. enable sets the site branch once Pages is on and before any file is written', async () => {
  const dir = await tmp(); const engine = createEngine(dir, { http });
  await fsp.writeFile(path.join(dir, 'a'), '1'); await engine.save('one', author);
  await engine.setRemote(server.url(bareRepo(root, 'b5'))); await engine.push();
  const seen = [];
  const gh = { ...fakeGithub(), enablePages: async () => { seen.push('on'); },
    setPagesBranch: async (_o, _r, b) => { seen.push(`var:${b}:${fs.existsSync(path.join(dir, '.github'))}`); } };
  await createPages({ github: gh }).enable({ engine, ...at, author, branch: 'nnn', live: 'main' });
  expect(seen).toEqual(['on', 'var:nnn:false']);
  expect(fs.existsSync(path.join(dir, '.github/workflows/starquix-pages.yml'))).toBe(true);
});
