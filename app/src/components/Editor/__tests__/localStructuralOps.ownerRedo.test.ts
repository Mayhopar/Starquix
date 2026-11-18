/**
 * Owner report 2026-09-16: deleting the Layout node on a fresh project toasted
 * "Deleting the element was not confirmed" — the gesture-owner guard tripped
 * when a surface generation bump (route re-arm / StrictMode remount) landed
 * while the gesture was in flight. The generation asserts are gone: the
 * gesture is accepted on its source version, first try, no redo, no toast.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});
// First gesture: bump the surface generation mid-gesture (what a route re-arm does).
vi.mock('@/services/durableEdits/sourceGesture', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/durableEdits/sourceGesture')>();
  let armed = true;
  return {
    ...real,
    prepareSourceGesture: (...args: Parameters<typeof real.prepareSourceGesture>) => {
      (globalThis as { __gestureCalls?: number }).__gestureCalls = ((globalThis as { __gestureCalls?: number }).__gestureCalls ?? 0) + 1;
      const gesture = real.prepareSourceGesture(...args);
      if (armed) {
        armed = false;
        const apply = gesture.apply.bind(gesture);
        gesture.apply = async (op) => {
          const { setLocalExpectedRoute } = await import('@/utils/localPageSync');
          setLocalExpectedRoute('/elsewhere'); setLocalExpectedRoute('/');
          return apply(op);
        };
      }
      return gesture;
    },
  };
});

import toast from 'react-hot-toast';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';
import { clearLocalPendingSelection } from '@/utils/localPendingSelection';
import { deleteLocalElement, _resetStructuralWriteInFlightForTests } from '../localStructuralOps';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile } from '@/utils/localPageSync';

const PAGE_FILE = 'src/pages/index.astro';
const ORIGINAL = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
  projectId = `browser_owner_redo_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [PAGE_FILE]: ORIGINAL });
  setLocalPageFile(PAGE_FILE); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});

afterEach(async () => {
  const { acceptedRevision } = await storage.getDurableProjectState(projectId);
  if (acceptedRevision) await flushDurableSourceWritesThrough(projectId, acceptedRevision);
  runtime.close();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveSaveProjectId(null);
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
});

describe('deleteLocalElement — surface re-arm mid-gesture', () => {
  it('a gesture that straddles a surface re-arm deletes on the FIRST try without a toast', async () => {
    const ok = await deleteLocalElement({ key: `${PAGE_FILE}:2:3`, clearSelection: vi.fn(), pushUndo: vi.fn() });
    expect(ok).toBe(true);
    // No owner guard, no redo: the one gesture wrote.
    expect((globalThis as { __gestureCalls?: number }).__gestureCalls).toBe(1);
    expect(toast.error).not.toHaveBeenCalled();
    const { acceptedRevision } = await storage.getDurableProjectState(projectId);
    await flushDurableSourceWritesThrough(projectId, acceptedRevision);
    expect(runtime.read(PAGE_FILE)).toBe('<main>\n  <p>Two</p>\n</main>\n');
  });
});
