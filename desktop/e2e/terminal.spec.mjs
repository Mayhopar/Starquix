// The Terminal tab (docs/plans/2026-10-27-mcp-terminal-design.md; its own tab since 2026-11-08): the project's shell runs
// in the project folder with the Starquix shims first on PATH, and a file written there reaches the project files (Dexie).
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fail, logs, launch, setupEnv, importFixture, win, homeEnv, launcherOf, runLauncher, survivors } from './helpers.mjs';
import { execFileSync } from 'node:child_process';

test.afterEach(async ({}, info) => { await fs.writeFile(info.outputPath('console.log'), logs.splice(0).join('\n')); });
const rowPaths = page => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('starquix'); open.onerror = () => reject(open.error);
  open.onsuccess = () => { const all = open.result.transaction('projectFiles').objectStore('projectFiles').getAll();
    all.onsuccess = () => { resolve(all.result.map(r => r.path)); open.result.close(); }; all.onerror = () => reject(all.error); };
}));
// Windows: PowerShell; elsewhere zsh. A home of its own: no developer rc files, the hook files land in temp/.starquix-mcp.
const shellEnv = temp => { const env = { ...setupEnv(temp), ...homeEnv(temp), SQ_QUIT_LOG: '1', ...(win ? {} : { SHELL: '/bin/zsh' }) }; delete env.STARQUIX_MCP_HOME; return env; };
const PROMPT = win ? 'PS ' : '%';
// The app quits with a live shell (Windows once hung here): time it; a hang is recorded with what is still running, then killed.
async function closeApp(app, temp) {
  if (!app) return true;
  const pid = app.process().pid; const t0 = Date.now();
  const closed = await Promise.race([app.close().then(() => true, () => true), new Promise(r => setTimeout(() => r(false), 60_000))]);
  logs.push(`[e2e] close ${closed ? 'took' : 'HUNG after'} ${Date.now() - t0} ms`);
  if (closed) return true;
  logs.push(`[e2e] still running: ${JSON.stringify(await survivors(temp).catch(e => String(e)))}`);
  try { if (win) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F']); else process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  return false;
}

test('T1: the Terminal tab = a shell in the project folder, shims first; an outside edit reaches the project files', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-terminal-'));
  const env = shellEnv(temp);
  // Windows: a stand-in claude further down PATH prints what the shim hands the real one.
  if (win) {
    const bin = path.join(temp, 'agent-bin'); await fs.mkdir(bin); await fs.writeFile(path.join(bin, 'claude.cmd'), '@echo off\r\necho SQ_AGENT %*\r\n');
    const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH'); env[key] = `${bin};${env[key]}`;
  }
  let app;
  try {
    let page; ({ app, page } = await launch(env));
    await importFixture(page, 'Terminal fixture');
    await page.getByTitle('Terminal', { exact: true }).click();
    const terminal = page.getByTestId('terminal-view');
    await expect(terminal.locator('.xterm-rows')).toContainText(PROMPT, { timeout: 30_000 }); // the shell's prompt
    // The app's colors, readable: the tokens are light-dark(), which once reached xterm as black on black.
    const colors = await terminal.evaluate(el => {
      const css = (node, prop) => getComputedStyle(node)[prop];
      const probe = el.appendChild(document.createElement('span')); probe.style.color = 'var(--color-bg)';
      const bg = css(probe, 'color'); probe.remove();
      const paint = c => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(); };
      // xterm 6 paints the theme background on its scrollable element.
      return { app: paint(bg), terminal: paint(css(el.querySelector('.xterm-scrollable-element'), 'backgroundColor')),
        text: paint(css(el.querySelector('.xterm-rows'), 'color')) };
    });
    expect(colors.terminal).toBe(colors.app);
    expect(colors.text).not.toBe(colors.terminal);
    await terminal.click();
    await page.keyboard.type(win ? `echo "SQ_$(6*7)"; $env:Path.Split(';')[0]; pwd\n` : 'echo SQ_$((6*7)); print -r -- $path[1]; pwd\n');
    await expect(terminal).toContainText('SQ_42', { timeout: 30_000 });
    await expect(terminal).toContainText(path.join(temp, '.starquix-mcp', 'shims'));
    await expect(terminal).toContainText(path.join(temp, 'projects'));
    if (win) { // the shim found the real claude past itself and put the Starquix server first
      await page.keyboard.type('claude hello\n');
      await expect(terminal).toContainText(`SQ_AGENT "--mcp-config=${path.join(temp, '.starquix-mcp', 'claude-mcp.json')}" hello`, { timeout: 30_000 });
    }
    await page.keyboard.type(win ? 'Set-Content src/pages/t.md "# from the terminal"\n' : 'echo "# from the terminal" > src/pages/t.md\n');
    await expect.poll(() => rowPaths(page), { timeout: 15_000 }).toContain('src/pages/t.md');
    // The relay came up with the shell and the editor paired: a first agent lists the full catalogue.
    const catalogue = path.join(temp, '.starquix-mcp', 'catalogue.json');
    await expect.poll(() => fs.readFile(catalogue, 'utf8').then(t => JSON.parse(t).tools.length, () => 0), { timeout: 30_000 }).toBeGreaterThan(1);
  } catch (error) { await fail(app, temp, info, error); }
  finally {
    // The relay outlives the app by design: stop the one this test started — first, because on Windows it inherited the
    // app's stdout/stderr pipes (handle inheritance) and Playwright's close() waits for those pipes to close.
    await runLauncher(launcherOf(temp), ['down'], { env }).catch(() => {});
    const quit = await closeApp(app, temp);
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 }); // the stopping relay still writes its identity
    if (!quit) throw new Error('The app did not quit within 60 s with a terminal open');
  }
});

