import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { persistClassToFile, useClassPersistenceQueue } from '../useClassPersistenceQueue';
import { viteClassWriter } from '@/services/ViteClassWriter';
import { setServerWriteMode } from '@/services/serverWriteMode';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { getClassWriteBaseline, noteClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { capturePreviewBaseline } from '@/components/Canvas/reloadPreview';
vi.mock('@/components/Canvas/reloadPreview', () => ({ capturePreviewBaseline: vi.fn(async () => null) }));
vi.mock('react-hot-toast', () => ({ default: vi.fn() }));
// One disk: a save requires the files-truth journal to own the project.
const journal = vi.hoisted(() => ({ projectId: null as string | null }));
vi.mock('@/services/filesTruthSync', () => ({
  syncChangedFiles: async () => {},
  getFilesTruthSyncStatus: () => ({ projectId: journal.projectId, status: 'idle', error: null }),
  subscribeFilesTruthSyncStatus: () => () => {},
}));
const loc = { file: 'src/pages/index.astro', line: 3, column: 1 };
const key = 'src/pages/index.astro:3:1';
const target = (classes: string) => `<div data-sq-source="${key}" class="${classes}"></div>`;
let project: string;
let counter = 0;
let frame: HTMLIFrameElement;
let send: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // An UNMARKED project: local (files-truth) projects save classes through the
  // durable journal (ViteClassWriter.durableLocal.test.ts); this file pins the
  // legacy iframe writer that only an unmarked project still reaches.
  vi.useFakeTimers(); project = `browser_lf_writer_${++counter}`; journal.projectId = project;
  setActiveSaveProjectId(project); setServerWriteMode(true);
  setLocalExpectedRoute('/'); setLocalPageFile(loc.file);
  resetClassWriteBaselines(); noteClassWriteBaseline(key, 'p-2');
  send = vi.fn(); frame = { contentWindow: { postMessage: send } } as unknown as HTMLIFrameElement;
  viteClassWriter.setLocalInstanceState({ status: 'running', url: 'http://localhost:5311' });
  viteClassWriter.setIframeRef(frame);
  error = vi.spyOn(console, 'error'); warn = vi.spyOn(console, 'warn');
  vi.mocked(capturePreviewBaseline).mockReset();
});
afterEach(async () => {
  await act(async () => { cleanup(); });
  viteClassWriter.setIframeRef(null); viteClassWriter.setLocalInstanceState(null);
  setServerWriteMode(false); setActiveSaveProjectId(null); _resetLocalPageSyncForTests();
  vi.useRealTimers(); vi.restoreAllMocks();
});
function ack(success = true) {
  const payload = send.mock.calls.at(-1)![0].payload;
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
    type: 'SQ_WRITE_RESULT', payload: { requestId: payload.requestId, success, error: 'class:list has no editable leading literal' },
  } }));
}
function expectedFailure() {
  error.mockImplementation((...args: unknown[]) => {
    if (args[0] !== '[ClassStore] Failed to write:') throw new Error(`Unexpected error: ${args}`);
  });
}
it('a running raw writer without its frame rejects, retaining its failure until a verified retry', async () => {
  expectedFailure();
  warn.mockImplementation((...args: unknown[]) => { expect(args).toEqual(['[ViteClassWriter] Iframe ref not set, skipping write']); });
  viteClassWriter.setIframeRef(null);
  await expect(persistClassToFile(loc, 'p-4', key)).rejects.toThrow(/not dispatched/i);
  expect(send).not.toHaveBeenCalled();
  expect(getClassWriteBaseline(key)).toBe('p-2');
  viteClassWriter.setIframeRef(frame);
  const saving = persistClassToFile(loc, 'p-4', key); ack(); await saving;
 ;
  expect(getClassWriteBaseline(key)).toBe('p-4');
});
it('a negative ACK cannot recover even when the actual target matches', async () => {
  expectedFailure(); vi.mocked(capturePreviewBaseline).mockResolvedValue(target('p-4'));
  const saving = persistClassToFile(loc, 'p-4', key); ack(false);
  await expect(saving).rejects.toThrow(/class:list/);
  expect(capturePreviewBaseline).not.toHaveBeenCalled(); expect(getClassWriteBaseline(key)).toBe('p-2');
});
it.each([
  ['sibling only', `${target('p-2')}<div data-sq-source="src/pages/index.astro:4:1" class="p-4"></div>`, 'p-4'],
  ['missing target', '<nav class="p-4"></nav>', 'p-4'],
  ['ambiguous target', target('p-4') + target('p-4'), 'p-4'],
  ['empty requested classes', target(''), ''],
])('timeout cannot certify %s', async (_name, html, classes) => {
  expectedFailure(); vi.mocked(capturePreviewBaseline).mockResolvedValue(html);
  const saving = persistClassToFile(loc, classes, key);
  const rejected = expect(saving).rejects.toThrow(/timeout/);
  await Promise.all([vi.advanceTimersByTimeAsync(10000), rejected]);
  expect(getClassWriteBaseline(key)).toBe('p-2');
});
it('a lost ACK recovers only the uniquely identified target and requested class value', async () => {
  vi.mocked(capturePreviewBaseline).mockResolvedValue(target('p-4') + '<div class="p-2"></div>');
  const saving = persistClassToFile(loc, 'p-4', key);
  await vi.advanceTimersByTimeAsync(10000); await saving;
  expect(getClassWriteBaseline(key)).toBe('p-4'); expect(error).not.toHaveBeenCalled();
});
it('a newer acknowledged edit supersedes a read-only recovery already in progress', async () => {
  let finishRead!: (html: string) => void;
  vi.mocked(capturePreviewBaseline).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const first = persistClassToFile(loc, 'p-4', key);
  const firstOutcome = first.then(() => 'resolved', () => 'rejected');
  await vi.advanceTimersByTimeAsync(10000);
  const next = persistClassToFile(loc, 'p-8', key); ack(); await next;
  finishRead(target('p-4'));
  expect(await firstOutcome).toBe('resolved');
  expect(getClassWriteBaseline(key)).toBe('p-8');
  expect(error).not.toHaveBeenCalled();
});
it('changing the active owner during a recovery read cannot certify the old save', async () => {
  expectedFailure();
  let finishRead!: (html: string) => void;
  vi.mocked(capturePreviewBaseline).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const saving = persistClassToFile(loc, 'p-4', key);
  const outcome = saving.then(() => 'resolved', () => 'rejected');
  await vi.advanceTimersByTimeAsync(10000);
  setActiveSaveProjectId('browser_lf_other');
  finishRead(target('p-4'));
  expect(await outcome).toBe('rejected');
  expect(getClassWriteBaseline(key)).toBe('p-2');
 ;
});
