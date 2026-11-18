// Quit / window-close handshake (instant-edit P2, decision 16). Before the app stops the Astro sessions (Cmd-Q) or closes the
// editor window, main asks the renderer to push the input it still holds (a typed number inside its settle window, a stepper
// burst) and wait until the lane accepted it. Without this a clean quit would lose a draft: before-quit stops terminals,
// watchers and every session BEFORE any window closes, so a push at unload is refused by the stopped sessions.
// A renderer that never answers costs at most QUIT_FLUSH_MS; the stash (renderer localStorage) is the net for that case.
import { validateSender } from './ipc.mjs';

export const QUIT_FLUSH_MS = 2000;

export function createQuitFlush({ getWindow, ipcMain, editorOrigin, timeoutMs = QUIT_FLUSH_MS }) {
  let pending = null;   // memoized: one handshake per app lifetime; later callers join it
  let ack = null;
  ipcMain.on('sq:quit-flushed', event => {
    const win = getWindow();
    try { if (!win || win.isDestroyed()) return; validateSender(event, win.webContents, editorOrigin); } catch { return; }   // a foreign frame cannot end the wait
    ack?.();
  });
  function flush() {
    if (pending) return pending;
    pending = new Promise(resolve => {
      const win = getWindow();
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) { resolve('no-window'); return; }
      const timer = setTimeout(() => done('timeout'), timeoutMs);
      const done = reason => { clearTimeout(timer); ack = null; resolve(reason); };
      ack = () => done('flushed');
      try { win.webContents.send('sq:flush-for-quit'); } catch { done('send-failed'); }
    });
    return pending;
  }
  return { flush };
}

/** The unload veto a `beforeunload` guard raises (unsaved work) must not keep a window open while the app is leaving:
 * the flush above already pushed whatever the guard counts. Wire: webContents.on('will-prevent-unload', ignoreVetoWhileLeaving(...)). */
export const ignoreVetoWhileLeaving = isLeaving => event => { if (isLeaving()) event.preventDefault(); };
