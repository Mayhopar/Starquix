import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installCrashLog } from '../src/crash-log.mjs';
const dirs = []; const installed = [];
afterEach(async () => {
  for (const log of installed.splice(0)) process.off('uncaughtException', log);
  await Promise.all(dirs.splice(0).map(d => fs.rm(d, { recursive: true, force: true })));
});
// 2026-11-09: an uncaught main-process exception was only Electron's modal dialog (Dock launch: no stderr), never logged.
it('an exception nothing in main caught lands in the log with its stack, and Electron stands its dialog down', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-crash-')); dirs.push(dir);
  const file = path.join(dir, 'logs/main.log'); // the folder does not exist yet
  const before = process.listenerCount('uncaughtException');
  const log = installCrashLog(file); installed.push(log);
  // Electron 44 shows "A JavaScript error occurred in the main process" only while its own listener is the only one.
  expect(process.listeners('uncaughtException')).toContain(log);
  expect(process.listenerCount('uncaughtException')).toBe(before + 1);
  log(new Error('boom'), 'uncaughtException');
  log('not an error', 'uncaughtException'); // `throw 'text'` has no stack
  const text = await fs.readFile(file, 'utf8');
  expect(text).toMatch(/^\S+Z \[uncaughtException\] Error: boom\n\s+at /);
  expect(text).toContain('[uncaughtException] not an error');
});
it('a log that cannot be written never throws out of the handler', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-crash-')); dirs.push(dir);
  await fs.writeFile(path.join(dir, 'file'), '');
  const log = installCrashLog(path.join(dir, 'file/main.log')); installed.push(log); // a file where the folder should be
  expect(() => log(new Error('boom'), 'uncaughtException')).not.toThrow();
});
