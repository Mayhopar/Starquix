// Shared fixture for the local (files-truth) keyboard-delete tests: a real
// route table over a temp disk (projectFsRuntime), a fresh fake-indexeddb
// durable store, the active save project, and an armed local page surface.
// Since fdd2d12f the group delete no longer calls deleteLocalElement per
// member — it plans every source member into ONE source gesture and accepts
// it durably — so these tests observe the real accepted edit and the disk.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import * as storage from '@/services/durableEdits/store';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import {
  _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalPageFile, setLocalScannedRoute,
} from '@/utils/localPageSync';
import { _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth } from '@/utils/localMode';

/** A FRESH files-truth project id per test: the materializer keeps per-project
 *  module state (materialized revision), so reusing an id across a db reset
 *  makes revision 1 of the next test look already materialized. */
export function freshLocalProjectId(tag: string): string {
  const id = `browser_lf_${tag}_${webcrypto.randomUUID()}`;
  markFilesTruth(id);
  return id;
}

export const PAGE_FILE = 'src/pages/index.astro';

/** `lines` is 1-based: lines[n] is the text of line n; missing lines are `<p>L{n}</p>`. */
export function pageSource(count: number, lines: Record<number, string> = {}): string {
  return Array.from({ length: count }, (_, i) => lines[i + 1] ?? `<p>L${i + 1}</p>`).join('\n') + '\n';
}

export function armLocalPage(): void {
  setLocalPageFile(PAGE_FILE);
  setLocalExpectedRoute('/');
  setLocalScannedRoute('/');
}

export async function startLocalDeleteRuntime(projectId: string, files: Record<string, string>) {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests();
  setActiveSaveProjectId(projectId);
  const runtime = projectFsRuntime(projectId, files);
  armLocalPage();
  return runtime;
}

/** Materialize every accepted revision onto the temp disk. */
export async function flushAccepted(projectId: string): Promise<number> {
  const { acceptedRevision } = await storage.getDurableProjectState(projectId);
  if (acceptedRevision) await flushDurableSourceWritesThrough(projectId, acceptedRevision);
  return acceptedRevision ?? 0;
}

export async function stopLocalDeleteRuntime(runtime: { close(): void } | undefined, projectId: string) {
  try { await flushAccepted(projectId); } catch { /* a test may leave a retained edit */ }
  runtime?.close();
  setActiveSaveProjectId(null);
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests();
  vi.unstubAllGlobals();
}
