// Owner 2026-11-04: an "exec" tile bounced in the Dock at every project open. npm sets process.title
// ('npm install'); on macOS libuv registers a titled process with LaunchServices, so each npm run the app
// spawns (site extras, the Astro upgrade) got a Dock tile. The preload makes the title a no-op.
import { describe, it, expect } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { NO_TITLE } from '../src/deps.mjs';

const run = promisify(execFile);
const names = async () => (await run('lsappinfo', ['list'])).stdout.split('\n').filter(l => /^\s*\d+\) "/.test(l)).map(l => l.replace(/^\s*\d+\) /, '').replace(/ ASN.*/, ''));
/** Starts a node child that sets the npm-style title, returns the LaunchServices entries it added. */
async function addedBy(args) {
  const before = new Set(await names());
  const child = spawn(process.execPath, [...args, '-e', "process.title='npm install-nt'; setTimeout(()=>{},3000)"], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  try {
    for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 250)); const added = (await names()).filter(n => !before.has(n) && n.includes('npm install-nt')); if (added.length) return added; }
    return [];
  } finally { child.kill(); }
}

describe('npm children never get a Dock tile', () => {
  it('the preload turns a title assignment into a no-op', async () => {
    const { stdout } = await run(process.execPath, ['--require', NO_TITLE, '-e', "process.title='npm install'; process.stdout.write(process.title)"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    expect(stdout).toBe('node');
  });
  it.runIf(process.platform === 'darwin')('macOS: a titled child registers with LaunchServices; with the preload it does not', async () => {
    expect(await addedBy([])).not.toEqual([]); // control: the bug is real on this machine
    expect(await addedBy(['--require', NO_TITLE])).toEqual([]);
  }, 20_000);
  it('every npm the app spawns carries the preload', () => {
    for (const file of ['deps.mjs', 'astro-upgrade.mjs']) {
      const text = fs.readFileSync(path.join(import.meta.dirname, '../src', file), 'utf8');
      expect(text.match(/NO_TITLE/g)?.length ?? 0, file).toBeGreaterThanOrEqual(2); // import/definition + the spawn
    }
  });
});
