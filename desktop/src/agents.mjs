// Coding-agent relay host (AI Settings → MCP), main-process only:
//  1. The relay's pairing code. ~/.starquix-mcp/daemon.json (0600) is the secret
//     the bundled relay (mcp/src/identity.ts) loads at startup; the editor dials
//     the same token + port, so an agent's relay is paired with no pasted code.
//  2. A stable launcher (~/.starquix-mcp/bin/starquix-mcp) the app rewrites on
//     every launch. The connect prompt tells the agent to register it in its OWN
//     MCP settings; we never write agent configs (2026-10-08: one prompt, no rows).
//  3. The MCP terminal's hook files: they change only processes started in that terminal.
// Windows: the launcher is a .cmd (for `sq` in a shell), but an agent's MCP config gets `server` — the app's own
// runtime + script + ELECTRON_RUN_AS_NODE — because agents spawn an .exe and Node never runs a .cmd without a shell.
// Design: docs/plans/2026-10-08-agent-connect-design.md.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { renameReplacing } from '../../preview-template/src/plugins/sq-atomic-write.js'; // Windows: retries an antivirus-held rename

const RELAY_PORT = 47821; // mcp/src/protocol.ts DEFAULT_RELAY_PORT

/** Mirrors mcp/src/protocol.ts encodePairingCode (parity test in test/agents.test.mjs). */
export function encodeCode(port, token) {
  return `${port.toString(36)}.${token}`.toUpperCase().replace(/(.{6})(?=.)/g, '$1-');
}

const sq = s => `'${s.replaceAll("'", "'\\''")}'`;
export function launcherText(execPath, script) {
  return `#!/bin/sh\n# Written by the Starquix app on every launch: the coding-agent relay bundled in the app.\nELECTRON_RUN_AS_NODE=1 exec ${sq(execPath)} ${sq(script)} "$@"\n`;
}

/** A path inside a .cmd. cmd reads a batch file in the OEM code page, so a non-ASCII user name (C:\Users\José) came
 *  back garbled: under the user's folders the path is written through their variable; cmd expands %, so a literal % doubles. */
export function cmdPath(p, env = process.env) {
  for (const key of ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE']) {
    const dir = env[key];
    if (dir && p.toLowerCase().startsWith(`${dir.toLowerCase()}\\`)) return `%${key}%${p.slice(dir.length).replaceAll('%', '%%')}`;
  }
  return p.replaceAll('%', '%%');
}

/** Windows: the same launcher as a .cmd. */
export function launcherCmd(execPath, script) {
  const q = s => `"${cmdPath(s)}"`;
  return ['@echo off', 'rem Written by the Starquix app on every launch: the coding-agent relay bundled in the app.', 'setlocal',
    'set ELECTRON_RUN_AS_NODE=1', `${q(execPath)} ${q(script)} %*`].join('\r\n') + '\r\n';
}

function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode }); fs.chmodSync(tmp, mode); // chmod: the umask trims writeFileSync's mode
  renameReplacing(tmp, file);
}

function writeIfChanged(file, text, mode) {
  let current = null; try { current = fs.readFileSync(file, 'utf8'); } catch { /* first launch */ }
  if (current !== text) writeAtomic(file, text, mode);
}

