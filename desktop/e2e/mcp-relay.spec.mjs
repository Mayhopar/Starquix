// The coding-agent relay ships inside the app: the editor's connect prompt
// gets a command that runs the bundled CLI on the app's own runtime — no npm
// package, no Node install on the user's machine.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fail, logs, launch, setupEnv, importFixture, win, homeEnv, launcherOf } from './helpers.mjs';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });

test('M1: the app exposes a working command for its bundled relay', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-mcp-relay-'));
  let app;
  try {
    const appEnv = { ...setupEnv(temp), ...homeEnv(temp) }; delete appEnv.STARQUIX_MCP_HOME; // never touch the real ~/.starquix-mcp launcher
    let page; ({ app, page } = await launch(appEnv));
    const command = await page.evaluate(() => window.sqDesktop?.mcpCommand ?? null);
    expect(command).toBe(`"${launcherOf(temp)}"`); // the launcher: same command for sq and an MCP config
    // Exactly how an agent runs it: the bundled relay daemon starts and answers (Windows: cmd.exe runs the .cmd).
    const env = { ...process.env, ...homeEnv(temp) }; delete env.ELECTRON_RUN_AS_NODE;
    const shell = win ? undefined : '/bin/sh';
    const up = JSON.parse(execSync(`${command} up`, { env, shell, timeout: 60_000 }).toString());
    expect(up).toMatchObject({ daemon: 'running', paired: false });
    expect(up.code).toMatch(/\S+/);
    execSync(`${command} down`, { env, shell, timeout: 30_000 });
  } catch (error) { await fail(app, temp, info, error); }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }); }
});

test('M2: the prompt points the agent at the launcher; an agent that registered it pairs with the open project, no code pasted', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-mcp-connect-'));
  const env = { ...setupEnv(temp), ...homeEnv(temp) }; delete env.STARQUIX_MCP_HOME;
  const launcher = launcherOf(temp);
  let app; let client;
  try {
    let page; ({ app, page } = await launch(env));
    await importFixture(page, 'Agent connect fixture');
    await page.getByTitle('Terminal', { exact: true }).click(); // its bottom row carries the MCP light
    await page.getByRole('button', { name: /^MCP · / }).click();
    // Windows: agents spawn an .exe, never a .cmd, so the prompt names the app's runtime + env (desktop/src/agents.mjs server).
    const server = await page.evaluate(() => window.sqDesktop?.mcpServer ?? null);
    if (win) {
      expect(server).toMatchObject({ args: [expect.stringMatching(/starquix-mcp\.mjs$/)], env: { ELECTRON_RUN_AS_NODE: '1' } });
      await expect(page.getByTestId('mcp-prompt')).toContainText(JSON.stringify(server));
      await fs.stat(launcher); // the `sq` launcher: written on launch, not on a click
    } else {
      expect(server).toBeNull();
      await expect(page.getByTestId('mcp-prompt')).toContainText(`runs "${launcher}"`);
      expect((await fs.stat(launcher)).mode & 0o111).toBeTruthy(); // written on launch, not on a click
    }
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0); // not "Test connection"

    // Exactly what an agent that registered the launcher does: spawn the configured command over stdio — no code, no pairing step.
    const agentEnv = { ...process.env, ...homeEnv(temp) }; delete agentEnv.ELECTRON_RUN_AS_NODE; delete agentEnv.STARQUIX_MCP_HOME;
    client = new Client({ name: 'e2e-agent', version: '0' });
    await client.connect(new StdioClientTransport(win ? { command: server.command, args: server.args, env: { ...agentEnv, ...server.env } }
      : { command: launcher, args: [], env: agentEnv }));
    let status;
    await expect.poll(async () => { status = (await client.callTool({ name: 'starquix_status', arguments: {} })).content[0].text; return status; }, { timeout: 30_000 }).toMatch(/^CONNECTED/);
    expect(status).toContain('Agent connect fixture');
    // Paired before the project finished booting answers "still booting, retry": an agent retries, so does the test.
    await expect.poll(async () => { const project = await client.callTool({ name: 'get_project', arguments: {} }); return project.isError ? project.content[0].text : 'ok'; }, { timeout: 60_000 }).toBe('ok');
    await page.keyboard.press('Escape'); // the AI settings modal covers the footer on a small window (Windows CI: 1008x681)
    await expect(page.getByRole('button', { name: 'MCP · Connected' })).toBeVisible();
  } catch (error) { await fail(app, temp, info, error); }
  finally {
    await client?.close().catch(() => {});
    try { execSync(`"${launcher}" down`, { env: { ...process.env, ...homeEnv(temp) }, timeout: 30_000 }); } catch { /* never started */ }
    await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true });
  }
});
