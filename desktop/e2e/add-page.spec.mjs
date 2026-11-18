// task-271: an agent's add_page switched the editor to the new page 80-150 ms
// before its file was on disk. The canvas asked for the route, got Astro's 404
// and kept it; add_page answered "switch pending" after its 5 s scan wait
// (8 of 8 runs here, with or without another write beside it). Page creation
// now resolves once the file is on disk.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BOOT, fail, logs, launch, setupEnv, importFixture, preview } from './helpers.mjs';

const RUNS = Number(process.env.SQ_ADD_PAGE_RUNS ?? 5);

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

test('an agent\'s add_page ends with the canvas on the new page, never on a 404', async ({}, info) => {
  test.setTimeout(300_000 + RUNS * 30_000);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-add-page-'));
  const env = { ...setupEnv(temp), HOME: temp }; delete env.STARQUIX_MCP_HOME; // the relay lives under this temp HOME
  const launcher = path.join(temp, '.starquix-mcp/bin/starquix-mcp');
  let app; let client;
  try {
    let page; ({ app, page } = await launch(env));
    await importFixture(page, 'Add page fixture');
    await expect(preview(page).getByText('First editable paragraph', { exact: true })).toBeVisible({ timeout: BOOT });
    await page.waitForTimeout(2_000); // the import's own writes settle
    // Every DOCUMENT the canvas asks the site for, with its status.
    const documents = [];
    page.on('response', r => {
      const q = r.request();
      if (q.resourceType() === 'document' && q.frame() !== page.mainFrame()) documents.push({ route: new URL(r.url()).pathname.replace(/\/$/, ''), status: r.status() });
    });
    const agentEnv = { ...process.env, HOME: temp }; delete agentEnv.ELECTRON_RUN_AS_NODE; delete agentEnv.STARQUIX_MCP_HOME;
    client = new Client({ name: 'e2e-agent', version: '0' });
    await client.connect(new StdioClientTransport({ command: launcher, args: [], env: agentEnv }));
    await expect.poll(async () => (await client.callTool({ name: 'starquix_status', arguments: {} })).content[0].text, { timeout: 30_000 }).toMatch(/^CONNECTED/);

    // task-266: an agent's check of another width moves the canvas there and back by itself
    // (the real frame must say when it is on that width, or the check times out).
    const key = await preview(page).getByText('First editable paragraph', { exact: true }).getAttribute('data-sq-source');
    const breakpoint = async () => JSON.parse((await client.callTool({ name: 'get_project', arguments: {} })).content[0].text).breakpoint;
    const home = await breakpoint(); const other = home === 'xl' ? 'base' : 'xl';
    const checked = await client.callTool({ name: 'verify_layout', arguments: { keys: [key], breakpoint: other } });
    expect(JSON.parse(checked.content[0].text)).toMatchObject({ success: true, breakpoint: other });
    expect(await breakpoint()).toBe(home);

    for (let i = 1; i <= RUNS; i++) {
      // Back to back, as the agent in the report did: a variable write, then the page.
      const [, added] = await Promise.all([
        client.callTool({ name: 'create_variable_collection', arguments: { name: `Brand ${i}` } }),
        client.callTool({ name: 'add_page', arguments: { page: { id: `page-${i}`, name: `Golf Club ${i}` } } }),
      ]);
      expect(added.isError, `run ${i}`).toBeFalsy();
      expect(added.content[0].text, `run ${i}`).toContain('switched to it');
      expect(documents.filter(d => d.route === `/golf-club-${i}`), `run ${i}`).toEqual([{ route: `/golf-club-${i}`, status: 200 }]);
      await expect(preview(page).locator('body'), `run ${i}`).not.toContainText('404');
    }

    // The editor's own Add Page still adds the row (it does not switch to it).
    await page.getByTestId('add-page-btn').click();
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[data-testid="page-item"] input')].map(input => input.value)), { timeout: 15_000 }).toContain('/new-page');
    await page.screenshot({ path: info.outputPath('pages.png') });
  } catch (error) { await fail(app, temp, info, error); }
  finally {
    await client?.close().catch(() => {});
    try { execSync(`"${launcher}" down`, { env: { ...process.env, HOME: temp }, timeout: 30_000 }); } catch { /* never started */ }
    await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true });
  }
});
