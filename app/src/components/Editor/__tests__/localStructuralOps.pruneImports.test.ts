/**
 * Deleting the last use of an imported component removes its `import` line too
 * (owner: a deleted `<Layout>` left `import Layout` behind). Undo must still
 * land the restore on the ORIGINAL line, so the inverse re-adds the import
 * BEFORE restoring the element.
 */
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
import { applyStructuralTransform } from '@/services/durableEdits/structuralTransform';
import { clearLocalPendingSelection } from '@/utils/localPendingSelection';
import { deleteLocalElement, _resetStructuralWriteInFlightForTests } from '../localStructuralOps';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile } from '@/utils/localPageSync';
import type { StructuralUndoRecord } from '@/store/structuralUndo';

const PAGE_FILE = 'src/pages/index.astro';
const ORIGINAL = "---\nimport Card from '../components/Card.astro';\nimport Keep from '../components/Keep.astro';\n---\n<main>\n  <Card />\n  <Keep />\n</main>\n";
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests(); clearLocalPendingSelection();
  projectId = `browser_prune_${crypto.randomUUID()}`;
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

describe('deleteLocalElement — orphaned import pruning', () => {
  it('removes the import of the deleted component, keeps the used one, and the inverse restores the original bytes', async () => {
    const pushUndo = vi.fn<(r: StructuralUndoRecord) => void>();
    const ok = await deleteLocalElement({ key: `${PAGE_FILE}:6:3`, clearSelection: vi.fn(), pushUndo });
    expect(ok).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    const { acceptedRevision } = await storage.getDurableProjectState(projectId);
    await flushDurableSourceWritesThrough(projectId, acceptedRevision);
    const after = runtime.read(PAGE_FILE);
    expect(after).toBe("---\nimport Keep from '../components/Keep.astro';\n---\n<main>\n  <Keep />\n</main>\n");

    // Inverse replays in order: re-add the import, THEN restore the element at its original line.
    const { inverse, forward } = pushUndo.mock.calls[0][0].structuralOp;
    expect(inverse.map(op => op.kind)).toEqual(['restore-region', 'restore']);
    expect(forward.map(op => op.kind)).toEqual(['remove', 'restore-region']);
    // Redo replays forward on the original and lands on the pruned file.
    let redone = ORIGINAL;
    for (const op of forward) redone = applyStructuralTransform(redone, op).content;
    expect(redone).toBe(after);
    let content = after;
    for (const op of inverse) content = applyStructuralTransform(content, op).content;
    expect(content).toBe(ORIGINAL);
  });
});
