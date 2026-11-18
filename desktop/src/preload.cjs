// Sandboxed preload: the ONLY desktop capability the editor page gets.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sqDesktop', {
  /** Shell command that runs the bundled coding-agent relay (null = unavailable). */
  mcpCommand: ipcRenderer.sendSync('sq:mcp-command'),
  /** Windows: { command, args, env } an agent's MCP config runs (agents spawn an .exe, never the .cmd); null elsewhere. */
  mcpServer: ipcRenderer.sendSync('sq:mcp-server'),
  /** The relay pairing code (~/.starquix-mcp/daemon.json): every project dials it, no pasted code. */
  mcp: {
    code: () => ipcRenderer.invoke('sq:mcp-code'),
    rotate: () => ipcRenderer.invoke('sq:mcp-rotate'),
    onCode: callback => {
      const listener = (_event, code) => callback(code);
      ipcRenderer.on('sq:mcp-code', listener);
      return () => ipcRenderer.removeListener('sq:mcp-code', listener);
    },
  },
  /** Update notifier: { current, latest } — latest = a newer release with this machine's installer, else null. */
  update: {
    state: () => ipcRenderer.invoke('sq:update-state'),
    onState: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('sq:update', listener);
      return () => ipcRenderer.removeListener('sq:update', listener);
    },
  },
  exists: id => ipcRenderer.invoke('sq:exists', id),
  start: (id, lease, seed) => ipcRenderer.invoke('sq:start', id, lease, seed),
  stop: (id, lease) => ipcRenderer.invoke('sq:stop', id, lease),
  snapshot: (id, lease) => ipcRenderer.invoke('sq:snapshot', id, lease),
  status: (id, lease) => ipcRenderer.invoke('sq:status', id, lease),
  fetch: (...args) => ipcRenderer.invoke('sq:fetch', ...args),
  abort: (...args) => ipcRenderer.invoke('sq:abort', ...args),
  /** Versions + GitHub: one op allowlist in main (src/git/ops.mjs). */
  git: (id, lease, op, args) => ipcRenderer.invoke('sq:git', id, lease, op, args),
  /** MCP-mode terminal (desktop/src/terminal.mjs): the open project's shell; its output is pushed. */
  terminal: {
    attach: (id, lease) => ipcRenderer.invoke('sq:terminal-attach', id, lease),
    input: (id, lease, data) => ipcRenderer.invoke('sq:terminal-input', id, lease, data),
    resize: (id, lease, cols, rows) => ipcRenderer.invoke('sq:terminal-resize', id, lease, cols, rows),
    onOutput: callback => {
      const listener = (_event, id, data) => callback(id, data);
      ipcRenderer.on('sq:terminal-output', listener);
      return () => ipcRenderer.removeListener('sq:terminal-output', listener);
    },
  },
  /** Outside edits under an open terminal's project: the changed files' bytes and the gone paths. */
  onDiskChanged: callback => {
    const listener = (_event, id, change) => callback(id, change);
    ipcRenderer.on('sq:disk-changed', listener);
    return () => ipcRenderer.removeListener('sq:disk-changed', listener);
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('sq:state', listener);
    return () => ipcRenderer.removeListener('sq:state', listener);
  },
  /** Quit / window-close handshake (desktop/src/quit-flush.mjs): main asks the editor to push the input it holds and to
   *  accept it, then waits for quitFlushed() (<= 2 s) before it stops the Astro sessions. */
  onFlushForQuit: callback => {
    const listener = () => callback();
    ipcRenderer.on('sq:flush-for-quit', listener);
    return () => ipcRenderer.removeListener('sq:flush-for-quit', listener);
  },
  quitFlushed: () => ipcRenderer.send('sq:quit-flushed'),
});
