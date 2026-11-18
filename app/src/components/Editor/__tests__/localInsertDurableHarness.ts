/**
 * Shared fixture for the localComponentInsert suites (files-truth, 2026-09).
 *
 * insertLocalComponent no longer calls viteStructuralWriter: it transforms the
 * PROJECTED source of a `browser_` project (prepareSourceGesture), accepts the
 * whole gesture durably into Dexie (acceptFileChanges), and the materializer
 * writes the file batch to the instance afterwards. So a test needs: a
 * project id (active save project), fake IndexedDB, the real
 * `/__sq/local/*` route table over a temp disk (projectFsRuntime), and the
 * page-sync gate armed. `flush()` materializes every accepted edit to disk.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { _resetStructuralWriteInFlightForTests } from '../localStructuralOps';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile } from '@/utils/localPageSync';
import { clearLocalPendingSelection } from '@/utils/localPendingSelection';

export interface DurableInsertProject {
  projectId: string;
  /** The `wc://<id>` folder the code receives as localProjectPath. */
  folder: string;
  runtime: ReturnType<typeof projectFsRuntime>;
  read: (file: string) => string;
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

export async function openDurableInsertProject(files: Record<string, string>, pageFile = 'src/pages/index.astro'): Promise<DurableInsertProject> {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
  const projectId = `browser_insert_${webcrypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
  const runtime = projectFsRuntime(projectId, files);
  setLocalPageFile(pageFile); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const flush = () => flushDurableSourceWrites(projectId);
  return {
    projectId, folder: `wc://${projectId}`, runtime, read: runtime.read, flush,
    async close() {
      await flush().catch(() => {});
      runtime.close();
      setActiveSaveProjectId(null);
      _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
    },
  };
}
