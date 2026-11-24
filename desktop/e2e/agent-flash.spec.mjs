// Agent edits show on the canvas (docs/plans/2026-11-10-agent-canvas-flash-design.md):
// an outside write (an agent in the terminal) and a mutating MCP call ring what they
// changed with the chat's glow, which fades with the agent light; the user's own
// typing and a stylesheet-only change ring nothing.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BOOT, fail, logs, launch, setupEnv, importFixture, preview, select } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

test('agent edits ring on the canvas; the user\'s own edits and CSS do not', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-agent-flash-'));
  const env = { ...setupEnv(temp), HOME: temp }; delete env.STARQUIX_MCP_HOME; // the relay lives under this temp HOME
  const launcher = path.join(temp, '.starquix-mcp/bin/starquix-mcp');
  let app; let client;
  try {
    let page; ({ app, page } = await launch(env));
    await importFixture(page, 'Agent flash fixture');
    const frame = preview(page);
    const rings = page.locator('[data-sq-ai-glow]');
    await expect(frame.getByText('First editable paragraph', { exact: true })).toBeVisible({ timeout: BOOT });
    const projects = path.join(temp, 'projects');
    const root = path.join(projects, (await fs.readdir(projects)).find(d => d.startsWith('browser_')));
    const pageFile = path.join(root, 'src/pages/index.astro');
    await page.waitForTimeout(2_000); // the import's own writes settle
    await expect(rings).toHaveCount(0);

    // 1. An agent in the terminal edits the file: its section rings, then fades with the agent light.
    await fs.writeFile(pageFile, (await fs.readFile(pageFile, 'utf8')).replace('First editable paragraph', 'First paragraph, by an agent'));
    await expect(frame.getByText('First paragraph, by an agent', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(rings.first()).toBeVisible({ timeout: 3_000 });
    await page.screenshot({ path: info.outputPath('1-outside-write.png') });
    await expect(rings).toHaveCount(0, { timeout: 8_000 });

    // 2. The user types in the canvas: no ring.
    const second = frame.getByText('Second editable paragraph', { exact: true });
    await select(page, second);
    await expect(page.getByTestId('design-bar').getByText('P', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(frame.locator('[contenteditable="plaintext-only"]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(' typed');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await fs.readFile(pageFile, 'utf8')).includes('Second editable paragraph typed'), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(3_000);
    await expect(rings).toHaveCount(0);

    // 3. A stylesheet-only change: no element to point at, no ring.
    const css = path.join(root, 'src/styles/sq-variables.css');
    await fs.appendFile(css, '\n/* agent touched the styles */\n');
    await page.waitForTimeout(3_000);
    await expect(rings).toHaveCount(0);

    // 4. A mutating MCP call from a coding agent: its change rings too.
    const agentEnv = { ...process.env, HOME: temp }; delete agentEnv.ELECTRON_RUN_AS_NODE; delete agentEnv.STARQUIX_MCP_HOME;
    client = new Client({ name: 'e2e-agent', version: '0' });
    await client.connect(new StdioClientTransport({ command: launcher, args: [], env: agentEnv }));
    await expect.poll(async () => (await client.callTool({ name: 'starquix_status', arguments: {} })).content[0].text, { timeout: 30_000 }).toMatch(/^CONNECTED/);
    await page.waitForTimeout(4_500); // read calls (status) are not writes: nothing to ring
    await expect(rings).toHaveCount(0);
    const key = await frame.locator('h1').getAttribute('data-key');
    const r = await client.callTool({ name: 'update_element_by_key', arguments: { sourceKey: key, textContent: 'Heading via MCP' } });
    expect(r.isError).toBeFalsy();
    await expect(frame.locator('h1')).toHaveText('Heading via MCP');
    await expect(rings.first()).toBeVisible({ timeout: 3_000 });
    await page.screenshot({ path: info.outputPath('4-mcp-write.png') });
  } catch (error) { await fail(app, temp, info, error); }
  finally {
    await client?.close().catch(() => {});
    try { execSync(`"${launcher}" down`, { env: { ...process.env, HOME: temp }, timeout: 30_000 }); } catch { /* never started */ }
    await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true });
  }
});
