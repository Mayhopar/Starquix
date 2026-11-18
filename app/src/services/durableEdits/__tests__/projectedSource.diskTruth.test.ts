/**
 * Owner 2026-09-16: a Push wrote Feature.astro outside the durable journal
 * (the container + Dexie projectFiles moved to 2201 bytes, the last durable
 * row still said 2131). withProjectedSource seeded the file's baseline from
 * that stale row and projectionStart called the fresh scan "not owned", so
 * every later structural op on the file failed. Files are truth: the DISK is
 * the baseline for materialized rows, and a scan rendered from exactly the
 * disk bytes is fresh.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFileId } from '@/db/projectFiles';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalPageFile, setLocalScannedRoute } from '@/utils/localPageSync';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { prepareSourceGesture } from '../sourceGesture';
import { acceptFileChanges } from '../fileAcceptance';
import { sourceVersion } from '../sourceIdentity';

const file = 'src/components/Feature.astro';
const original = '<section>\n  <p>One</p>\n  <p>Two</p>\n</section>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_disk_truth_${crypto.randomUUID()}`; setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [file]: original });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});
afterEach(() => { runtime.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); });

const remove = async (line: number, version: string) => {
  const gesture = prepareSourceGesture(projectId);
  return acceptFileChanges(`wc://${projectId}`, async () => {
    await gesture.apply({ kind: 'remove', loc: await gesture.resolve({ file, line, column: 3, sourceVersion: version }) });
    return [...gesture.files.values()];
  });
};

/** What the journal pull does for a write the durable pipeline never saw. */
const outsideWrite = async (content: string) => {
  writeFileSync(join(runtime.root, file), content);
  await db.projectFiles.put({ id: projectFileId(projectId, file), projectId, path: file, content: new TextEncoder().encode(content), isText: true, updatedAt: Date.now() });
};

it('a structural op after an out-of-journal edit resolves against the DISK, not the stale durable row', async () => {
  await remove(2, sourceVersion(original));
  await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<section>\n  <p>Two</p>\n</section>\n');
  const pushed = '<section class="pushed">\n  <p>Two</p>\n</section>\n';
  await outsideWrite(pushed);
  await remove(2, sourceVersion(pushed));
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<section class="pushed">\n</section>\n');
});
