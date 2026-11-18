// Probe driver: one isolated, invisible, focus-neutral Electron editor + helpers.
// Never touches the owner's app, profile, ports or relay: own SQ_USER_DATA / SQ_PROJECTS_ROOT / SQ_DOWNLOADS / STARQUIX_MCP_HOME under <temp>, an
// editor origin of its own, a relay identity on a free port; assertIsolated refuses a launch that could reach anything of the owner's.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

export const desktopRoot = path.resolve(import.meta.dirname, '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const preview = page => page.locator('iframe[title$=" preview"]:visible').first().contentFrame();

const OWNER_EDITOR_PORT = '3061'; // the owner's `npm run dev` editor
const OWNER_RELAY_PORT = 47821; // mcp/src/protocol.ts DEFAULT_RELAY_PORT: the owner's coding-agent relay
const ISOLATED = ['SQ_USER_DATA', 'SQ_PROJECTS_ROOT', 'SQ_DOWNLOADS', 'STARQUIX_MCP_HOME'];

/** The frontmost app's name; 'loginwindow' = locked screen (the hide/show trick would hang the page). */
export function frontApp() {
  try { return execFileSync('sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"']).toString().trim(); } catch { return ''; }
}

/** The environment of a probe launch: everything the app writes lives under `temp`; the probe switches are set exactly as asked, never inherited.
 *  An editor on `localhost` (a different SITE than the 127.0.0.1 canvas = its own renderer process, like the packaged starquix://app) needs
 *  SQ_DEV_EDITOR_LOCALHOST; SQ_PROBE_INVISIBLE keeps the app from ever taking focus (both: desktop/src/probe-mode.mjs, editor.mjs). */
export function probeEnv({ temp, editorUrl, hide = true, ipcLog = true, base = process.env }) {
  const env = { ...base, SQ_USER_DATA: path.join(temp, 'profile'), SQ_PROJECTS_ROOT: path.join(temp, 'projects'), SQ_DOWNLOADS: path.join(temp, 'downloads'),
    STARQUIX_MCP_HOME: path.join(temp, 'mcp-home'), SQ_UPDATE_FEED: 'off', SQ_EDITOR_URL: editorUrl };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [key, on] of [['SQ_IPC_LOG', ipcLog], ['SQ_PROBE_INVISIBLE', hide], ['SQ_DEV_EDITOR_LOCALHOST', new URL(editorUrl).hostname === 'localhost']]) {
    if (on) env[key] = '1'; else delete env[key];
  }
  return env;
}

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/** Relay isolation: the editor dials the identity's wsPort; without a daemon.json it falls back to 47821 = the OWNER's relay. Pre-write one on a free port. */
export async function writeRelayIdentity(temp) {
  const home = path.join(temp, 'mcp-home'); const file = path.join(home, 'daemon.json');
  await fs.mkdir(home, { recursive: true });
  let wsPort; do wsPort = await freePort(); while (wsPort === OWNER_RELAY_PORT);
  const token = randomBytes(12).toString('hex');
  await fs.writeFile(file, JSON.stringify({ token, wsPort, controlPort: 0 }), { mode: 0o600 });
  return { wsPort, token, file };
}

/** Throws unless this launch is walled off from the owner's app: its paths inside `temp`, `temp` clear of the owner's real data, an editor that is
 *  not the owner's dev editor, a relay on a port of its own that daemon.json pins. */
export function assertIsolated({ temp, env, editorUrl, wsPort, home = os.homedir() }) {
  const fail = why => { throw new Error(`probe isolation: ${why}`); };
  const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  const t = path.resolve(temp);
  const owner = { projects: path.join(home, 'Starquix'), 'relay home': path.join(home, '.starquix-mcp'), 'app profile': path.join(home, 'Library', 'Application Support', 'Starquix') };
  for (const [what, dir] of Object.entries(owner)) if (inside(dir, t) || inside(t, dir)) fail(`the temp dir ${t} overlaps the owner's ${what} (${dir})`);
  for (const key of ISOLATED) if (!env[key] || !inside(t, path.resolve(env[key]))) fail(`${key} is ${env[key] ?? 'unset'}, not inside the temp dir ${t}`);
  const url = new URL(editorUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.port) fail(`the editor must be http://localhost|127.0.0.1:<port>, got ${editorUrl}`);
  if (url.port === OWNER_EDITOR_PORT) fail(`the editor is on :${OWNER_EDITOR_PORT}, the owner's dev editor`);
  if (!Number.isInteger(wsPort) || wsPort < 1024) fail(`relay wsPort ${wsPort} is not a free port`);
  if (wsPort === OWNER_RELAY_PORT) fail(`relay wsPort is ${OWNER_RELAY_PORT}, the owner's relay`);
  const identity = path.join(env.STARQUIX_MCP_HOME, 'daemon.json');
  let pinned; try { pinned = JSON.parse(fsSync.readFileSync(identity, 'utf8')).wsPort; } catch { /* reported below */ }
  if (pinned !== wsPort) fail(`${identity} does not pin wsPort ${wsPort}`);
}

/**
 * Launch the unpacked app against `editorUrl` (the production bundle served by probe/bundle.mjs, or a vite dev server of THIS worktree).
 * Isolated profile + projects root + relay identity under `temp`. The window is invisible, click-through and never focused (SQ_PROBE_INVISIBLE).
 */
export async function startApp({ temp, editorUrl, hide = true, ipcLog = true }) {
  const { wsPort } = await writeRelayIdentity(temp);
  const env = probeEnv({ temp, editorUrl, hide, ipcLog });
  assertIsolated({ temp, env, editorUrl, wsPort });
  const front = frontApp();
  const app = await electron.launch({ args: [desktopRoot, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], env });
  const ipc = []; const mainLog = []; let buf = '';
  const onData = d => { buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) { if (l.startsWith('[sq-ipc] ')) { try { ipc.push(JSON.parse(l.slice(9))); } catch {} } else mainLog.push(`${Date.now()} ${l}`); } };
  app.process().stdout.on('data', onData);
  app.process().stderr.on('data', onData);
  const page = await app.firstWindow();
  const consoleLog = [];
  page.on('console', m => consoleLog.push({ at: Date.now(), type: m.type(), text: m.text(), where: m.location()?.url ?? '' }));
  page.on('pageerror', e => consoleLog.push({ at: Date.now(), type: 'pageerror', text: String(e.stack ?? e) }));
  await sleep(700);
  return { app, page, ipc, mainLog, consoleLog, front, frontAfter: frontApp() };
}

/** UI import of a fixture folder (same as desktop/e2e/helpers.mjs importFixture, no @playwright/test expect). */
export async function importProject(page, name, dir) {
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await page.getByTestId('import-folder-input').setInputFiles(dir);
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForURL(/\/editor\/browser_/, { timeout: 60_000 });
  return new URL(page.url()).pathname.split('/').pop();
}

/** Cmd-click deep select of a frame locator element (desktop/e2e/helpers.mjs select). */
export async function select(page, locator, offset = null) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('select: element has no box');
  const x = offset ? box.x + offset.x : box.x + box.width / 2; const y = offset ? box.y + offset.y : box.y + box.height / 2;
  await page.keyboard.down('Meta');
  try { await page.mouse.click(x, y); } finally { await page.keyboard.up('Meta'); }
}
