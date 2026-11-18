import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { db } from '@/db';
import { acceptStoredEdit } from '@/services/durableEdits/store';
import { _resetLocalPageSyncForTests, admitLocalSourceScan, getLocalSourceScanRevision, restoreLocalSourceScanState, setLocalExpectedRoute, setLocalPageFile } from '../localPageSync';
import { clearLocalPendingSelection, peekLocalPendingSelection, resolveOwnedLocalPendingMatch, setLocalPendingSelection } from '../localPendingSelection';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';

afterEach(async () => { clearLocalPendingSelection(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); await db.delete(); });

it('reconstructs accepted scan evidence after restart before adopting a preview', async () => {
  await db.open();
  const file = 'src/pages/index.astro';
  await acceptStoredEdit({ projectId: 'scan-restart', operationId: 'pending-class', yjsUpdate: null,
    commands: [{ kind: 'class-write', payload: { sourceLocation: { file, line: 1, column: 1 }, newClasses: 'p-4', baseClasses: '', origin: null,
      preparedFiles: [{ file, beforeSource: '<p>A</p>', afterSource: '<p class="p-4">A</p>', identityMaps: [{ id: 'map', beforeVersion: 's1:8', afterVersion: 's2:20', entries: [] }] }],
    } }],
  });
  await restoreLocalSourceScanState('scan-restart');
  setLocalExpectedRoute('/'); setLocalPageFile(file);
  const scan = (sourceVersion: string) => [{ sourceLocation: { file, line: 1, column: 1, sourceVersion } }];
  expect(admitLocalSourceScan('scan-restart', '/', scan('s2:20'))).toBe(true);
  expect(getLocalSourceScanRevision()).toBe(1);
});

it('follows the accepted inserted element through a later line shift and scopes selection to its surface', async () => {
  await db.open();
  const projectId = 'selection-project';
  const file = 'src/pages/index.astro';
  const accept = async (operationId: string, beforeVersion: string, afterVersion: string, before: {line:number; column:number} | null, after: {line:number; column:number}) => {
    await acceptStoredEdit({ projectId, operationId, yjsUpdate: null, commands: [{ kind: 'file-batch', payload: { files: [{ file, beforeSource: '', afterSource: '', identityMaps: [{ id: operationId, beforeVersion, afterVersion, entries: [{ before, after }] }] }] } }] });
    await restoreLocalSourceScanState(projectId);
  };
  setActiveSaveProjectId(projectId); setLocalExpectedRoute('/'); setLocalPageFile(file);
  await accept('insert', 's1:8', 's2:20', null, { line: 3, column: 3 });
  setLocalPendingSelection(file, 3);
  const pending = peekLocalPendingSelection()!;
  await accept('shift', 's2:20', 's3:30', { line: 3, column: 3 }, { line: 5, column: 3 });
  const elements = [3, 5].map(line => ({ key: `${file}:${line}:3`, sourceLocation: { file, line, column: 3, sourceVersion: 's3:30' } }));
  expect(await resolveOwnedLocalPendingMatch(pending, elements, projectId, 2)).toEqual({ key: `${file}:5:3`, consumed: true });
  setLocalExpectedRoute('/about'); setLocalExpectedRoute('/');
  expect(await resolveOwnedLocalPendingMatch(pending, elements, projectId, 2)).toEqual({ key: null, consumed: true });
  setLocalPendingSelection(file, 5);
  const projectVisit = peekLocalPendingSelection()!;
  setActiveSaveProjectId('another-project'); setActiveSaveProjectId(projectId);
  expect(await resolveOwnedLocalPendingMatch(projectVisit, elements, projectId, 2)).toEqual({ key: null, consumed: true });
});

// Desktop 2026-10-04 (logs): after a canvas reorder was ACCEPTED (rev 2), the
// still-live old document rescanned (typing triggers it) and was stamped rev 2
// although its bytes were rev 1's. A text edit from that scan then skipped the
// rev-2 map ('Source target version does not match the projected source
// baseline') and the typed text never reached disk. A scan names the revision
// its BYTES belong to.
it('stamps a scan of an older accepted file version with that version\'s revision, so its coordinates project through later maps', async () => {
  await db.open();
  const projectId = 'stale-bytes-scan', file = 'src/pages/index.astro';
  const accept = async (operationId: string, beforeVersion: string, afterVersion: string, entries: Array<[[number, number], [number, number]]>) => {
    await acceptStoredEdit({ projectId, operationId, yjsUpdate: null, commands: [{ kind: 'file-batch', payload: { files: [{ file, beforeSource: '', afterSource: '',
      identityMaps: [{ id: operationId, beforeVersion, afterVersion, entries: entries.map(([b, a]) => ({ before: { line: b[0], column: b[1] }, after: { line: a[0], column: a[1] } })) }] }] } }] });
    await restoreLocalSourceScanState(projectId);
  };
  setActiveSaveProjectId(projectId); setLocalExpectedRoute('/'); setLocalPageFile(file);
  await accept('reorder-layers', 's1:8', 's2:20', [[[10, 5], [12, 5]], [[11, 5], [10, 5]], [[12, 5], [11, 5]]]);
  await accept('reorder-canvas', 's2:20', 's3:30', [[[10, 5], [12, 5]], [[11, 5], [10, 5]], [[12, 5], [11, 5]]]);
  // The old document (rev-1 bytes s2:20) rescans AFTER rev 2 was accepted.
  const stale = [{ key: `${file}:11:5`, sourceLocation: { file, line: 11, column: 5, sourceVersion: 's2:20' } }];
  expect(admitLocalSourceScan(projectId, '/', stale)).toBe(true);
  expect(stale[0].sourceLocation).toMatchObject({ sourceVersion: 's2:20', sourceRevision: 1 });
  const { resolveProjectedSourceLocation } = await import('@/services/durableEdits/sourceIdentity');
  expect(await resolveProjectedSourceLocation(projectId, stale[0].sourceLocation, 0)).toMatchObject({ line: 10, column: 5, sourceVersion: 's3:30' });
  // The current document keeps the arrival revision (unchanged behavior).
  const fresh = [{ key: `${file}:10:5`, sourceLocation: { file, line: 10, column: 5, sourceVersion: 's3:30' } }];
  admitLocalSourceScan(projectId, '/', fresh);
  expect(fresh[0].sourceLocation).toMatchObject({ sourceRevision: 2 });
});
