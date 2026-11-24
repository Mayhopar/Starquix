/**
 * Issue #7 investigation (results-L3 ghost#0, L2 b#0): a text edit the files
 * cannot carry was kept on the canvas with no toast — an untracked ("Not
 * editable") element took a doc-only path, and a refused acceptance was only a
 * console.error while its draft brought the text back on the next scan. Every
 * local text edit now goes through the one acceptance; its refusal is toasted,
 * the frame restored and the draft dropped.
 */
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { handleEditModeExited } from '../textEditing';
import { clearTextDraft } from '../textDrafts';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { acceptEditorCommands } from '@/store/commandGesture';
import { SourcePreparationRefused } from '@/services/durableEdits/commandReceipts';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';

vi.mock('@/store/commandGesture', () => ({ acceptEditorCommands: vi.fn() }));
vi.mock('../textDrafts', () => ({ clearTextDraft: vi.fn(async () => {}) }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const PROJECT = 'local_text_refusal', KEY = 'dynamic:h1:1@x', REASON = 'not editable — open in code';
afterEach(() => unmarkFilesTruth(PROJECT));

it('an untracked element’s text is refused through the local acceptance: toast, frame restored, draft dropped', async () => {
  markFilesTruth(PROJECT);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(acceptEditorCommands).mockRejectedValue(new SourcePreparationRefused(REASON));
  const { iframe, postMessage } = makeFakeIframe();
  const ctx = makeFakeCtx({ env: { doc: new Y.Doc(), projectId: PROJECT }, refs: { iframe } as never });

  await handleEditModeExited(ctx, { key: KEY, textContent: 'Heading ZZ', originalText: 'Heading' });

  expect(acceptEditorCommands).toHaveBeenCalledTimes(1);
  expect(ctx.actions.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SOURCE_TEXT' }));
  expect(toast.error).toHaveBeenCalledWith(REASON);
  expect(postMessage).toHaveBeenCalledWith({ type: 'RESTORE_ORIGINAL_TEXT', payload: { key: KEY } }, '*');
  expect(clearTextDraft).toHaveBeenCalledWith(KEY);
});
