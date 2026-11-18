// Versions + GitHub through the real editor: a version restore and a pull conflict both land on
// disk AND on the canvas (docs/plans/2026-10-07-git-versions-plan.md Task 14). Versions and Publish are two windows
// (docs/plans/2026-10-20-publish-sheet-design.md); a repo is linked from Versions (Back up) or from Publish (a GitHub
// destination's repository rows). "GitHub" is the
// system git's http-backend (SQ_GIT_TEST_REMOTE switches main to a signed-in stub; never packaged).
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOT, preview, importFixture, fail, select, logs, launch, setupEnv, git } from './helpers.mjs';
import { bareRepo, startGitServer } from '../test/helpers/git-server.mjs';


test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

async function editHeading(page, from, to) {
  const frame = preview(page);
  const h1 = frame.getByRole('heading', { name: from });
  await expect(h1).toBeVisible({ timeout: BOOT });
  await select(page, h1);
  await expect(page.getByTestId('design-bar').getByText('H1', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(frame.locator('[contenteditable="true"]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(to);
  await page.keyboard.press('Escape');
}
async function openWindow(page, title) {
  // The Settings panel stays open until toggled (a canvas edit leaves it): clicking it again would close it.
  const button = page.getByTitle(title, { exact: true });
  if (!(await button.isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await button.click(); // the footer button (the window is closed)
  await expect(page.getByRole('dialog').getByText(title, { exact: true }).first()).toBeVisible(); // its own window (docs/plans/2026-10-20-publish-sheet-design.md S3)
}
const openVersions = page => openWindow(page, 'Versions');
async function saveVersion(page, message) {
  await page.getByLabel('Version message').fill(message);
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('changed-count')).toHaveText('All changes saved');
}
const closeVersions = page => page.getByRole('button', { name: 'Close' }).click();

test('G1: save → edit → save → restore the first version; disk and canvas go back', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-git-e2e-'));
  let app;
  try {
    let page; ({ app, page } = await launch(setupEnv(temp)));
    const id = await importFixture(page, 'Git Restore');
    const index = () => fs.readFile(path.join(temp, 'projects', id, 'src/pages/index.astro'), 'utf8');
    await expect(preview(page).getByRole('heading', { name: 'Release fixture' })).toBeVisible({ timeout: BOOT });

    await openVersions(page);
    await saveVersion(page, 'Original');
    await closeVersions(page);

    await editHeading(page, 'Release fixture', 'Edited title');
    await expect.poll(index, { timeout: 20_000 }).toContain('Edited title');
    await openVersions(page);
    await expect(page.getByTestId('changed-count')).toHaveText('1 unsaved change');
    await saveVersion(page, 'Edited');

    await page.getByText('Original', { exact: true }).hover();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('button', { name: 'Restore' }).last().click();
    await expect(page.getByText('Restore: Original', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await index()).toContain('>Release fixture<');
    await closeVersions(page);
    await expect(preview(page).getByRole('heading', { name: 'Release fixture' })).toBeVisible({ timeout: 30_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

test('G2: back up to GitHub → GitHub moves → local edit → Pull conflict → Theirs → Finish; canvas shows theirs', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-git-e2e-'));
  const remotes = path.join(temp, 'remotes'); await fs.mkdir(remotes);
  const server = await startGitServer(remotes);
  bareRepo(remotes, 'git-conflict');
  let app;
  try {
    const env = { ...setupEnv(temp), SQ_GIT_TEST_REMOTE: server.url('').replace(/\/$/, '') };
    let page; ({ app, page } = await launch(env));
    const id = await importFixture(page, 'Git Conflict');
    const files = path.join(temp, 'projects', id);
    const index = () => fs.readFile(path.join(files, 'src/pages/index.astro'), 'utf8');
    await expect(preview(page).getByRole('heading', { name: 'Release fixture' })).toBeVisible({ timeout: BOOT });

    await openVersions(page);
    await saveVersion(page, 'Base');
    // Versions → Back up → the repository rows (Versions' own sub-view); the host never changes (ux case 21).
    await page.getByRole('button', { name: 'Back up', exact: true }).click();
    await expect(page.getByLabel('Repository name')).toHaveValue('git-conflict');
    await page.getByRole('button', { name: 'Back up to GitHub' }).click();
    await expect(page.getByText('· Up to date')).toBeVisible({ timeout: 30_000 }); // back on the list, linked
    await closeVersions(page);
    expect((await git('-C', files, 'config', 'remote.origin.url')).trim()).toBe(server.url('git-conflict.git'));
    expect(await git('-C', files, 'config', 'starquix.host').catch(() => '')).toBe(''); // a backup sets no host

    // Someone else changes the same heading on "GitHub".
    const other = path.join(temp, 'other');
    const g = (...args) => git('-C', other, '-c', 'user.name=Other', '-c', 'user.email=o@x', ...args);
    await git('clone', '-q', server.url('git-conflict.git'), other);
    const theirsFile = path.join(other, 'src/pages/index.astro');
    await fs.writeFile(theirsFile, (await fs.readFile(theirsFile, 'utf8')).replace('Release fixture', 'Theirs title'));
    await g('commit', '-qam', 'Theirs'); await g('push', '-q');

    await editHeading(page, 'Release fixture', 'Mine title');
    await expect.poll(index, { timeout: 20_000 }).toContain('Mine title');
    await openVersions(page);
    await saveVersion(page, 'Mine');
    await page.getByRole('button', { name: 'Pull' }).click();
    const merge = page.getByRole('region', { name: 'Merge' });
    await expect(merge.getByText('src/pages/index.astro')).toBeVisible({ timeout: 30_000 });
    expect(await index()).not.toContain('<<<<<<<'); // Mine pre-applied: markers never reach the canvas
    await merge.getByRole('button', { name: 'Theirs' }).click();
    await expect.poll(index, { timeout: 20_000 }).toContain('Theirs title');
    await page.getByRole('button', { name: 'Finish merge' }).click(); // the footer holds the merge decision
    await expect(merge).toHaveCount(0, { timeout: 20_000 });
    expect((await git('-C', files, 'log', '-1', '--format=%P')).trim().split(' ')).toHaveLength(2);
    await page.getByRole('button', { name: 'Push' }).click();
    await expect(page.getByText('· Up to date')).toBeVisible({ timeout: 30_000 });
    await closeVersions(page);
    await expect(preview(page).getByRole('heading', { name: 'Theirs title' })).toBeVisible({ timeout: 30_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await server.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});

// docs/plans/2026-10-18-publish-into-existing-repo-design.md: the code-only path (was "GitHub only") is Versions → Back up →
// Use existing (docs/plans/2026-10-20-publish-sheet-design.md S2), through the real app.
test('G3: publish into an existing repo — the project goes on top of its history; its own dot-files stay, node_modules leaves', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-git-e2e-'));
  const remotes = path.join(temp, 'remotes'); await fs.mkdir(remotes);
  const server = await startGitServer(remotes);
  // "GitHub": a site with history, a committed node_modules and editor settings (the owner's personal-site shape).
  const bare = path.join(remotes, 'my-site.git');
  await git('init', '--bare', '-q', '-b', 'main', bare);
  const seed = path.join(temp, 'seed');
  await fs.mkdir(path.join(seed, 'src/pages'), { recursive: true }); await fs.mkdir(path.join(seed, 'node_modules/x'), { recursive: true });
  await fs.mkdir(path.join(seed, '.vscode'));
  await fs.writeFile(path.join(seed, 'src/pages/old.astro'), '<h1>Old site</h1>\n');
  await fs.writeFile(path.join(seed, 'node_modules/x/index.js'), 'module.exports = 1;\n');
  await fs.writeFile(path.join(seed, '.vscode/settings.json'), '{}\n');
  await fs.writeFile(path.join(seed, '.gitignore'), 'node_modules\n.env\n');
  const g = (...args) => git('-C', seed, '-c', 'user.name=Old', '-c', 'user.email=o@x', ...args);
  await g('init', '-q', '-b', 'main'); await g('add', '-A', '-f'); await g('commit', '-qm', 'Old site'); await g('push', '-q', bare, 'main');
  let app;
  try {
    const env = { ...setupEnv(temp), SQ_GIT_TEST_REMOTE: server.url('').replace(/\/$/, ''), SQ_GIT_TEST_REPOS: 'my-site' };
    let page; ({ app, page } = await launch(env));
    const id = await importFixture(page, 'Git Into');
    const files = path.join(temp, 'projects', id);
    await expect(preview(page).getByRole('heading', { name: 'Release fixture' })).toBeVisible({ timeout: BOOT });

    await openWindow(page, 'Versions');
    await page.getByRole('button', { name: 'Back up', exact: true }).click();
    await page.getByRole('button', { name: 'Use existing' }).click();
    await page.getByRole('radio', { name: 'e2e/my-site' }).click();
    await page.getByRole('button', { name: 'Use my-site' }).click(); // enabled once the preview is in
    // The stub's REST tree is empty (main.mjs), so the counts say "all new"; the git result below is the real check.
    await expect(page.getByTestId('into-preview').getByRole('textbox')).toHaveValue(/0 removed/); // the Changes field (Figma 2026-10-21)
    await expect(page.getByRole('radio', { name: 'main' })).toBeChecked(); // Publish to: the default branch
    await page.getByRole('button', { name: 'Back up into my-site' }).click();
    await expect(page.getByText('· Up to date')).toBeVisible({ timeout: 60_000 });

    const log = (await git('-C', bare, 'log', '--format=%s', 'main')).trim().split('\n');
    expect(log[0]).toBe('Publish from Starquix');
    expect(log).toContain('Old site');
    const tree = (await git('-C', bare, 'ls-tree', '-r', '--name-only', 'main')).trim().split('\n');
    expect(tree).toEqual(expect.arrayContaining(['.vscode/settings.json', '.gitignore', 'src/pages/index.astro']));
    expect(tree.filter(f => f.startsWith('node_modules/') || f === 'src/pages/old.astro')).toEqual([]);
    expect(await fs.readFile(path.join(files, '.vscode/settings.json'), 'utf8')).toBe('{}\n'); // GitHub's file landed in the project
    expect((await git('-C', files, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('main');
    expect((await git('-C', files, 'config', 'remote.origin.url')).trim()).toBe(server.url('my-site.git'));
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); await server.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 10 }); }
});
