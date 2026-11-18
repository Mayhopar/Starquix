import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createQuitFlush, ignoreVetoWhileLeaving, QUIT_FLUSH_MS } from '../src/quit-flush.mjs';

const ORIGIN = 'http://127.0.0.1:3061';
function harness({ destroyed = false } = {}) {
  const frame = { url: `${ORIGIN}/editor/p` };
  const sent = [];
  const webContents = { mainFrame: frame, isDestroyed: () => false, send: (channel, ...args) => sent.push([channel, ...args]) };
  const win = { isDestroyed: () => destroyed, webContents };
  const handlers = {};
  const ipcMain = { on: (channel, fn) => { handlers[channel] = fn; } };
  const flush = createQuitFlush({ getWindow: () => win, ipcMain, editorOrigin: ORIGIN });
  const fromEditor = { sender: webContents, senderFrame: frame };
  return { flush, sent, handlers, fromEditor, webContents };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('asks the editor window to flush and resolves when the renderer answers', async () => {
  const { flush, sent, handlers, fromEditor } = harness();
  const done = flush.flush();
  expect(sent).toEqual([['sq:flush-for-quit']]);
  handlers['sq:quit-flushed'](fromEditor);
  await expect(done).resolves.toBe('flushed');
});

it('is memoized: a second caller (the window close after the quit) joins the same handshake and sends nothing more', async () => {
  const { flush, sent, handlers, fromEditor } = harness();
  const a = flush.flush(); const b = flush.flush();
  expect(a).toBe(b);
  handlers['sq:quit-flushed'](fromEditor);
  await a;
  await flush.flush();
  expect(sent).toHaveLength(1);
});

it('a renderer that never answers costs the cap, not a hang', async () => {
  const { flush } = harness();
  const done = flush.flush();
  await vi.advanceTimersByTimeAsync(QUIT_FLUSH_MS - 1);
  let settled = false; void done.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  await expect(done).resolves.toBe('timeout');
});

it('rejects an answer from a foreign frame or sender: only the editor frame ends the wait', async () => {
  const { flush, handlers, fromEditor, webContents } = harness();
  const done = flush.flush();
  handlers['sq:quit-flushed']({ sender: {}, senderFrame: webContents.mainFrame });
  handlers['sq:quit-flushed']({ sender: webContents, senderFrame: { url: 'https://evil.test' } });
  await vi.advanceTimersByTimeAsync(QUIT_FLUSH_MS - 10);
  let settled = false; void done.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  handlers['sq:quit-flushed'](fromEditor);
  await expect(done).resolves.toBe('flushed');
});

it('resolves at once when there is no live editor window', async () => {
  const { flush, sent } = harness({ destroyed: true });
  await expect(flush.flush()).resolves.toBe('no-window');
  expect(sent).toEqual([]);
});

it('a send that throws resolves instead of hanging the quit', async () => {
  const { flush, webContents } = harness();
  webContents.send = () => { throw new Error('gone'); };
  await expect(flush.flush()).resolves.toBe('send-failed');
});

it('will-prevent-unload: a beforeunload veto is ignored only while the app is leaving', () => {
  let leaving = false;
  const handler = ignoreVetoWhileLeaving(() => leaving);
  const e1 = { preventDefault: vi.fn() }; handler(e1);
  expect(e1.preventDefault).not.toHaveBeenCalled();
  leaving = true;
  const e2 = { preventDefault: vi.fn() }; handler(e2);
  expect(e2.preventDefault).toHaveBeenCalledOnce();
});
