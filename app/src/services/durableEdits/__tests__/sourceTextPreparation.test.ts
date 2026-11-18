import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { prepareSourceCommand } from '../commandReceipts';

let runtime: ReturnType<typeof projectFsRuntime> | undefined;
beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open(); });
afterEach(() => { runtime?.close(); vi.unstubAllGlobals(); });

it('refuses unprepared text edits instead of silently preparing only their selector payload', async () => {
  const projectId = `browser_unprepared_text_${crypto.randomUUID()}`;
  const file = 'src/pages/index.astro';
  runtime = projectFsRuntime(projectId, { [file]: '<p>Original</p>\n' });
  await expect(prepareSourceCommand(projectId, 'unprepared-text', { kind: 'source-batch', payload: {
    payloads: [{ astroSource: file, overrides: {} }], skipped: [],
    sourceTextEdits: [{ sourceLocation: { file, line: 1, column: 1 }, text: 'Must not disappear',
      origin: { pageFile: file, armed: true } }],
  } })).rejects.toThrow(/text.*prepar|prepar.*text/i);
  expect(await db.durableCommandReceipts.count()).toBe(0);
  expect(runtime.read(file)).toBe('<p>Original</p>\n');
});
