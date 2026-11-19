import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import headless from '@xterm/headless';
import { createTerminals, shellSpec } from '../src/terminal.mjs';
import { createMcpHost } from '../src/agents.mjs';

const roots = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const hook = { shims: '/R/shims', zdotdir: '/R/zsh', bashrc: '/R/bashrc', opencode: '{"mcp":{}}' };

it('zsh: login shell, our ZDOTDIR over the user\'s, shims first, opencode hook, UTF-8 + truecolor', () => {
  const { file, args, env } = shellSpec({ SHELL: '/bin/zsh', HOME: '/h', PATH: '/usr/bin' }, hook, 'darwin');
  expect([file, args]).toEqual(['/bin/zsh', ['-l']]);
  expect(env).toMatchObject({ ZDOTDIR: '/R/zsh', SQ_USER_ZDOTDIR: '/h', SQ_SHIMS: '/R/shims', PATH: '/R/shims:/usr/bin',
    OPENCODE_CONFIG_CONTENT: '{"mcp":{}}', TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' });
  expect(shellSpec({ SHELL: '/bin/zsh', HOME: '/h', ZDOTDIR: '/h/.config/zsh', LANG: 'de_DE.UTF-8', OPENCODE_CONFIG_CONTENT: 'mine' }, hook, 'darwin').env)
    .toMatchObject({ SQ_USER_ZDOTDIR: '/h/.config/zsh', LANG: 'de_DE.UTF-8', OPENCODE_CONFIG_CONTENT: 'mine' });
});
it('a Claude session that launched the app leaves no markers in the shell: an agent there starts as its own session', () => {
  const inherited = { PATH: '/p', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_PID: '9', KEEP: 'y' };
  for (const [h, platform] of [[hook, 'darwin'], [null, 'darwin'], [hook, 'win32'], [null, 'win32']]) {
    const { env } = shellSpec(inherited, h, platform);
    expect(Object.keys(env).filter(k => k.startsWith('CLAUDE'))).toEqual([]); expect(env.KEEP).toBe('y');
  }
});
it('bash: our --rcfile, interactive; other shells: login + PATH only; no hook: a plain login shell', () => {
  expect(shellSpec({ SHELL: '/opt/homebrew/bin/bash', PATH: '/p' }, hook, 'darwin')).toMatchObject({ args: ['--rcfile', '/R/bashrc', '-i'], env: { PATH: '/R/shims:/p' } });
  const fish = shellSpec({ SHELL: '/opt/homebrew/bin/fish', PATH: '/p' }, hook, 'darwin');
  expect(fish.args).toEqual(['-l']); expect(fish.env.ZDOTDIR).toBeUndefined(); expect(fish.env.PATH).toBe('/R/shims:/p');
  const plain = shellSpec({ PATH: '/p' }, null, 'darwin');
  expect(plain).toMatchObject({ file: '/bin/zsh', args: ['-l'], env: { PATH: '/p' } }); expect(plain.env.ZDOTDIR).toBeUndefined();
  expect(shellSpec({ PATH: '/p' }, null, 'linux').file).toBe('/bin/bash');
});

// Real shells against the real hook files: the user's own startup files run, then the shims are first.
const zsh = ['/bin/zsh', '/usr/bin/zsh'].find(f => existsSync(f));
async function realHook() {
  const h = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-term-')); roots.push(h);
  return { h, hook: createMcpHost({ relayHome: path.join(h, '.starquix-mcp'), execPath: '/App/Starquix', script: '/App/mcp.mjs' }).writeShellHook() };
}
it.skipIf(!zsh)('zsh: user files run, shims first after them, ZDOTDIR restored, history stays the user\'s', async () => {
  const { h, hook } = await realHook();
  await fs.writeFile(path.join(h, '.zshrc'), 'export PATH="/user/first:$PATH"\nexport SQ_TEST_RC=loaded\n');
  const { env } = shellSpec({ HOME: h, PATH: '/usr/bin:/bin', SHELL: zsh }, hook);
  const line = execFileSync(zsh, ['-l', '-i', '-c', 'print -r -- "$path[1]|$SQ_TEST_RC|${ZDOTDIR-unset}|$HISTFILE"'], { env }).toString().trim().split('\n').pop();
  const [first, rc, zdotdir, histfile] = line.split('|');
  expect([first, rc, zdotdir]).toEqual([hook.shims, 'loaded', 'unset']);
  expect(histfile.startsWith(hook.zdotdir)).toBe(false);
});
it.skipIf(process.platform === 'win32')('bash: --rcfile runs the login files, then the shims are first', async () => {
  const { h, hook } = await realHook();
  await fs.writeFile(path.join(h, '.bash_profile'), 'export PATH="/user/first:$PATH"\nexport SQ_TEST_RC=loaded\n');
  const { file, args, env } = shellSpec({ HOME: h, PATH: '/usr/bin:/bin', SHELL: '/bin/bash' }, hook);
  const line = execFileSync(file, [...args, '-c', 'echo "${PATH%%:*}|$SQ_TEST_RC"'], { env }).toString().trim().split('\n').pop();
  expect(line).toBe(`${hook.shims}|loaded`);
});

it('Windows: PowerShell with the shims first on PATH under its own key (Path); SHELL ignored; no hook: plain PowerShell', () => {
  const winHook = { shims: 'C:\\R\\shims', opencode: '{"mcp":{}}' };
  const { file, args, env } = shellSpec({ Path: 'C:\\Windows;C:\\bin', SHELL: '/usr/bin/bash', OPENCODE_CONFIG_CONTENT: undefined }, winHook, 'win32');
  expect([file, args]).toEqual(['powershell.exe', ['-NoLogo']]);
  expect(env).toMatchObject({ Path: 'C:\\R\\shims;C:\\Windows;C:\\bin', SQ_SHIMS: 'C:\\R\\shims', OPENCODE_CONFIG_CONTENT: '{"mcp":{}}' });
  expect(Object.keys(env).filter(k => k.toUpperCase() === 'PATH')).toEqual(['Path']); // one PATH key: a second would be ambiguous
  expect(shellSpec({ Path: 'C:\\Windows' }, null, 'win32')).toEqual({ file: 'powershell.exe', args: ['-NoLogo'], env: { Path: 'C:\\Windows' } });
});
it.runIf(process.platform === 'win32')('Windows: the real PowerShell starts with the shims first on PATH', async () => {
  const { hook } = await realHook();
  const { file, args, env } = shellSpec(process.env, hook);
  const first = execFileSync(file, [...args, '-NoProfile', '-Command', "$env:Path.Split(';')[0]"], { env }).toString().trim();
  expect(first).toBe(hook.shims);
});

function fakePty(cwd) {
  const p = { cwd, writes: [], sizes: [], killed: 0, write: d => p.writes.push(d), resize: (c, r) => p.sizes.push([c, r]),
    kill: () => { p.killed++; }, onData: cb => { p.data = cb; }, onExit: cb => { p.exit = cb; } };
  return p;
}
function rig(over = {}) {
  const ptys = []; const events = [];
  const t = createTerminals({ spawnPty: (cwd, cols, rows) => { const p = fakePty(cwd); p.size = [cols, rows]; ptys.push(p); return p; },
    emit: (...e) => events.push(e), ...over });
  return { t, ptys, events };
}

// The editor's side of a remount: a fresh xterm that is fed the replay.
const xterm = (cols = 80, rows = 24) => new headless.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
const feed = (term, data) => new Promise(resolve => term.write(data, resolve));
const screen = term => { const b = term.buffer.active; const lines = [];
  for (let y = 0; y < b.length; y++) lines.push(b.getLine(y).translateToString(true));
  return { lines, cursor: [b.cursorX, b.cursorY], buffer: b.type }; };
const parsed = () => new Promise(resolve => setTimeout(resolve, 50));

it('attach starts ONE shell in the project folder, at the terminal size; its output streams', () => {
  const { t, ptys, events } = rig();
  expect(t.attach('p', '/S/p')).toBe(''); expect(t.attach('p', '/S/p')).toBe('');
  expect(ptys.map(p => [p.cwd, p.size])).toEqual([['/S/p', [80, 24]]]);
  ptys[0].data('hello ');
  expect(events).toEqual([['terminal-output', 'p', 'hello ']]);
});
it('a remount replays the SCREEN: a TUI painting cursor-relative diffs (Claude Code) comes back whole after a long session', async () => {
  const { t, ptys } = rig(); t.attach('p', '/S/p');
  const live = xterm(); const out = d => { ptys[0].data(d); return feed(live, d); };
  await out(Array.from({ length: 40 }, (_, i) => `line ${i}\r\n`).join(''));
  await out('┌───────────┐\r\n│ usage  0% │\r\n└───────────┘\r\n❯ '); // its one full frame
  let diffs = ''; // then ~1 MB of in-place updates: up to the counter, write the changed cells, back to the prompt
  for (let i = 1; i <= 40_000; i++) diffs += `\x1b[?25l\x1b[2A\r\x1b[8C${String(i % 100).padStart(2)}\x1b[2B\r\x1b[2C\x1b[?25h`;
  await out(diffs);
  const remount = xterm(); await feed(remount, t.attach('p', '/S/p'));
  expect(screen(remount)).toEqual(screen(live));
  expect(screen(remount).lines).toContain('│ usage  0% │');
  const next = '\x1b[2A\r\x1b[8C42\x1b[2B\r\x1b[2C'; // the TUI's next diff lands where it belongs
  await out(next); await feed(remount, next);
  expect(screen(remount)).toEqual(screen(live));
});
it('a replay holds output the mirror has not parsed yet and never splits an escape sequence', async () => {
  const { t, ptys } = rig(); t.attach('p', '/S/p');
  ptys[0].data('plain \x1b[3'); // a frame that arrived in two pieces
  const now = t.attach('p', '/S/p'); await parsed(); const later = t.attach('p', '/S/p');
  ptys[0].data('1mred\x1b[0m');
  const live = xterm(); await feed(live, 'plain \x1b[31mred\x1b[0m');
  for (const replay of [now, later]) {
    const remount = xterm(); await feed(remount, replay); await feed(remount, '1mred\x1b[0m');
    expect(screen(remount)).toEqual(screen(live));
    expect(remount.buffer.active.getLine(0).getCell(6).getFgColor()).toBe(1); // red, not the text "1mred"
  }
});
it('a TUI\'s modes come back: alt screen, mouse + SGR reports, bracketed paste, hidden cursor; a reset clears them', async () => {
  const { t, ptys } = rig(); t.attach('p', '/S/p');
  ptys[0].data('\x1b[?1049h\x1b[?25l\x1b[?1000;1006h\x1b[?2004htop'); await parsed();
  const remount = async () => { // the cursor and the mouse encoding are not in xterm's public modes: watch the DECSETs
    const term = xterm(); const set = {};
    for (const final of ['h', 'l']) term.parser.registerCsiHandler({ prefix: '?', final }, ps => { for (const p of ps) set[p] = final; return false; });
    await feed(term, t.attach('p', '/S/p')); return { term, set };
  };
  const { term, set } = await remount();
  expect(term.buffer.active.type).toBe('alternate');
  expect(term.modes).toMatchObject({ mouseTrackingMode: 'vt200', bracketedPasteMode: true });
  expect(set).toMatchObject({ 25: 'l', 1006: 'h' });
  ptys[0].data('\x1bc'); await parsed();
  expect((await remount()).set[25]).not.toBe('l');
});
it('the mirror follows the shell size: a replay after a resize matches the screen', async () => {
  const { t, ptys } = rig(); t.attach('p', '/S/p');
  const live = xterm(); const out = d => { ptys[0].data(d); return feed(live, d); };
  await out(`${'x'.repeat(100)}\r\n`); // wraps at 80
  t.resize('p', 120, 30); live.resize(120, 30);
  await out('y'.repeat(100)); await parsed();
  const remount = xterm(120, 30); await feed(remount, t.attach('p', '/S/p'));
  expect(screen(remount)).toEqual(screen(live));
});
it('after exit: one line says so, Enter restarts at the last size, other keys are dropped', () => {
  const { t, ptys, events } = rig(); t.attach('p', '/S/p');
  ptys[0].exit({ exitCode: 2 });
  expect(events.at(-1)).toEqual(['terminal-output', 'p', '\r\n[process exited (2) — press Enter to restart]\r\n']);
  t.resize('p', 100, 30);
  t.input('p', 'ls'); expect(ptys).toHaveLength(1);
  t.input('p', '\r'); expect(ptys).toHaveLength(2); expect(ptys[1].size).toEqual([100, 30]);
  t.input('p', 'echo hi\r'); expect(ptys[1].writes).toEqual(['echo hi\r']);
});
it('a shell that cannot start says why in the terminal; Enter retries', () => {
  let fail = true; const made = [];
  const { t } = rig({ spawnPty: cwd => { if (fail) throw new Error('posix_spawnp failed.'); const p = fakePty(cwd); made.push(p); return p; } });
  expect(t.attach('p', '/S/p')).toContain('[terminal unavailable: posix_spawnp failed.]');
  fail = false; t.input('p', '\r'); expect(made).toHaveLength(1);
});
it('resize takes only sane integer sizes', () => {
  const { t, ptys } = rig(); t.attach('p', '/S/p');
  for (const [c, r] of [[120, 40], [0, 40], [1.5, 2], ['80', 24], [5000, 40]]) t.resize('p', c, r);
  expect(ptys[0].sizes).toEqual([[120, 40]]);
});
it('lifetime: release kills after the grace unless reopened; another project kills now; quit kills all; kills are silent', () => {
  vi.useFakeTimers();
  const { t, ptys, events } = rig({ graceMs: 1000 });
  t.attach('a', '/S/a');
  t.release('a'); vi.advanceTimersByTime(999); t.keepOnly('a'); vi.advanceTimersByTime(5000);
  expect(ptys[0].killed).toBe(0); // a reload / instance recovery reopened it on a new lease
  t.release('a'); vi.advanceTimersByTime(1000); expect(ptys[0].killed).toBe(1);
  ptys[0].exit({ exitCode: 129 }); // the late exit of a killed shell
  expect(t.attach('a', '/S/a')).toBe(''); expect(ptys).toHaveLength(2); // fresh shell, fresh scrollback
  t.keepOnly('b'); expect(ptys[1].killed).toBe(1); // switching projects
  t.attach('c', '/S/c'); t.attach('d', '/S/d'); t.closeAll();
  expect(ptys.slice(2).map(p => p.killed)).toEqual([1, 1]);
  expect(events.some(e => String(e[2]).includes('process exited'))).toBe(false);
});
