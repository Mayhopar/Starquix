// Shared Electron e2e helpers (runtime.spec + seamless.spec).
import { expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const root = path.resolve(import.meta.dirname, '..');
export const JSZip = createRequire(path.resolve(root, '../app/package.json'))('jszip');
export const BOOT = 120_000;
// Async on purpose: a spec's fake server (git http, Cloudflare API) runs in THIS process — a sync git call would block it.
export const git = async (...args) => (await promisify(execFile)('git', args)).stdout;
export const fixture = path.resolve(root, '../app/e2e/fixtures/release-project');
export const preview = page => page.locator('iframe[title$=" preview"]:visible').first().contentFrame();
export const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
export const win = process.platform === 'win32';
// Every process whose command line names this temp root (Astro children, esbuild): "<pid> <command line>" lines.
export const survivors = async temp => {
  const { execFileSync } = await import('node:child_process');
  const lines = win
    ? execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }']).toString().split(/\r?\n/)
    : execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n');
  return lines.filter(l => l.includes(temp) || /runner\.mjs/.test(l) && l.includes('desktop-spike'));
};
/** The relay launcher the app writes under <home>/.starquix-mcp (a .cmd on Windows). */
export const launcherOf = home => path.join(home, '.starquix-mcp', 'bin', win ? 'starquix-mcp.cmd' : 'starquix-mcp');
/** Runs the launcher the way a shell does (Node never runs a .cmd without cmd.exe). */
export const runLauncher = (launcher, args, options) =>
  promisify(execFile)(win ? 'cmd.exe' : launcher, win ? ['/d', '/c', launcher, ...args] : args, options);
/** A home of its own (os.homedir() reads USERPROFILE on Windows, HOME elsewhere). */
export const homeEnv = temp => ({ HOME: temp, USERPROFILE: temp });
export async function importFixture(page, name, dir = fixture) {
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await page.getByTestId('import-folder-input').setInputFiles(dir);
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(/\/editor\/browser_/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').pop();
}
export async function fail(app, temp, info, error) {
  await app?.windows()[0]?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (process.env.SQ_E2E_DUMP) await fs.cp(temp, process.env.SQ_E2E_DUMP, { recursive: true, filter: f => !f.includes('node_modules') && !f.includes('profile') }).catch(() => {});
  throw error;
}
export async function select(page, element) {
  await expect(page.locator('iframe[data-viewport]').first()).toHaveCSS('opacity', '1', { timeout: BOOT });
  const box = await element.boundingBox(); expect(box).not.toBeNull();
  await page.keyboard.down('ControlOrMeta');
  try { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
  finally { await page.keyboard.up('ControlOrMeta'); }
}
export const logs = [];
export async function launch(env) {
  // SQ_E2E_APP = a packaged executable: the same specs gate the release artifact.
  // A covered window keeps drawing (macOS occlusion pauses it): frame-level checks stay valid while the owner works.
  const switches = ['--disable-backgrounding-occluded-windows'];
  const app = await electron.launch(process.env.SQ_E2E_APP ? { executablePath: process.env.SQ_E2E_APP, args: switches, env } : { args: [root, ...switches], env });
  app.process().stderr.on('data', d => logs.push('[main] ' + d));
  app.process().stdout.on('data', d => logs.push('[main] ' + d));
  const page = await app.firstWindow();
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.stack));
  // Observe child state through the real preload (not a test-only endpoint).
  await page.addInitScript(() => {
    window.__desktopStates = [];
    window.addEventListener('DOMContentLoaded', () => window.sqDesktop?.onState(s => window.__desktopStates.push(s)), { once: true });
  });
  // …and in the document already loaded (addInitScript covers only later navigations).
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { if (!window.__desktopStates) { window.__desktopStates = []; window.sqDesktop?.onState(s => window.__desktopStates.push(s)); } });
  return { app, page };
}
/** Export through the real UI; main saves the blob download into SQ_DOWNLOADS. */
export async function exportZip(page, temp, info, name) {
  const dir = path.join(temp, 'downloads'); await fs.mkdir(dir, { recursive: true });
  const before = new Set(await fs.readdir(dir));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTitle('Export project', { exact: true }).click();
  let file;
  await expect.poll(async () => { file = (await fs.readdir(dir)).find(f => !before.has(f) && f.endsWith('.zip')); return !!file; }, { timeout: 60_000 }).toBe(true);
  // A finished download is renamed from its .crdownload; settle on stable bytes.
  let size = -1; await expect.poll(async () => { const s = (await fs.stat(path.join(dir, file))).size; const stable = s > 0 && s === size; size = s; return stable; }).toBe(true);
  await fs.copyFile(path.join(dir, file), info.outputPath(name));
  return JSZip.loadAsync(await fs.readFile(path.join(dir, file)));
}
export const running = page => page.evaluate(() => window.__desktopStates?.findLast(s => s.phase === 'running') ?? null);
export function setupEnv(temp) {
  // STARQUIX_MCP_HOME: an e2e launch must never repoint the developer's real ~/.starquix-mcp launcher at the test app.
  // SQ_UPDATE_FEED off: a packaged run (SQ_E2E_APP) never asks GitHub for releases (update-notifier.spec sets its own feed).
  const env = { ...process.env, SQ_USER_DATA: path.join(temp, 'profile'), SQ_PROJECTS_ROOT: path.join(temp, 'projects'), SQ_DOWNLOADS: path.join(temp, 'downloads'),
    STARQUIX_MCP_HOME: path.join(temp, 'mcp-home'), SQ_UPDATE_FEED: 'off' };
  delete env.ELECTRON_RUN_AS_NODE; return env;
}