test('T2: a hidden + reopened panel brings a TUI\'s screen back whole after a long session', async ({}, info) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-terminal-'));
  const env = shellEnv(temp);
  // Like Claude Code: ONE full frame, then cursor-relative diffs of the changed cells — ~640 KB, past any byte budget.
  await fs.writeFile(path.join(temp, 'tui.mjs'), [
    "process.stdout.write('┌────────────┐\\r\\n│ SQ-FRAME 0 │\\r\\n└────────────┘\\r\\n');",
    "let s = ''; for (let i = 1; i < 40000; i++) s += `\\x1b[2A\\r\\x1b[11C${i % 10}\\x1b[2B\\r`;",
    "process.stdout.write(s + 'SQ-DONE\\r\\n');"].join('\n'));
  let app;
  try {
    let page; ({ app, page } = await launch(env));
    await importFixture(page, 'Terminal fixture');
    const terminalTab = page.getByTitle('Terminal', { exact: true });
    await terminalTab.click();
    const terminal = page.getByTestId('terminal-view'); const rows = terminal.locator('.xterm-rows');
    await expect(rows).toContainText(PROMPT, { timeout: 30_000 });
    await terminal.click();
    await page.keyboard.type(`node "${path.join(temp, 'tui.mjs')}"\n`);
    await expect(rows).toContainText('SQ-DONE', { timeout: 30_000 });
    await expect(rows).toContainText('│ SQ-FRAME 9 │');
    const before = await rows.innerText();
    await page.screenshot({ path: info.outputPath('before.png') });
    await terminalTab.click(); // the second click closes the panel: the terminal view unmounts
    await expect(terminal).toHaveCount(0);
    await terminalTab.click();
    await expect(rows).toContainText('SQ-DONE', { timeout: 30_000 });
    await page.screenshot({ path: info.outputPath('after.png') });
    expect(await rows.innerText()).toBe(before);
  } catch (error) { await fail(app, temp, info, error); }
  finally {
    await runLauncher(launcherOf(temp), ['down'], { env }).catch(() => {}); // first: see T1
    const quit = await closeApp(app, temp);
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 });
    if (!quit) throw new Error('The app did not quit within 60 s with a terminal open');
  }
});
