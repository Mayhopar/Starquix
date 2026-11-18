// The "Starquix Test" app: THIS worktree's PRODUCTION editor bundle (the dev editor is 3-5x slower in React and would misjudge
// "instant") served on a stable localhost port, inside the unpacked Electron with its OWN profile (per worktree), projects folder and MCP home —
// the owner's real ~/Starquix, app and relay are never touched. The owner touches this before anything ships.
//   node desktop/probe/test-app.mjs        [SQ_TEST_EDITOR_PORT=3072] [SQ_TEST_HOME=<dir for the profile/projects/mcp-home>]
// The window takes focus while it launches. It stays up until the app is closed; Ctrl-C stops both.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureBundle, serveBundle } from './bundle.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const home = process.env.SQ_TEST_HOME ?? os.homedir();
const port = Number(process.env.SQ_TEST_EDITOR_PORT ?? 3072);
// One profile PER WORKTREE: Electron's single-instance lock is per userData, so two sessions sharing 'Starquix Test' made the second
// launch quit at once and pop the FIRST session's window instead (seen 2026-11-17). SQ_TEST_NAME overrides the whole name.
const name = process.env.SQ_TEST_NAME ?? `Starquix Test (${path.basename(root)})`;
const slug = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const profile = path.join(home, 'Library/Application Support', name);
const projects = path.join(home, `Starquix-Test-${path.basename(root)}`);
const mcpHome = path.join(home, `.starquix-mcp-${slug}`);

const { dir, hash, built } = await ensureBundle({ appDir: path.join(root, 'app'), lockFile: path.join(root, 'package-lock.json'), cacheRoot: path.join(os.tmpdir(), 'sq-test-app-bundles') });
const server = await serveBundle(dir, { port });
console.log(`[test-app] editor bundle ${hash} (${built ? 'built now' : 'cached'}) at ${server.url}`);

// Relay isolation: without a daemon.json in the MCP home the editor dials 47821 = the owner's real relay.
await fs.mkdir(mcpHome, { recursive: true });
const daemon = path.join(mcpHome, 'daemon.json');
if (!(await fs.access(daemon).then(() => true, () => false))) {
  const wsPort = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  await fs.writeFile(daemon, JSON.stringify({ token: randomBytes(12).toString('hex'), wsPort, controlPort: 0 }), { mode: 0o600 });
}

const env = { ...process.env, SQ_USER_DATA: profile, SQ_PROJECTS_ROOT: projects, STARQUIX_MCP_HOME: mcpHome, SQ_EDITOR_URL: server.url, SQ_DEV_EDITOR_LOCALHOST: '1', SQ_UPDATE_FEED: 'off' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, 'desktop/node_modules/.bin/electron'), ['.'], { cwd: path.join(root, 'desktop'), env, stdio: 'inherit' });
const stop = async code => { await server.close(); process.exit(code ?? 0); };
child.on('exit', stop);
process.on('SIGINT', () => { child.kill(); });
process.on('SIGTERM', () => { child.kill(); });
