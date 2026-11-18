import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fail, launch, logs, root, setupEnv } from './helpers.mjs';
test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

// Update notifier (docs/plans/2026-11-10-update-notifier-design.md) in the real app, against a local fake releases feed.
// Never clicks the button: that would open the developer's real browser (ProjectsPage.test.tsx covers the click).
test('a newer release with this machine\'s installer shows "Update to" on the Projects page', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-update-'));
  const requests = [];
  const feed = http.createServer((request, response) => {
    requests.push({ url: request.url, cookie: request.headers.cookie ?? null, agent: request.headers['user-agent'] });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([{ tag_name: 'v9.9.9', draft: false, prerelease: false,
      assets: ['Starquix-9.9.9-arm64.dmg', 'Starquix-9.9.9-x64.dmg', 'Starquix-Setup-9.9.9.exe'].map(name => ({ name })) }]));
  });
  await new Promise(resolve => feed.listen(0, '127.0.0.1', resolve));
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  let app;
  try {
    let page; ({ app, page } = await launch({ ...setupEnv(temp), SQ_UPDATE_FEED: `http://127.0.0.1:${feed.address().port}/releases` }));
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 60_000 });
    // The version is main's app.getVersion() (desktop/package.json), not app/package.json's.
    await expect(page.getByText(`Starquix ${version} © 2026`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update to 9.9.9', exact: true })).toBeVisible({ timeout: 30_000 });
    expect(requests.map(r => r.url)).toEqual(['/releases']); // one check, not one per window or reload
    // Privacy (ledger row 60): no cookies, and nothing in the User-Agent names the app, its version or Electron.
    expect(requests[0].cookie).toBeNull();
    expect(requests[0].agent).not.toMatch(/starquix|electron/i);
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close(); feed.close(); await fs.rm(temp, { recursive: true, force: true }); }
});
