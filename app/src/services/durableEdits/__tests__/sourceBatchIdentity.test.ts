import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { acceptProjectEdit } from '../acceptance';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { resolveProjectedSourceLocation } from '../sourceIdentity';
import type { WriteBackOverrides } from '@/vite-plugin/write-back-apply';
import * as receipts from '../commandReceipts';
import * as durableStore from '../store';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { retryMaterialization } from '../materializer';
import { collectOrderCommands } from '@/utils/masterOrderWrite';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { acceptEditorCommands } from '@/store/commandGesture';

const file = 'src/pages/index.astro';
let projectId: string, doc: Y.Doc;
let runtime: ReturnType<typeof projectFsRuntime>, release: () => void;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_source_batch_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  runtime?.close(); doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function source(text: string, loseAcknowledgement?: () => boolean) {
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: text }, { beforeCommand: () => gate, loseAcknowledgement });
}
function batch(overrides: WriteBackOverrides) {
  return acceptProjectEdit(doc, { projectId, operationId: crypto.randomUUID(), mutate() {}, commands: [{ kind: 'source-batch', payload: {
    payloads: [{ astroSource: file, overrides: overrides as Record<string, unknown> }], skipped: [],
  } }] });
}

it('write-back reorder maps the original preview key before the next source delete', async () => {
  source('<div>A</div>\n<div>B</div>\n');
  await batch({ orderOverrides: ['div-1', 'div-0'] });
  expect(await deleteLocalElement({ key: `${file}:2:1`, clearSelection() {} })).toBe(true);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<div>A</div>\n');
});

it('persists the permutation of byte-identical siblings before any subsequent read or ACK', async () => {
  source('<div>X</div>\n<div>X</div>\n');
  await batch({ orderOverrides: ['div-1', 'div-0'] });
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 1 })).toMatchObject({ line: 1, column: 1 });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
});

it.each([['distinct', 'A', 'B'], ['identical', 'X', 'X']])('repeated master root reorder commands retain %s original selector identities before a rescan', async (_kind, first, second) => {
  const original = `<div>${first}</div>\n<div>${second}</div>\n`; source(original);
  const keys = ['el-a:div-0', 'el-b:div-1'];
  const order = (ordered: string[], previous: string[]) => acceptEditorCommands(doc, [], undefined,
    collectOrderCommands(doc, COMPONENT_EDITOR_PAGE_ID, ordered, previous, { rootLevel: true, viewedComponentFile: file }));
  await order([...keys].reverse(), keys);
  await order(keys, [...keys].reverse());
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(original);
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 1 })).toMatchObject({ line: 2, column: 1 });
});

it('a fresh master scan uses its own selector revision instead of replaying a previous identical permutation', async () => {
  const original = '<div>X</div>\n<div>X</div>\n'; source(original);
  const keys = ['el-a:div-0', 'el-b:div-1'];
  await acceptEditorCommands(doc, [], undefined, collectOrderCommands(doc, COMPONENT_EDITOR_PAGE_ID, [...keys].reverse(), keys,
    { viewedComponentFile: file }));
  setLocalScannedRoute('/', 1);
  await acceptEditorCommands(doc, [], undefined, collectOrderCommands(doc, COMPONENT_EDITOR_PAGE_ID, [...keys].reverse(), keys,
    { viewedComponentFile: file }));
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 1, sourceRevision: 1 })).toMatchObject({ line: 1, column: 1 });
});

it('maps surviving same-line siblings after replacing nested markup', async () => {
  source('<main><p><b>Old</b></p><p>Other</p></main>\n');
  await batch({ textOverrides: { 'p-0': '<i>New</i> text' } });
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 1, column: 24 })).toMatchObject({ line: 1, column: 29 });
  await expect(resolveProjectedSourceLocation(projectId, { file, line: 1, column: 10 })).rejects.toThrow('deleted');
});

it('restores accepted permutation maps after DB and runtime reopen before a chained deletion', async () => {
  source('<div>A</div>\n<div>B</div>\n');
  await batch({ orderOverrides: ['div-1', 'div-0'] });
  runtime.restart(); db.close(); await db.open();
  expect(await deleteLocalElement({ key: `${file}:2:1`, clearSelection() {} })).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<div>A</div>\n');
});

it('rejects a storage refusal without publishing source identity or document changes', async () => {
  const original = '<div>A</div>\n<div>B</div>\n'; source(original);
  vi.spyOn(durableStore, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  await expect(batch({ orderOverrides: ['div-1', 'div-0'] })).rejects.toThrow('quota');
  expect(await db.durableEdits.count()).toBe(0);
  expect(await db.durableCommandReceipts.count()).toBe(0);
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 1 })).toMatchObject({ line: 2, column: 1 });
  expect(runtime.read(file)).toBe(original);
});

it.each(['project', 'surface'] as const)('2026-09-16: a queued write-back that straddled a %s visit ABA is accepted', async owner => {
  source('<div>A</div>\n<div>B</div>\n');
  let releaseRead!: () => void, didRead!: () => void;
  const reading = new Promise<void>(resolve => { didRead = resolve; });
  const gate = new Promise<void>(resolve => { releaseRead = resolve; });
  const read = receipts.readSourceState;
  vi.spyOn(receipts, 'readSourceState').mockImplementationOnce(async (...args) => { didRead(); await gate; return read(...args); });
  const pending = batch({ orderOverrides: ['div-1', 'div-0'] });
  void pending.catch(() => {});
  await reading;
  if (owner === 'project') { setActiveSaveProjectId('another'); setActiveSaveProjectId(projectId); }
  else { setLocalPageFile('src/pages/away.astro'); setLocalPageFile(file); }
  releaseRead();
  await expect(pending).resolves.toBeDefined();
  expect(await db.durableEdits.count()).toBe(1);
});

it('keeps the same identity maps and revision after lost acknowledgement, retry, and reopen', async () => {
  let lose = true;
  source('<div>A</div>\n<div>B</div>\n', () => { const next = lose; lose = false; return next; });
  await batch({ orderOverrides: ['div-1', 'div-0'] });
  const accepted = await db.durableEdits.toArray();
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  runtime.restart(); db.close(); await db.open();
  retryMaterialization(projectId); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<div>B</div>\n<div>A</div>\n');
  expect((await db.durableEdits.toArray())[0].commands).toEqual(accepted[0].commands);
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 1 })).toMatchObject({ line: 1, column: 1 });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
});

// Agent multiplayer (owner 2026-11-08, ledger B3): an outside rewrite that landed
// after the reorder was accepted is newer — the reorder yields and nothing blocks.
it('lets a newer outside rewrite win over a queued reorder without blocking', async () => {
  const before = '<div>A</div>\n<div>B</div>\n'; source(before);
  await batch({ orderOverrides: ['div-1', 'div-0'] });
  writeFileSync(join(runtime.root, file), '<main>External</main>\n');
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<main>External</main>\n');
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
  expect(await db.durableEdits.count()).toBe(1);
});
