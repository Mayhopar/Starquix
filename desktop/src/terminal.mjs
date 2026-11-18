// MCP-mode terminal (docs/plans/2026-10-27-mcp-terminal-design.md): one shell per open project, owned by Electron
// main. The editor reaches it only through main.mjs's leased IPC; output comes back through `emit`. Outside edits
// are watch.mjs's (every open project, not only one with a terminal — agent multiplayer, 2026-11-08).
import path from 'node:path';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
// A sequence the next chunk completes (frames over ~1 KB arrive in pieces): held back, so the mirror ends every write in
// ground state and a replay never cuts one in two.
const OPEN_TAIL = /\x1b(?:\[[\x20-\x3f]*|[\]P_^X][^\x07\x1b]*\x1b?|[\x20-\x2f]*)$/;
const KEPT_MODES = [25, 1006]; // what the serializer leaves out: the cursor's visibility, SGR mouse reports

/**
 * The shell's screen as xterm sees it — a headless xterm fed the same output — serialized for a remount to replay. Never a
 * byte tail: TUIs (Claude Code) paint cursor-relative diffs, so a tail without their last full frame came back as only the
 * changed cells, in the wrong rows (2026-11-08).
 */
function createMirror(cols, rows) {
  const term = new headless.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true }); // the view's scrollback (xterm's default)
  const serializer = new serialize.SerializeAddon(); term.loadAddon(serializer);
  const modes = {}; const queued = []; let carry = '';
  for (const final of ['h', 'l']) {
    term.parser.registerCsiHandler({ prefix: '?', final }, params => {
      for (const p of params) if (KEPT_MODES.includes(p)) modes[p] = final;
      return false;
    });
  }
  term.parser.registerEscHandler({ final: 'c' }, () => { for (const m in modes) delete modes[m]; return false; }); // RIS
  return {
    write(text) {
      const all = carry + text;
      carry = all.match(OPEN_TAIL)?.[0] ?? '';
      if (carry.length > 65_536) carry = ''; // shortcut: an unterminated string that long goes in as is; a replay may cut it
      const whole = all.slice(0, all.length - carry.length);
      if (!whole) return;
      queued.push(whole); // xterm parses later: a replay before that carries the raw text
      try { term.write(whole, () => queued.shift()); } catch { queued.pop(); } // >50 MB behind: xterm refuses, the mirror skips it
    },
    /** After the output that was laid out at the old size, as in the view. */
    resize(c, r) { term.write('', () => term.resize(c, r)); },
    replay() { return serializer.serialize() + Object.entries(modes).map(([m, f]) => `\x1b[?${m}${f}`).join('') + queued.join('') + carry; },
    dispose() { term.dispose(); },
  };
}

/** How to start the user's shell so their agent finds the Starquix tools (design §4). No hook: a plain login shell. */
export function shellSpec(env, hook, platform = process.platform) {
  // An app relaunched from a Claude session inherits its markers (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION, its tokens): an
  // agent in this shell would run as that session's child, transcripts off. The user's own CLAUDE_* come back from their rc.
  const own = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE')));
  if (platform === 'win32') {
    // Windows PowerShell (always installed; SHELL there is Git Bash's /usr/bin/bash, not spawnable). PATH keeps its own key
    // (`Path`): a second PATH key in the block would be ambiguous.
    const shell = { file: 'powershell.exe', args: ['-NoLogo'] };
    if (!hook) return { ...shell, env: own };
    const key = Object.keys(own).find(k => k.toUpperCase() === 'PATH') ?? 'Path';
    return { ...shell, env: { ...own, [key]: `${hook.shims};${own[key] ?? ''}`, SQ_SHIMS: hook.shims,
      OPENCODE_CONFIG_CONTENT: env.OPENCODE_CONFIG_CONTENT ?? hook.opencode } };
  }
  const file = env.SHELL || '/bin/zsh';
  const base = { ...own, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: env.LANG || 'en_US.UTF-8' };
  if (!hook) return { file, args: ['-l'], env: base };
  const hooked = { ...base, PATH: `${hook.shims}:${env.PATH || '/usr/bin:/bin'}`, SQ_SHIMS: hook.shims,
    OPENCODE_CONFIG_CONTENT: env.OPENCODE_CONFIG_CONTENT ?? hook.opencode };
  const shell = path.basename(file);
  if (shell === 'zsh') return { file, args: ['-l'], env: { ...hooked, ZDOTDIR: hook.zdotdir, SQ_USER_ZDOTDIR: env.ZDOTDIR || env.HOME || '' } };
  if (shell === 'bash') return { file, args: ['--rcfile', hook.bashrc, '-i'], env: hooked };
  return { file, args: ['-l'], env: hooked }; // other shells: PATH at spawn only — their startup files may reorder it
}

/**
 * spawnPty(cwd, cols, rows) → node-pty IPty (main.mjs) or a fake; emit('terminal-output', id, text).
 * Lifetime: main calls keepOnly(id) whenever a project (re)opens and release(id) when its session stops. A reload or an
 * instance recovery reopens the same project on a new lease within the grace, so the user's agent survives it.
 */
export function createTerminals({ spawnPty, emit, graceMs = 30_000 }) {
  const shells = new Map();
  const print = (id, s, text) => { s.mirror.write(text); emit('terminal-output', id, text); };

  function start(id, s) {
    let pty;
    try { pty = spawnPty(s.dir, s.cols, s.rows); } catch (error) { print(id, s, `\r\n[terminal unavailable: ${error?.message ?? error}]\r\n`); return; }
    s.pty = pty;
    pty.onData(data => { if (s.pty === pty) print(id, s, data); });
    pty.onExit(({ exitCode }) => {
      if (s.pty !== pty) return; // a deliberate kill is silent
      s.pty = null; print(id, s, `\r\n[process exited (${exitCode}) — press Enter to restart]\r\n`);
    });
  }

  function kill(id) {
    const s = shells.get(id); if (!s) return;
    shells.delete(id); clearTimeout(s.grace); s.mirror.dispose();
    const pty = s.pty; s.pty = null;
    try { pty?.kill(); } catch { /* already gone */ } // SIGHUP: the shell hangs up its jobs, the agent with them
  }

  return {
    /** The project's shell (started on first attach) → its screen + scrollback to replay. */
    attach(id, dir) {
      let s = shells.get(id);
      if (!s) {
        s = { dir, pty: null, cols: 80, rows: 24, mirror: createMirror(80, 24), grace: null };
        shells.set(id, s); start(id, s);
      }
      return s.mirror.replay();
    },
    input(id, data) {
      const s = shells.get(id); if (!s || typeof data !== 'string') return;
      if (s.pty) s.pty.write(data);
      else if (data.includes('\r')) start(id, s); // restart after exit; that keystroke is not replayed
    },
    resize(id, cols, rows) {
      const ok = n => Number.isInteger(n) && n > 0 && n <= 1000;
      const s = shells.get(id); if (!s || !ok(cols) || !ok(rows)) return;
      Object.assign(s, { cols, rows }); s.pty?.resize(cols, rows); s.mirror.resize(cols, rows); // a restart spawns at it too
    },
    keepOnly(id) {
      for (const other of [...shells.keys()]) if (other !== id) kill(other);
      clearTimeout(shells.get(id)?.grace);
    },
    release(id) {
      const s = shells.get(id); if (!s) return;
      clearTimeout(s.grace); s.grace = setTimeout(() => kill(id), graceMs);
    },
    closeAll() { for (const id of [...shells.keys()]) kill(id); },
  };
}
