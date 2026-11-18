// MCP mode's terminal (docs/plans/2026-10-27-mcp-terminal-design.md §3): the open project's shell lives in Electron
// main (desktop/src/terminal.mjs) and outlives this view — a remount replays its scrollback. xterm loads lazily.
import { useEffect, useRef } from 'react';
import type { ITheme, Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '@/hooks';
import { desktopDriver, isDesktop } from '@/services/desktopDriver';

const SETTLE_MS = 120;

/** xterm wants concrete colors; a computed color may be any CSS color (oklch…), so paint one pixel and read it back. */
function rgba(css: string, alpha = 1): string {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx || !css) return css;
  ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
/** Tokens are light-dark(): only a computed `color` resolves one to this scheme's value. A canvas can't parse the raw
 * token and kept its default black — the terminal painted black on black. */
export function themeOf(el: HTMLElement): ITheme {
  const probe = el.appendChild(document.createElement('span'));
  const token = (name: string, alpha?: number): string => { probe.style.color = `var(${name})`; return rgba(getComputedStyle(probe).color, alpha); };
  // xterm's default ANSI palette is made for a dark screen (white / bright-white are ~1.2:1 on the light Bg): theme.css owns ours.
  const term = (name: string): string => token(`--color-term-${name}`);
  try {
    return { background: token('--color-bg'), foreground: token('--color-text'), cursor: token('--color-text'),
      selectionBackground: token('--color-text-muted', 0.3),
      black: term('black'), red: term('red'), green: term('green'), yellow: term('yellow'),
      blue: term('blue'), magenta: term('magenta'), cyan: term('cyan'), white: term('white'),
      brightBlack: term('bright-black'), brightRed: term('bright-red'), brightGreen: term('bright-green'),
      brightYellow: term('bright-yellow'), brightBlue: term('bright-blue'), brightMagenta: term('bright-magenta'),
      brightCyan: term('bright-cyan'), brightWhite: term('bright-white') };
  } finally { probe.remove(); }
}

export function TerminalView({ projectId }: { projectId: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { isDark } = useTheme();

  useEffect(() => {
    const el = ref.current; if (!el || !isDesktop()) return;
    let disposed = false; let attached = false; let attaching = false; let replaying = false;
    let retry: ReturnType<typeof setTimeout> | undefined; let settling: ReturnType<typeof setTimeout> | undefined;
    const offs: Array<() => void> = [];
    void (async () => {
      const [{ Terminal: Xterm }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed) return;
      const term = new Xterm({ fontSize: 12, cursorBlink: true,
        fontFamily: getComputedStyle(el).fontFamily, theme: themeOf(el) });
      const fit = new FitAddon(); term.loadAddon(fit); term.open(el); termRef.current = term;
      // Output that lands before the attach answer is already in the replay: write only after it.
      offs.push(desktopDriver.terminal.onOutput((id, data) => { if (id === projectId && attached) term.write(data); }));
      // xterm answers the queries in old output (device attributes…): those answers are not the user typing.
      const typed = term.onData(data => { if (!replaying) void desktopDriver.terminal.input(projectId, data).catch(() => {}); });
      offs.push(() => typed.dispose());
      const sendSize = (): void => { void desktopDriver.terminal.resize(projectId, term.cols, term.rows).catch(() => {}); };
      const attach = async (): Promise<void> => {
        try {
          const replay = await desktopDriver.terminal.attach(projectId);
          if (disposed) return;
          replaying = true; term.write(replay, () => { replaying = false; }); attached = true; sendSize();
          term.focus();
        } catch { if (!disposed) retry = setTimeout(() => void attach(), 1000); } // the project is still opening
      };
      // The footer panel animates its size: each step reaching the shell makes zsh redraw over the scrollback. The
      // shell hears only the settled size, and the replay lands at it.
      const settle = (): void => {
        clearTimeout(settling);
        settling = setTimeout(() => {
          fit.fit();
          if (attached) sendSize();
          else if (!attaching) { attaching = true; void attach(); }
        }, SETTLE_MS);
      };
      const observer = new ResizeObserver(settle); observer.observe(el); settle();
      offs.push(() => observer.disconnect());
    })();
    return () => { disposed = true; clearTimeout(retry); clearTimeout(settling); offs.splice(0).forEach(off => off()); termRef.current?.dispose(); termRef.current = null; };
  }, [projectId]);

  // The theme class flips after this render: read the tokens on the next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => { const el = ref.current; if (el && termRef.current) termRef.current.options.theme = themeOf(el); });
    return () => cancelAnimationFrame(frame);
  }, [isDark]);

  // FitAddon reads the host's border-box width: the padding lives on a wrapper or the last columns overflow.
  return (
    <div className="flex flex-1 min-h-0 px-3 py-1">
      <div ref={ref} data-testid="terminal-view" className="flex-1 min-w-0 font-mono text-text" />
    </div>
  );
}
