// Scan freshness remains diagnostic. Accepted source identity maps let the
// next gesture address the same element before preview/HMR or source ACK.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';
import { clearLocalPendingSelection } from '@/utils/localPendingSelection';
import { deleteLocalElement, moveLocalElement, _resetStructuralWriteInFlightForTests } from '../localStructuralOps';
import {
  _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalScannedRoute,
  setLocalPageFile, isLocalScanStaleAfterWrite, markLocalScanStaleAfterWrite, isLocalPageInSync,
} from '@/utils/localPageSync';

const PAGE_FILE = 'src/pages/index.astro';
const ORIGINAL = '<main>\n  <p>One</p>\n  <p>Two</p>\n  <p>Three</p>\n</main>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let release: () => void;

function armLocal() {
  setLocalPageFile(PAGE_FILE);
  setLocalExpectedRoute('/');
  setLocalScannedRoute('/');
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
  projectId = `browser_scan_diagnostic_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [PAGE_FILE]: ORIGINAL }, { beforeCommand: () => gate });
});

afterEach(async () => {
  release();
  const { acceptedRevision } = await storage.getDurableProjectState(projectId);
  if (acceptedRevision) await flushDurableSourceWritesThrough(projectId, acceptedRevision);
  runtime.close();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveSaveProjectId(null);
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
});

describe('post-write scan freshness diagnostics', () => {
  it('accepted delete marks the scan stale; a later admitted scan re-vouches', async () => {
    armLocal();
    expect(isLocalScanStaleAfterWrite()).toBe(false);
    const clearSelection = vi.fn();
    expect(await deleteLocalElement({ key: `${PAGE_FILE}:3:3`, clearSelection })).toBe(true);
    expect(clearSelection).toHaveBeenCalledOnce();
    expect(isLocalScanStaleAfterWrite()).toBe(true);
    expect(runtime.read(PAGE_FILE)).toBe(ORIGINAL);
    release(); await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read(PAGE_FILE)).toBe('<main>\n  <p>One</p>\n  <p>Three</p>\n</main>\n');
    setLocalScannedRoute('/');
    expect(isLocalScanStaleAfterWrite()).toBe(false);
  });

  it('rejected delete does not mark freshness stale or publish selection changes', async () => {
    armLocal();
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const clearSelection = vi.fn();
    expect(await deleteLocalElement({ key: `${PAGE_FILE}:3:3`, clearSelection })).toBe(false);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(isLocalScanStaleAfterWrite()).toBe(false);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read(PAGE_FILE)).toBe(ORIGINAL);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it('accepted move marks the scan stale before the source ACK', async () => {
    armLocal();
    expect(await moveLocalElement({ key: `${PAGE_FILE}:2:3`, targetKey: `${PAGE_FILE}:4:3`, position: 'after' })).toBe(true);
    expect(isLocalScanStaleAfterWrite()).toBe(true);
    expect(await storage.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
    release(); await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read(PAGE_FILE)).toBe('<main>\n  <p>Two</p>\n  <p>Three</p>\n  <p>One</p>\n</main>\n');
  });

  it('chained old-key delete and move actions use accepted identities without a rescan gate or saving message', async () => {
    armLocal();
    expect(await deleteLocalElement({ key: `${PAGE_FILE}:2:3`, clearSelection() {} })).toBe(true);
    expect(isLocalScanStaleAfterWrite()).toBe(true);
    expect(isLocalPageInSync()).toBe(true);
    // Both coordinates have shifted after deleting One. Keep the original
    // preview keys for Three, Two, and the following deletion of Two.
    expect(await moveLocalElement({ key: `${PAGE_FILE}:4:3`, targetKey: `${PAGE_FILE}:3:3`, position: 'before' })).toBe(true);
    expect(await deleteLocalElement({ key: `${PAGE_FILE}:3:3`, clearSelection() {} })).toBe(true);
    expect(await storage.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
    expect(runtime.read(PAGE_FILE)).toBe(ORIGINAL);
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    release(); await flushDurableSourceWritesThrough(projectId, 3);
    expect(runtime.read(PAGE_FILE)).toBe('<main>\n  <p>Three</p>\n</main>\n');
  });

  it('mark is a no-op while the local gate is disarmed', () => {
    markLocalScanStaleAfterWrite();
    expect(isLocalScanStaleAfterWrite()).toBe(false);
  });

  it('arming a different route clears freshness while retaining the route guard', () => {
    armLocal(); markLocalScanStaleAfterWrite();
    expect(isLocalScanStaleAfterWrite()).toBe(true);
    setLocalExpectedRoute('/about');
    expect(isLocalScanStaleAfterWrite()).toBe(false);
    expect(isLocalPageInSync()).toBe(false);
  });
});
