/**
 * Instance edits (Figma model, owner ruling 2026-09-10): a class edit on a
 * COMPONENT usage made from a page view (Classes tab → Apply on `main p` of
 * Main.astro while editing about.astro) is an INSTANCE override. It stays in
 * the doc's sourceClasses tier (persisted by hooks/useSourceOverridesPersistence,
 * `*` + Push / Reset in the DesignBar) — the queue must neither dispatch it to
 * the master file nor refuse it with the cross-file toast. Only Push writes
 * the master.
 */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { db } from '@/db';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { classCommands } from '@/services/durableEdits/classCommands';
import { markFilesTruth } from '@/utils/localMode';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import { persistClassToFile, useClassPersistenceQueue } from '../useClassPersistenceQueue';
import { viteClassWriter } from '@/services/ViteClassWriter';
import { setServerWriteMode } from '@/services/serverWriteMode';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { LOCAL_CROSS_FILE_WRITE_EVENT, type LocalCrossFileWriteDetail } from '@/utils/localWriteScope';

vi.mock('react-hot-toast', () => ({ default: vi.fn() }));

const componentLoc = { file: 'src/components/Main.astro', line: 8, column: 3 };
const key = 'src/components/Main.astro:8:3';
let send: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
let refusals: string[];
const onRefusal = (e: Event) => { refusals.push((e as CustomEvent<LocalCrossFileWriteDetail>).detail.file); };

beforeEach(() => {
  vi.useFakeTimers();
  const project = 'browser_lf_cross_file_refusal'; markFilesTruth(project); setActiveSaveProjectId(project);
  setServerWriteMode(true); setLocalExpectedRoute('/about'); setLocalPageFile('src/pages/about.astro');
  resetClassWriteBaselines();
  send = vi.fn();
  viteClassWriter.setLocalInstanceState({ status: 'running', url: 'http://localhost:5311' });
  viteClassWriter.setIframeRef({ contentWindow: { postMessage: send } } as unknown as HTMLIFrameElement);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  refusals = [];
  window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal);
});
afterEach(async () => {
  await act(async () => { cleanup(); });
  window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal);
  viteClassWriter.setIframeRef(null); viteClassWriter.setLocalInstanceState(null);
  setServerWriteMode(false); setActiveSaveProjectId(null); _resetLocalPageSyncForTests();
  vi.useRealTimers(); vi.restoreAllMocks();
});

it('persistClassToFile absorbs a component write from a page origin: no dispatch, no refusal, no warning', async () => {
  await persistClassToFile(componentLoc, 'p-4', key, { armed: true, pageFile: 'src/pages/about.astro' });
  expect(send).not.toHaveBeenCalled();
  expect(refusals).toEqual([]);
  expect(warn).not.toHaveBeenCalled();
});

it('a component instance edit accepts its overlay without any master source command', async () => {
  vi.useRealTimers();
  const doc = new Y.Doc();
  const projectId = 'browser_lf_cross_file_refusal';
  const accepted = await acceptProjectEdit(doc, { projectId, operationId: 'instance-overlay',
    commands: classCommands(componentLoc, 'p-4', 'p-2'), mutate: staged => staged.getMap('source-values').set(key, 'p-4') });
  expect((await db.durableEdits.get(`${projectId}:${accepted.operationId}`))?.commands).toEqual([]);
  expect(doc.getMap('source-values').get(key)).toBe('p-4'); doc.destroy();
  expect(send).not.toHaveBeenCalled();
  expect(refusals).toEqual([]);
});

it('a same-file page write from the page origin is written — as a durable class-write, never through the iframe', async () => {
  vi.useRealTimers();
  const pageLoc = { file: 'src/pages/about.astro', line: 2, column: 1 };
  void persistClassToFile(pageLoc, 'p-4', 'src/pages/about.astro:2:1', { armed: true, pageFile: 'src/pages/about.astro' });
  await vi.waitFor(async () => {
    const commands = (await db.durableEdits.toArray()).flatMap(row => row.commands ?? []);
    expect(commands.some(c => c.kind === 'class-write' && c.payload.sourceLocation?.file === pageLoc.file)).toBe(true);
  });
  expect(send).not.toHaveBeenCalled();
  expect(refusals).toEqual([]);
});
