import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ holdWrite: false, finishWrite: null as null | (() => void), fits: 0, observed: null as null | (() => void), written: [] as string[], typed: null as null | ((d: string) => void), disposed: false,
  output: null as null | ((id: string, d: string) => void), off: vi.fn(),
  attach: vi.fn<(id: string) => Promise<string>>(), input: vi.fn(async (_id: string, _d: string) => {}),
  resize: vi.fn(async (_id: string, _c: number, _r: number) => {}) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options = {};
  loadAddon(): void {} open(): void {} focus(): void {}
  write(d: string, done?: () => void): void { h.written.push(d); if (h.holdWrite && done) h.finishWrite = done; else done?.(); }
  onData(cb: (d: string) => void) { h.typed = cb; return { dispose(): void {} }; }
  dispose(): void { h.disposed = true; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void { h.fits++; } } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@/hooks', () => ({ useTheme: () => ({ isDark: false }) }));
vi.mock('@/services/desktopDriver', () => ({ isDesktop: () => true, desktopDriver: { terminal: {
  attach: h.attach, input: h.input, resize: h.resize,
  onOutput: (cb: (id: string, d: string) => void) => { h.output = cb; return h.off; } } } }));
import { TerminalView, themeOf } from '../TerminalView';

beforeEach(() => {
  Object.assign(h, { holdWrite: false, finishWrite: null, fits: 0, observed: null, written: [], typed: null, disposed: false, output: null });
  globalThis.ResizeObserver = class { constructor(cb: () => void) { h.observed = cb; } observe(): void {} disconnect(): void {} unobserve(): void {} } as unknown as typeof ResizeObserver;
});
// reset, not clear: an attach answer a slow test never consumed was handed to the next test (the gate's 4-test cascade)
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
const realTimeout = setTimeout; // captured before any test fakes timers
/** xterm is built after an async import: wait for it in REAL time. Fake time must not move meanwhile (vi.waitFor and
 *  shouldAdvanceTime both move it), or a starved worker lets the 120 ms settle fire before the test's own steps. */
async function mounted(): Promise<void> { while (!h.observed) await new Promise(r => realTimeout(r, 10)); }

it('replays the scrollback once attached, then streams only this project\'s output and sends keys', async () => {
  h.attach.mockResolvedValueOnce('$ before\r\n');
  render(<TerminalView projectId="p" />);
  await vi.waitFor(() => expect(h.written).toEqual(['$ before\r\n']));
  act(() => { h.output?.('other', 'nope'); h.output?.('p', 'live'); });
  expect(h.written).toEqual(['$ before\r\n', 'live']);
  h.typed?.('ls\r');
  expect(h.input).toHaveBeenCalledWith('p', 'ls\r');
  expect(h.resize).toHaveBeenCalledWith('p', 80, 24);
});
it('output that arrives before the attach answer is not printed twice (the replay has it)', async () => {
  let answer!: (r: string) => void; h.attach.mockReturnValueOnce(new Promise(r => { answer = r; }));
  render(<TerminalView projectId="p" />);
  await vi.waitFor(() => expect(h.output).toBeTruthy());
  h.output?.('p', 'early'); answer('...early');
  await vi.waitFor(() => expect(h.written).toEqual(['...early']));
});
it('retries attach while the project is still opening; unmount unsubscribes and disposes', async () => {
  vi.useFakeTimers();
  h.attach.mockRejectedValueOnce(new DOMException('Desktop owner changed', 'AbortError')).mockResolvedValueOnce('');
  const view = render(<TerminalView projectId="p" />);
  await mounted();
  await vi.waitFor(() => expect(h.attach).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(1000);
  await vi.waitFor(() => expect(h.attach).toHaveBeenCalledTimes(2));
  view.unmount();
  expect(h.off).toHaveBeenCalled(); expect(h.disposed).toBe(true);
});
it('the panel\'s resize animation reaches the shell once: the replay and the size wait for it to settle', async () => {
  vi.useFakeTimers();
  h.attach.mockResolvedValueOnce('$ scrollback');
  render(<TerminalView projectId="p" />);
  await mounted();
  for (let i = 0; i < 5; i++) { h.observed?.(); await vi.advanceTimersByTimeAsync(16); }
  expect(h.attach).not.toHaveBeenCalled(); // still animating
  await vi.advanceTimersByTimeAsync(200);
  expect(h.fits).toBe(1);
  await vi.waitFor(() => expect(h.written).toEqual(['$ scrollback']));
  expect(h.resize).toHaveBeenCalledTimes(1);
  h.resize.mockClear();
  for (let i = 0; i < 5; i++) { h.observed?.(); await vi.advanceTimersByTimeAsync(16); }
  await vi.advanceTimersByTimeAsync(200);
  expect(h.resize).toHaveBeenCalledTimes(1); // a drag of the panel: one size, at the end
});
it('what xterm answers while replaying old output never reaches the shell; keys after it do', async () => {
  h.holdWrite = true; h.attach.mockResolvedValueOnce('\x1b[c');
  render(<TerminalView projectId="p" />);
  await vi.waitFor(() => expect(h.finishWrite).toBeTruthy());
  h.typed?.('\x1b[?1;2c');
  expect(h.input).not.toHaveBeenCalled();
  h.finishWrite?.(); h.typed?.('ls\r');
  expect(h.input.mock.calls).toEqual([['p', 'ls\r']]);
});
it('themes all 16 ANSI colors from theme.css, not xterm\'s dark-screen defaults (white was 1.4:1 on the light Bg)', () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const real = window.getComputedStyle;
  // jsdom resolves no var(): hand back the token a probe asked for, so the test sees which token each key reads
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => (el.tagName === 'SPAN' ? { color: (el as HTMLElement).style.color } as CSSStyleDeclaration : real(el)));
  const theme = themeOf(host);
  const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const n of ansi) {
    expect(theme[n as keyof typeof theme], n).toBe(`var(--color-term-${n})`);
    expect(theme[`bright${n[0].toUpperCase()}${n.slice(1)}` as keyof typeof theme], `bright ${n}`).toBe(`var(--color-term-bright-${n})`);
  }
  host.remove(); vi.restoreAllMocks();
});
