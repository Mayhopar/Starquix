import { expect, it, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitProjectFiles: vi.fn(async () => {}), flushDurableSourceWrites: vi.fn(async () => {}) }));
vi.mock('@/export/filesTruthZip', () => ({ downloadFilesTruthZip: vi.fn(async () => {}) }));
import { exportFilesTruthProject } from '../Editor';
import { awaitProjectFiles } from '@/services/durableEdits/sourceMaterialization';
import { downloadFilesTruthZip } from '@/export/filesTruthZip';
import { InstanceOverlayExportError } from '@/export/instanceOverlayGuard';
import { exportFailureMessage } from '@/export/operationFailure';
const doc = new Y.Doc();
beforeEach(() => vi.clearAllMocks());
it('does not read/download export artifacts until accepted edits have reached the project files', async () => {
  let finish!: () => void;
  vi.mocked(awaitProjectFiles).mockImplementationOnce(() => new Promise<void>(r => { finish = r; }));
  const exporting = exportFilesTruthProject('browser_p', 'Project', doc);
  await Promise.resolve();
  expect(downloadFilesTruthZip).not.toHaveBeenCalled();
  finish(); await exporting;
  expect(downloadFilesTruthZip).toHaveBeenCalledWith('browser_p', 'Project', doc);
});
it('a blocked projection prevents exporting stale files', async () => {
  vi.mocked(awaitProjectFiles).mockRejectedValueOnce(new Error('source refused'));
  await expect(exportFilesTruthProject('browser_p', 'Project', doc)).rejects.toThrow('Export could not start because a change has not reached the project files yet.');
  expect(downloadFilesTruthZip).not.toHaveBeenCalled();
});
it('an archive failure reports its stage without exposing the raw diagnostic', async () => {
  vi.mocked(downloadFilesTruthZip).mockRejectedValueOnce(new Error('RAW_ZIP /Users/private/site'));
  await expect(exportFilesTruthProject('browser_p', 'Project', doc)).rejects.toThrow('The project archive could not be prepared.');
  expect(awaitProjectFiles).toHaveBeenCalledOnce();
});
it('keeps actionable instance overlay refusal in the export message', async () => {
  vi.mocked(downloadFilesTruthZip).mockRejectedValueOnce(new InstanceOverlayExportError());
  const error = await exportFilesTruthProject('browser_p', 'Project', doc).catch(error => error);
  expect(exportFailureMessage(error)).toMatch(/Unpushed component instance edits.*Push.*reset/);
});