/** A PATH shim (terminal design §4): the first real `name` further down PATH (never itself: -ef), with the Starquix hook args. */
export function shimText(name, hookArgs) {
  return `#!/bin/sh
# Written by the Starquix app: in the Starquix terminal, ${name} starts with the Starquix tools. Nothing else changes.
set -f; IFS=:
for d in $PATH; do
  if [ -n "$d" ] && [ -f "$d/${name}" ] && [ -x "$d/${name}" ] && ! [ "$d/${name}" -ef "$0" ]; then exec "$d/${name}" ${hookArgs} "$@"; fi
done
echo '${name}: not found on PATH' >&2
exit 127
`;
}
/** Windows PATH shim (.cmd): the first real name.exe/.cmd/.bat further down PATH (never this folder), with the hook args. */
export function shimCmd(name, hookArgs) {
  return ['@echo off', `rem Written by the Starquix app: in the Starquix terminal, ${name} starts with the Starquix tools. Nothing else changes.`,
    'setlocal',
    // ~s: both sides as 8.3 names — a PATH entry and %~dp0 can name this folder short (RUNNER~1) or long.
    `for /f "delims=" %%i in ('where ${name} 2^>nul') do if /i not "%%~sdpi"=="%~sdp0" (`,
    '  if /i "%%~xi"==".exe" (set "SQ_REAL=%%i" & goto run)',
    '  if /i "%%~xi"==".cmd" (set "SQ_REAL=%%i" & goto run)',
    '  if /i "%%~xi"==".bat" (set "SQ_REAL=%%i" & goto run)',
    ')',
    `echo ${name}: not found on PATH 1>&2`, 'exit /b 127',
    ':run', `"%SQ_REAL%" ${hookArgs} %*`].join('\r\n') + '\r\n';
}
// shortcut: TOML literal strings ('…') keep backslashes but cannot hold a ' — a path with an apostrophe breaks codex's hook.
const codexHookCmd = server => [`-c "mcp_servers.starquix.command='${cmdPath(server.command)}'"`,
  `-c "mcp_servers.starquix.args=[${server.args.map(a => `'${cmdPath(a)}'`).join(', ')}]"`,
  `-c "mcp_servers.starquix.env={ELECTRON_RUN_AS_NODE='1'}"`].join(' ');

// claude's --mcp-config is variadic: the = form keeps the user's prompt out of it.
const claudeHook = launcher => sq(`--mcp-config=${JSON.stringify({ mcpServers: { starquix: { command: launcher } } })}`);
const codexHook = launcher => `-c ${sq(`mcp_servers.starquix.command=${JSON.stringify(launcher)}`)}`;

// zsh reads $ZDOTDIR/{.zshenv,.zprofile,.zshrc,.zlogin}. Each of ours runs the user's own file under the user's ZDOTDIR,
// then restores ours; .zshrc and .zlogin end with the shims first (macOS /etc/zprofile's path_helper reorders PATH).
const ZSH_PATH = 'path=($SQ_SHIMS ${path:#$SQ_SHIMS})';
const zshFile = (file, { before, after } = {}) => [
  '# Written by the Starquix app (docs/plans/2026-10-27-mcp-terminal-design.md §4): your own zsh file, then the Starquix shims.',
  'SQ_ZDOTDIR=${SQ_ZDOTDIR:-$ZDOTDIR}', 'ZDOTDIR=$SQ_USER_ZDOTDIR', before,
  `[[ -r $ZDOTDIR/${file} ]] && source $ZDOTDIR/${file}`,
  'SQ_USER_ZDOTDIR=$ZDOTDIR', 'ZDOTDIR=$SQ_ZDOTDIR', after,
].filter(Boolean).join('\n') + '\n';
const ZSH_FILES = {
  '.zshenv': zshFile('.zshenv'),
  '.zprofile': zshFile('.zprofile'),
  // /etc/zshrc set HISTFILE under OUR ZDOTDIR: keep the user's history.
  '.zshrc': zshFile('.zshrc', { before: '[[ $HISTFILE == $SQ_ZDOTDIR/* ]] && HISTFILE=$ZDOTDIR/.zsh_history', after: ZSH_PATH }),
  '.zlogin': zshFile('.zlogin', { after: `${ZSH_PATH}\nif [[ $SQ_USER_ZDOTDIR == $HOME ]]; then unset ZDOTDIR; else ZDOTDIR=$SQ_USER_ZDOTDIR; fi` }),
};
const BASHRC = `# Written by the Starquix app (docs/plans/2026-10-27-mcp-terminal-design.md §4): your login files, then the Starquix shims.
[ -r /etc/profile ] && . /etc/profile
if [ -r ~/.bash_profile ]; then . ~/.bash_profile; elif [ -r ~/.bash_login ]; then . ~/.bash_login; elif [ -r ~/.profile ]; then . ~/.profile; fi
PATH="$SQ_SHIMS:$PATH"
`;

