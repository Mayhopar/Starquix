// An exception nothing in main caught: its stack is appended to a log file. Any listener of our own
// also stands Electron's modal "A JavaScript error occurred in the main process" down — Electron 44
// shows it only while its listener is the only one, and main keeps running either way. A Dock-launched
// app has no stderr: before this, nothing was kept. (Unhandled rejections never come here: Electron
// main runs them in warn mode — a stderr warning, no dialog.)
import fs from 'node:fs';
import path from 'node:path';
export function installCrashLog(file) {
  const log = (error, origin) => {
    const entry = `${new Date().toISOString()} [${origin}] ${error?.stack ?? error}\n`;
    console.error('[main uncaught]', entry);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, entry); } catch {} // the last line of defense never throws
  };
  process.on('uncaughtException', log);
  return log;
}
