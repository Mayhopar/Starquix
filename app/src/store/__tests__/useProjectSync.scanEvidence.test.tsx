import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '@/db';
import { acceptStoredEdit } from '@/services/durableEdits/store';
import { sourceVersion } from '@/services/durableEdits/sourceIdentity';
import { prepareSourceClassTarget } from '@/services/durableEdits/sourceClassIdentity';
import { _resetLocalPageSyncForTests, admitLocalSourceScan, setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { createEditorDoc } from '../createEditorDoc';
import { useProjectSync } from '../useProjectSync';

// Owner 2026-11-17: after an app start, a class edit on a page last written by MCP edit_file
// failed 'not owned by this project' — the desktop load never restored the scan evidence.
const projectId = 'browser_scan-evidence';
const file = 'src/pages/index.astro';
afterEach(async () => { _resetLocalPageSyncForTests(); unmarkFilesTruth(projectId); await db.delete(); });

it('a desktop project load restores scan evidence: a fresh scan of bytes written without a map stays editable', async () => {
  const v0 = '<div class="grid">A</div>', v1 = '<div class="grid gap-4">A</div>', v2 = '<div class="grid gap-8">A</div>';
  await acceptStoredEdit({ projectId, operationId: 'class', yjsUpdate: null, commands: [{ kind: 'file-batch', payload: { files: [{ file, beforeSource: v0, afterSource: v1,
    identityMaps: [{ id: 'm', beforeVersion: sourceVersion(v0), afterVersion: sourceVersion(v1), entries: [{ before: { line: 1, column: 1 }, after: { line: 1, column: 1 } }] }] }] } }] });
  await acceptStoredEdit({ projectId, operationId: 'edit-file', yjsUpdate: null, commands: [{ kind: 'file-batch', payload: { files: [{ file, beforeSource: v1, afterSource: v2 }] } }] });
  await db.projects.put({ id: projectId, name: 'Desktop project', filesTruth: true, pagesTree: [], createdAt: new Date(), updatedAt: new Date() });
  markFilesTruth(projectId);

  const onLoaded = vi.fn(), onError = vi.fn();
  const hook = renderHook(() => useProjectSync({ projectId, doc: createEditorDoc(), onLoaded, onError }));
  try {
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
    setLocalExpectedRoute('/'); setLocalPageFile(file);
    const scan = [{ key: `${file}:1:1`, classes: 'grid gap-8', sourceLocation: { file, line: 1, column: 1, sourceVersion: sourceVersion(v2) } }];
    expect(admitLocalSourceScan(projectId, '/', scan)).toBe(true);
    expect(scan[0].sourceLocation.sourceRevision).toBe(2);
    await expect(prepareSourceClassTarget(projectId, undefined, { sourceLocation: scan[0].sourceLocation }, 2)).resolves.toMatchObject({ reset: true });
  } finally { hook.unmount(); }
});
