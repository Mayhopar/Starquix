// @vitest-environment node
// Audit 2026-10-18 (e): source-command rewrote the user's file in place. A crash
// or full disk mid-write left torn bytes that match neither prepared state, so
// the CAS could only answer "unknown" — forever. Write a sibling temp, rename it.
import 'fake-indexeddb/auto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { prepareSourceCommand, dispatchSourceCommand } from '@/services/durableEdits/commandReceipts';

const crash = vi.hoisted(() => ({ armed: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    const [target, data] = args;
    if (crash.armed && String(target).includes(`${join('src', 'pages')}`)) {
      crash.armed = false;
      const bytes = Buffer.from(data as string);
      fs.writeFileSync(target, bytes.subarray(0, bytes.length >> 1)); // half the bytes reached disk
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    }
    return fs.writeFileSync(...args);
  } };
});

const projectId = 'browser_atomic_source_command';
const file = 'src/pages/index.astro';
const before = '<main class="p-2"><h1>Привет</h1></main>\n';
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => { await db.delete(); await db.open(); runtime = projectFsRuntime(projectId, { [file]: before }); });
afterEach(() => { crash.armed = false; runtime.close(); });

it.each([
  ['a whole-file batch', { kind: 'file-batch' as const, payload: { files: [{ file, beforeSource: before, afterSource: before.replace('Привет', 'Пока') }] } }],
  ['a class edit', { kind: 'class-write' as const, payload: { sourceLocation: { file, line: 1, column: 1 }, newClasses: 'p-4', baseClasses: 'p-2', origin: { armed: true, pageFile: file } } }],
])('a write that dies halfway through %s leaves the old bytes, then retries cleanly', async (_name, command) => {
  await prepareSourceCommand(projectId, 'atomic', command);
  crash.armed = true;
  expect(await dispatchSourceCommand(projectId, 'atomic')).toMatchObject({ status: 'not-written' });
  expect(runtime.read(file)).toBe(before);
  expect(readdirSync(join(runtime.root, 'src/pages'))).toEqual(['index.astro']);
  expect(await dispatchSourceCommand(projectId, 'atomic')).toMatchObject({ status: 'written' });
  expect(runtime.read(file)).not.toBe(before);
});
