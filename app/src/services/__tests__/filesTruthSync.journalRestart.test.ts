// Audit 2026-10-18 (f): an in-process Astro restart re-creates the instance's
// change journal at seq 0 while the editor keeps its cursor (lastSeq = max), so
// every write after the restart was skipped and Dexie/Export went stale.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import { readProjectFiles } from '@/db/projectFiles';
import { localFetch } from '@/utils/sqLocalBase';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { startFilesTruthSync, stopFilesTruthSync, syncChangedFiles } from '../filesTruthSync';

const projectId = 'browser_journal_restart';
let runtime: ReturnType<typeof projectFsRuntime>;
const write = (file: string, content: string) => localFetch('/__sq/local/write-file', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, content }) });
beforeEach(async () => {
  await db.delete(); await db.open();
  runtime = projectFsRuntime(projectId, { 'src/pages/a.astro': 'a0', 'src/pages/b.astro': 'b0' });
  startFilesTruthSync(projectId);
});
afterEach(() => { stopFilesTruthSync(); runtime.close(); });

it.each([
  ['restarts behind the old cursor', 1],
  ['restarts and passes the old cursor', 5],
])('mirrors every write after the journal %s', async (_name, laterWrites) => {
  for (const n of [1, 2, 3]) await write('src/pages/a.astro', `a${n}`);
  await syncChangedFiles();
  runtime.restart(); // same files on disk, a fresh journal at seq 0
  await write('src/pages/b.astro', 'Привет');
  for (let n = 1; n < laterWrites; n++) await write('src/pages/a.astro', `a-late-${n}`);
  await syncChangedFiles();
  const mirror = await readProjectFiles(projectId);
  expect(mirror['src/pages/b.astro']).toBe('Привет');
  expect(mirror['src/pages/a.astro']).toBe(runtime.read('src/pages/a.astro'));
});
