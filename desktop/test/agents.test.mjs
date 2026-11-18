import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { launcherText, launcherCmd, cmdPath, encodeCode, createMcpHost } from '../src/agents.mjs';
import { encodePairingCode, decodePairingCode } from '../../mcp/src/protocol.ts';

const roots = [];
async function home() { const p = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-agents-')); roots.push(p); return p; }
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const read = async f => fs.readFile(f, 'utf8');
const win = process.platform === 'win32';

it('launcher runs the bundled relay on the app runtime, shell-safe for odd paths', () => {
  const text = launcherText("/Apps/It's $X.app/bin", '/R/mcp/starquix-mcp.mjs');
  expect(text).toMatch(/^#!\/bin\/sh\n/);
  expect(text).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/Apps/It'\\''s $X.app/bin' '/R/mcp/starquix-mcp.mjs' "$@"`);
});

it('the code mirrors mcp/src/protocol.ts', () => {
  expect(encodeCode(47821, 'ab'.repeat(12))).toBe(encodePairingCode(47821, 'ab'.repeat(12)));
});

function host(h, over = {}) {
  return { m: createMcpHost({ relayHome: path.join(h, '.starquix-mcp'), execPath: '/App/Starquix', script: '/App/mcp/starquix-mcp.mjs', platform: 'darwin', ...over }) };
}

it('code: creates daemon.json (0600, port 47821) once, keeps a relay-written identity, follows changes', async () => {
  const h = await home(); const { m } = host(h);
  const file = path.join(h, '.starquix-mcp', 'daemon.json');
  const code = m.code();
  expect(decodePairingCode(code).port).toBe(47821);
  if (!win) expect((await fs.stat(file)).mode & 0o777).toBe(0o600); // Windows has no mode bits
  expect(m.code()).toBe(code); // stable
  // A relay that started first on another port wrote its identity: the app follows it, fields preserved.
  const id = JSON.parse(await read(file));
  await fs.writeFile(file, JSON.stringify({ ...id, wsPort: 50001, lastProject: { projectId: 'p' } }));
  expect(decodePairingCode(m.code())).toEqual({ port: 50001, token: id.token });
  expect(JSON.parse(await read(file)).lastProject).toEqual({ projectId: 'p' });
  const rotated = m.rotate();
  expect(decodePairingCode(rotated).token).not.toBe(id.token);
  expect(decodePairingCode(rotated).port).toBe(50001);
});

it('refreshLauncher creates the launcher on launch (the prompt points agents at it) and repoints it when the app moved', async () => {
  const h = await home(); const launcher = path.join(h, '.starquix-mcp/bin/starquix-mcp');
  host(h).m.refreshLauncher();
  if (!win) expect((await fs.stat(launcher)).mode & 0o777).toBe(0o755);
  host(h, { execPath: '/Moved/Starquix' }).m.refreshLauncher();
  expect(await read(launcher)).toContain("'/Moved/Starquix'");
});

const fakeAgent = async (dir, name) => { await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n', { mode: 0o755 }); };

it('shell hook: shims 0755, zsh files, bashrc, opencode config; rewritten only when they differ', async () => {
  const h = await home(); const { m } = host(h); const relay = path.join(h, '.starquix-mcp');
  const hook = m.writeShellHook();
  expect(hook).toEqual({ shims: path.join(relay, 'shims'), zdotdir: path.join(relay, 'zsh'), bashrc: path.join(relay, 'bashrc'),
    opencode: JSON.stringify({ mcp: { starquix: { type: 'local', command: [m.launcher] } } }) });
  if (!win) for (const f of ['claude', 'codex']) expect((await fs.stat(path.join(hook.shims, f))).mode & 0o777).toBe(0o755);
  for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) expect(await read(path.join(hook.zdotdir, f))).toContain('SQ_USER_ZDOTDIR');
  const before = (await fs.stat(path.join(hook.shims, 'claude'))).mtimeMs;
  await new Promise(r => setTimeout(r, 20)); m.writeShellHook();
  expect((await fs.stat(path.join(hook.shims, 'claude'))).mtimeMs).toBe(before);
});
it.skipIf(win)('claude shim: the real claude further down PATH, --mcp-config=<json> as ONE argument before the user\'s', async () => {
  const h = await home(); const { m } = host(h); const hook = m.writeShellHook();
  await fakeAgent(path.join(h, 'bin'), 'claude');
  const out = execFileSync(path.join(hook.shims, 'claude'), ['fix the header', '-p'],
    { env: { PATH: `${hook.shims}:${path.join(h, 'bin')}:/usr/bin:/bin` } }).toString().split('\n');
  expect(out.slice(0, 3)).toEqual([`--mcp-config=${JSON.stringify({ mcpServers: { starquix: { command: m.launcher } } })}`, 'fix the header', '-p']);
});
it.skipIf(win)('codex shim: -c mcp_servers.starquix.command="<launcher>"', async () => {
  const h = await home(); const { m } = host(h); const hook = m.writeShellHook();
  await fakeAgent(path.join(h, 'bin'), 'codex');
  const out = execFileSync(path.join(hook.shims, 'codex'), ['exec'], { env: { PATH: `${hook.shims}:${path.join(h, 'bin')}:/usr/bin:/bin` } }).toString().split('\n');
  expect(out.slice(0, 3)).toEqual(['-c', `mcp_servers.starquix.command=${JSON.stringify(m.launcher)}`, 'exec']);
});
it.skipIf(win)('a shim with no real agent on PATH says so (127) and never runs itself', async () => {
  const h = await home(); const { m } = host(h); const hook = m.writeShellHook();
  const r = spawnSync(path.join(hook.shims, 'claude'), [], { env: { PATH: `${hook.shims}:${hook.shims}/:/usr/bin:/bin` } });
  expect(r.status).toBe(127); expect(r.stderr.toString()).toContain('claude: not found on PATH');
});

// Windows (2026-11-10): a .cmd launcher for `sq`, .cmd shims for PowerShell, and an .exe + env for agents' MCP configs.
const winHost = h => createMcpHost({ relayHome: path.join(h, '.starquix-mcp'), execPath: 'C:\\Apps\\100% Starquix\\Starquix.exe',
  script: 'C:\\Apps\\100% Starquix\\resources\\mcp\\starquix-mcp.mjs', platform: 'win32' });
it('Windows launcher: a .cmd that runs the relay on the app runtime; % doubled for cmd; CRLF', async () => {
  const h = await home(); const m = winHost(h);
  expect(m.launcher).toBe(path.join(h, '.starquix-mcp', 'bin', 'starquix-mcp.cmd'));
  m.refreshLauncher();
  const text = await read(m.launcher);
  expect(text).toBe(launcherCmd('C:\\Apps\\100% Starquix\\Starquix.exe', 'C:\\Apps\\100% Starquix\\resources\\mcp\\starquix-mcp.mjs'));
  expect(text.split('\r\n')).toEqual(['@echo off', expect.stringMatching(/^rem /), 'setlocal', 'set ELECTRON_RUN_AS_NODE=1',
    '"C:\\Apps\\100%% Starquix\\Starquix.exe" "C:\\Apps\\100%% Starquix\\resources\\mcp\\starquix-mcp.mjs" %*', '']);
  expect(m.server).toEqual({ command: 'C:\\Apps\\100% Starquix\\Starquix.exe', args: ['C:\\Apps\\100% Starquix\\resources\\mcp\\starquix-mcp.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } });
  expect(host(h).m.server).toBeNull(); // macOS/Linux: the launcher is what agents run
});
it('Windows hook: claude.cmd + codex.cmd shims, claude reads the server from a file, opencode gets the .exe + env', async () => {
  const h = await home(); const m = winHost(h); const relay = path.join(h, '.starquix-mcp');
  const hook = m.writeShellHook();
  expect(hook).toEqual({ shims: path.join(relay, 'shims'),
    opencode: JSON.stringify({ mcp: { starquix: { type: 'local', command: [m.server.command, ...m.server.args], environment: { ELECTRON_RUN_AS_NODE: '1' } } } }) });
  expect(JSON.parse(await read(path.join(relay, 'claude-mcp.json')))).toEqual({ mcpServers: { starquix: m.server } });
  const claude = await read(path.join(hook.shims, 'claude.cmd'));
  expect(claude).toContain(`"%SQ_REAL%" "--mcp-config=${path.join(relay, 'claude-mcp.json').replaceAll('%', '%%')}" %*`);
  const codex = await read(path.join(hook.shims, 'codex.cmd'));
  expect(codex).toContain(`-c "mcp_servers.starquix.command='C:\\Apps\\100%% Starquix\\Starquix.exe'"`);
  expect(codex).toContain(`-c "mcp_servers.starquix.env={ELECTRON_RUN_AS_NODE='1'}"`);
});
it('Windows .cmd paths: under the user folders through their variable (a non-ASCII name survives the OEM code page); % doubled', () => {
  const env = { USERPROFILE: 'C:\\Users\\José', LOCALAPPDATA: 'C:\\Users\\José\\AppData\\Local', APPDATA: 'C:\\Users\\José\\AppData\\Roaming' };
  expect(cmdPath('C:\\Users\\José\\AppData\\Local\\Programs\\Starquix\\Starquix.exe', env)).toBe('%LOCALAPPDATA%\\Programs\\Starquix\\Starquix.exe');
  expect(cmdPath('c:\\users\\josé\\.starquix-mcp\\claude-mcp.json', env)).toBe('%USERPROFILE%\\.starquix-mcp\\claude-mcp.json');
  expect(cmdPath('D:\\Apps\\100% Starquix\\Starquix.exe', env)).toBe('D:\\Apps\\100%% Starquix\\Starquix.exe');
  expect(cmdPath('C:\\Users\\Josette\\x', env)).toBe('C:\\Users\\Josette\\x'); // a sibling folder is not under the profile
});
// Real cmd.exe: only on Windows (the CI's windows job).
const winRig = async () => {
  const h = await home(); const m = createMcpHost({ relayHome: path.join(h, '.starquix-mcp'), execPath: process.execPath, script: path.join(h, 'relay.mjs') });
  const bin = path.join(h, 'bin'); await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'claude.cmd'), '@echo off\r\necho REAL %*\r\n');
  const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  return { h, m, bin, env: { ...process.env, [pathKey]: `${path.join(h, '.starquix-mcp', 'shims')};${bin};${process.env[pathKey]}` } };
};
it.runIf(win)('Windows claude shim (cmd.exe): runs the real claude further down PATH with --mcp-config first, never itself', async () => {
  const { h, m, env } = await winRig(); m.writeShellHook();
  const out = execFileSync('cmd.exe', ['/d', '/c', path.join(h, '.starquix-mcp', 'shims', 'claude.cmd'), 'fix', 'it'], { env }).toString().trim();
  expect(out).toBe(`REAL "--mcp-config=${path.join(h, '.starquix-mcp', 'claude-mcp.json')}" fix it`);
});
it.runIf(win)('Windows shim with no real agent on PATH: says so, exits 127', async () => {
  const { h, m, bin, env } = await winRig(); m.writeShellHook(); await fs.rm(path.join(bin, 'claude.cmd'));
  const r = spawnSync('cmd.exe', ['/d', '/c', path.join(h, '.starquix-mcp', 'shims', 'claude.cmd')], { env });
  expect(r.status).toBe(127); expect(r.stderr.toString()).toContain('claude: not found on PATH');
});
it.runIf(win)('Windows launcher (cmd.exe): runs the script on the runtime with ELECTRON_RUN_AS_NODE=1 and the args', async () => {
  const { h, m } = await winRig();
  await fs.writeFile(path.join(h, 'relay.mjs'), 'console.log(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE, ...process.argv.slice(2)]));');
  m.refreshLauncher();
  const out = execFileSync('cmd.exe', ['/d', '/c', m.launcher, 'call', 'get_project'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }).toString().trim();
  expect(JSON.parse(out)).toEqual(['1', 'call', 'get_project']);
});
it.runIf(win)('Windows launcher (cmd.exe) under a non-ASCII user folder still finds the relay', async () => {
  const { h } = await winRig(); const profile = path.join(h, 'Jösé'); await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'relay.mjs'), 'console.log("relay ok")');
  const saved = process.env.USERPROFILE; process.env.USERPROFILE = profile; // what the app sees when it writes the launcher
  let m;
  try { m = createMcpHost({ relayHome: path.join(profile, '.starquix-mcp'), execPath: process.execPath, script: path.join(profile, 'relay.mjs') }); m.refreshLauncher(); }
  finally { process.env.USERPROFILE = saved; }
  expect(await read(m.launcher)).toContain('"%USERPROFILE%\\relay.mjs"');
  expect(execFileSync('cmd.exe', ['/d', '/c', m.launcher], { env: { ...process.env, USERPROFILE: profile } }).toString().trim()).toBe('relay ok');
});