export function createMcpHost({ relayHome, execPath, script, platform = process.platform }) {
  const win = platform === 'win32';
  const identityFile = path.join(relayHome, 'daemon.json');
  const launcher = path.join(relayHome, 'bin', win ? 'starquix-mcp.cmd' : 'starquix-mcp');
  /** Windows: what an agent's MCP config runs (an .exe + env); elsewhere the launcher itself, so null. */
  const server = win ? { command: execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } } : null;
  const readIdentity = () => { try { return JSON.parse(fs.readFileSync(identityFile, 'utf8')); } catch { return null; } };
  const writeIdentity = id => writeAtomic(identityFile, JSON.stringify(id, null, 2), 0o600);
  const validToken = t => typeof t === 'string' && /^[a-f0-9]{24}$/.test(t);
  const codeOf = id => (id && validToken(id.token) && id.wsPort ? encodeCode(id.wsPort, id.token) : null);


  return {
    launcher, server,
    /** The editor's pairing code; creates the identity (or its port) only when missing. */
    code() {
      const id = readIdentity() ?? {};
      const next = { ...id };
      if (!validToken(id.token)) Object.assign(next, { token: randomBytes(12).toString('hex'), controlPort: 0, editorUrl: 'http://localhost:3000' });
      if (!next.wsPort) next.wsPort = RELAY_PORT;
      if (JSON.stringify(next) !== JSON.stringify(id)) writeIdentity(next);
      return codeOf(next);
    },
    /** New token (drops connected agents): the running daemon still holds the old one, so stop it. */
    rotate() {
      const old = readIdentity() ?? {};
      const next = { ...old, token: randomBytes(12).toString('hex'), wsPort: old.wsPort || RELAY_PORT, pid: undefined };
      writeIdentity(next);
      if (old.controlPort && validToken(old.token)) {
        void fetch(`http://127.0.0.1:${old.controlPort}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${old.token}` }, body: '{}' }).catch(() => {});
      }
      return codeOf(next);
    },
    /** Calls back with the new code when the relay rewrites its identity (busy port, `pair --code`). Read-only. */
    watch(cb) {
      let last = codeOf(readIdentity());
      const onChange = () => { const c = codeOf(readIdentity()); if (c && c !== last) { last = c; cb(c); } };
      fs.watchFile(identityFile, { interval: 1000 }, onChange);
      return () => fs.unwatchFile(identityFile, onChange);
    },
    /** App launch: point the launcher at this app (moved / updated); no write when it already does. */
    refreshLauncher() { writeIfChanged(launcher, win ? launcherCmd(execPath, script) : launcherText(execPath, script), 0o755); },
    /** The MCP terminal's "already connected" files (terminal design §4); rewritten only when they differ, like the launcher. */
    writeShellHook() {
      const shims = path.join(relayHome, 'shims'); const zdotdir = path.join(relayHome, 'zsh'); const bashrc = path.join(relayHome, 'bashrc');
      if (win) { // PowerShell (terminal.mjs): .cmd shims first on PATH; claude reads its server from a file (no JSON on a cmd line)
        const claudeConfig = path.join(relayHome, 'claude-mcp.json');
        writeIfChanged(claudeConfig, JSON.stringify({ mcpServers: { starquix: server } }), 0o644);
        writeIfChanged(path.join(shims, 'claude.cmd'), shimCmd('claude', `"--mcp-config=${cmdPath(claudeConfig)}"`), 0o755);
        writeIfChanged(path.join(shims, 'codex.cmd'), shimCmd('codex', codexHookCmd(server)), 0o755);
        return { shims, opencode: JSON.stringify({ mcp: { starquix: { type: 'local', command: [server.command, ...server.args], environment: server.env } } }) };
      }
      writeIfChanged(path.join(shims, 'claude'), shimText('claude', claudeHook(launcher)), 0o755);
      writeIfChanged(path.join(shims, 'codex'), shimText('codex', codexHook(launcher)), 0o755);
      for (const [name, text] of Object.entries(ZSH_FILES)) writeIfChanged(path.join(zdotdir, name), text, 0o644);
      writeIfChanged(bashrc, BASHRC, 0o644);
      return { shims, zdotdir, bashrc, opencode: JSON.stringify({ mcp: { starquix: { type: 'local', command: [launcher] } } }) };
    },
  };
}
