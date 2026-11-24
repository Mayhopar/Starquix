import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { moveLocalElement, deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { generateCommandTools } from '@/ai/tools/commandTools';
import { makeCtx, type ExecTool } from '@/ai/tools/__tests__/testCtx';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { acceptEditorCommands } from '@/store/commandGesture';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { resolveProjectedSourceLocation, sourceVersion } from '../sourceIdentity';
import { handleEditModeExited, handleMarkupChanged } from '@/components/Canvas/viewportMessages/textEditing';
import { makeFakeCtx } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import { viteTextWriter } from '@/services/ViteTextWriter';
import { sourceMediaMutation } from '@/services/sourceMediaMutation';
import { acceptStructuralReplay } from '../structuralReplayAcceptance';
import { mergeStructuralRecords, type StructuralUndoRecord } from '@/store/structuralUndo';
import { forEachReapplicableTextEntry } from '@/store/sourceTextEntries';
import { forEachSourceLinkAttrsEntry } from '@/store/sourceOverrideEntries';
import { readCurrentImageFillSource } from '@/services/imageFillSourceRead';
import { registeredSourceLocation } from '@/utils/sourceLocationKey';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = 'src/pages/index.astro';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined, release: (() => void) | undefined;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_source_text_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  cleanup(); runtime?.close(); h.doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
});
function source(text: string) {
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: text }, { beforeCommand: () => gate });
}
function ai(scanned: Array<{ key: string; sourceLocation: { file: string; line: number; column: number; sourceVersion?: string }; classes: string; textContent: string }>, undo?: ReturnType<typeof useUndoContext>) {
  const ctx = makeCtx({ doc: h.doc, getCurrentPageFile: () => file,
    ...(undo ? { takeSnapshot: undo.takeSnapshot, claimSnapshot: undo.claimSnapshot } : {}),
    getScannedElements: () => scanned as ReturnType<ReturnType<typeof makeCtx>['getScannedElements']> });
  return generateCommandTools(ctx).update_element_by_key as ExecTool;
}

it('AI text changes the original source identity after reorder with all source ACKs held', async () => {
  source('<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n');
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  const tool = ai([{ key: `${file}:3:3`, sourceLocation: { file, line: 3, column: 3 }, classes: '', textContent: 'Two' }]);
  expect((await tool.execute({ sourceKey: `${file}:3:3`, textContent: 'Updated Two' })).success).toBe(true);
  expect(h.doc.getMap<Y.Map<unknown>>('sourceText').get(`${file}:3:3`)?.get('textContent')).toBe('Updated Two');
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  release!(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime!.read(file)).toBe('<main>\n  <p>Updated Two</p>\n  <p>One</p>\n</main>\n');
});

it('compound same-line AI class/text accepts once and restores exact source on undo and redo before ACK', async () => {
  const original = '<main><p>A</p><p>B</p></main>\n'; source(original);
  const { result } = renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
  const tool = ai([{ key: `${file}:1:15`, sourceLocation: { file, line: 1, column: 15, sourceVersion: sourceVersion(original) }, classes: '', textContent: 'B' }], result.current);
  await act(async () => { expect((await tool.execute({ sourceKey: `${file}:1:15`, classes: 'p-4', textContent: 'New B' })).success).toBe(true); });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
  await act(async () => { await result.current.undo(); });
  await act(async () => { await result.current.redo(); });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
  release!(); await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime!.read(file)).toBe('<main><p>A</p><p class="p-4">New B</p></main>\n');
  await act(async () => { await result.current.undo(); });
  await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime!.read(file)).toBe(original);
});

it('markup acceptance maps same-line descendants and a following original-key deletion across DB/runtime reopen', async () => {
  const original = '<main><p><b>Old</b></p><p>Tail</p></main>\n'; source(original);
  await acceptEditorCommands(h.doc, [
    { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: `${file}:1:7`, classes: '', sourceLocation: { file, line: 1, column: 7, sourceVersion: sourceVersion(original) } },
    { type: 'UPDATE_SOURCE_MARKUP', sourceKey: `${file}:1:7`, markup: '<b>New</b>\nMore' },
  ]);
  db.close(); await db.open(); runtime!.restart();
  expect(await deleteLocalElement({ key: `${file}:1:24`, clearSelection() {} })).toBe(true);
  release!(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime!.read(file)).toBe('<main><p><b>New</b>\nMore</p></main>\n');
});

it.each(['text', 'markup'] as const)('viewport %s acceptance persists the original target without a live iframe writer', async kind => {
  const original = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n'; source(original);
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  const ctx = makeFakeCtx(); ctx.env.doc = h.doc; ctx.env.projectId = projectId;
  ctx.refs.scannedElements.current = [{ key: `${file}:3:3`, classes: '', textContent: 'Two', sourceLocation: {
    file, line: 3, column: 3, sourceVersion: sourceVersion(original), sourceRevision: 0,
  } }] as typeof ctx.refs.scannedElements.current;
  if (kind === 'text') await handleEditModeExited(ctx, { key: `${file}:3:3`, originalText: 'Two', textContent: 'New Two' });
  else await handleMarkupChanged(ctx, { key: `${file}:3:3`, innerHTML: 'New<br>Two' });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  release!(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime!.read(file)).toBe(kind === 'text' ? '<main>\n  <p>New Two</p>\n  <p>One</p>\n</main>\n'
    : '<main>\n  <p>New<br>Two</p>\n  <p>One</p>\n</main>\n');
});

it('direct source text writer accepts an owned old key while ACK and iframe are unavailable', async () => {
  source('<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n');
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  expect(await viteTextWriter.writeTextUpdate({ file, line: 3, column: 3 }, 'Direct Two')).toBe(true);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  release!(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime!.read(file)).toBe('<main>\n  <p>Direct Two</p>\n  <p>One</p>\n</main>\n');
});

it('media conversion accepts original-key identity and exact undo evidence before source ACK', async () => {
  const original = '<main>\n  <div></div>\n  <div></div>\n</main>\n'; source(original);
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  let undo: StructuralUndoRecord | undefined;
  const receipt = await sourceMediaMutation({ location: { file, line: 3, column: 3, sourceVersion: sourceVersion(original) }, kind: 'image', src: '/two.png' }, value => { undo = value; });
  expect(receipt).toMatchObject({ changed: true });
  expect(undo?.structuralOp.sourceFiles?.[0].afterSource).toContain('<img');
  // Projection reads do not create receipts. The worker may already reconcile
  // the identical-byte reorder, but the media write still awaits source ACK.
  const state = await getDurableProjectState(projectId);
  expect(state.acceptedRevision).toBe(2); expect(state.materializedRevision).toBeLessThan(2);
  await acceptStructuralReplay(h.doc, undo!.structuralOp.inverse, undo!.structuralOp.sourceFiles, 'before');
  await acceptStructuralReplay(h.doc, undo!.structuralOp.forward, undo!.structuralOp.sourceFiles, 'after');
  release!(); await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime!.read(file)).toBe('<main>\n  <img src="/two.png" alt="">\n  <div></div>\n</main>\n');
});

it('merged media and legacy structural undo keeps exact maps and executes every step in one accepted revision', async () => {
  const original = '<main>\n  <div></div>\n  <p>Tail</p>\n</main>\n'; source(original);
  let media!: StructuralUndoRecord;
  await sourceMediaMutation({ location: { file, line: 2, column: 3 }, kind: 'image', src: '/image.png' }, value => { media = value; });
  const legacy: StructuralUndoRecord = { structuralOp: {
    forward: [{ kind: 'remove', loc: { file, line: 3, column: 3 } }],
    inverse: [{ kind: 'restore', loc: { file, line: 3, column: 1 }, text: '  <p>Tail</p>\n' }],
  } };
  await acceptStructuralReplay(h.doc, legacy.structuralOp.forward, undefined, 'after');
  const combined = mergeStructuralRecords([media, legacy]);
  const { result } = renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
  await act(async () => { result.current.pushStructuralUndo(combined); });
  await act(async () => { await result.current.undo(); });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
  release!(); await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime!.read(file)).toBe(original);
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 3 })).toMatchObject({ file, line: 2, column: 3 });
  await act(async () => { await result.current.redo(); });
  await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime!.read(file)).toBe('<main>\n  <img src="/image.png" alt="">\n</main>\n');
});

it('all mapped media records combine their inverse correspondences and restore original identities', async () => {
  const original = '<main>\n  <div></div>\n  <p>Tail</p>\n</main>\n'; source(original);
  const records: StructuralUndoRecord[] = [];
  const location = { file, line: 2, column: 3, sourceVersion: sourceVersion(original) };
  await sourceMediaMutation({ location, kind: 'image', src: '/one.png' }, value => records.push(value));
  await sourceMediaMutation({ location, kind: 'video', src: '/two.mp4' }, value => records.push(value));
  const combined = mergeStructuralRecords(records);
  await acceptStructuralReplay(h.doc, combined.structuralOp.inverse, combined.structuralOp.sourceFiles, 'before', combined.structuralOp.sourceSteps);
  expect(await resolveProjectedSourceLocation(projectId, location)).toMatchObject({ file, line: 2, column: 3 });
  release!(); await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime!.read(file)).toBe(original);
  await acceptStructuralReplay(h.doc, combined.structuralOp.forward, combined.structuralOp.sourceFiles, 'after', combined.structuralOp.sourceSteps);
  await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime!.read(file)).toContain('<video src="/two.mp4"');
  expect(runtime!.read(file)).toContain('<p>Tail</p>');
});

it('rejects compound AI class/text over a dynamic expression without accepting partial class or document changes', async () => {
  const original = '<main><p>{entry.title}</p></main>\n'; source(original);
  const tool = ai([{ key: `${file}:1:7`, sourceLocation: { file, line: 1, column: 7, sourceVersion: sourceVersion(original) }, classes: '', textContent: 'Rendered' }]);
  expect((await tool.execute({ sourceKey: `${file}:1:7`, classes: 'p-4', textContent: 'Changed' })).success).toBe(false);
  expect(await db.durableEdits.count()).toBe(0);
  expect(h.doc.getMap('sourceClasses').size).toBe(0);
  expect(h.doc.getMap('sourceText').size).toBe(0);
  expect(runtime!.read(file)).toBe(original);
});

it.each(['text', 'media'] as const)('rejects the first %s mutation from an unowned source fingerprint', async kind => {
  const original = '<main>\n  <div></div>\n  <p>Tail</p>\n</main>\n';
  const external = '<main>\n  <p>External</p>\n  <div></div>\n  <p>Tail</p>\n</main>\n'; source(external);
  const location = { file, line: 2, column: 3, sourceVersion: sourceVersion(original) };
  const mutation = kind === 'text' ? viteTextWriter.writeTextUpdate(location, 'Changed')
    : sourceMediaMutation({ location, kind: 'image', src: '/changed.png' }, () => { throw new Error('Rejected media published undo'); });
  await expect(mutation).rejects.toThrow(/source.*version/i);
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime!.read(file)).toBe(external);
});

it('accepted source text and markup carriers remain inert to scan/export through undo, redo and journal reopen', async () => {
  const original = '<main><p>Old</p></main>\n'; source(original);
  const { result } = renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
  await act(async () => {
    result.current.takeSnapshot();
    await acceptEditorCommands(h.doc, [
      { type: 'UPDATE_SOURCE_MARKUP', sourceKey: `${file}:1:7`, markup: 'New<br>' },
      { type: 'UPDATE_SOURCE_TEXT', sourceKey: `${file}:1:7`, textContent: 'New' },
    ], result.current.claimSnapshot());
  });
  const reapplications = () => {
    const entries: unknown[] = [];
    forEachReapplicableTextEntry(h.doc, (...entry) => entries.push(entry));
    forEachSourceLinkAttrsEntry(h.doc, entry => entries.push(entry));
    return entries;
  };
  expect(reapplications()).toEqual([]);
  await act(async () => { await result.current.undo(); });
  await act(async () => { await result.current.redo(); });
  expect(reapplications()).toEqual([]);
  db.close(); await db.open();
  const reopened = new Y.Doc();
  for (const row of await db.durableEdits.where('projectId').equals(projectId).sortBy('revision')) if (row.yjsUpdate) Y.applyUpdate(reopened, row.yjsUpdate);
  const entries: unknown[] = [];
  forEachReapplicableTextEntry(reopened, (...entry) => entries.push(entry));
  forEachSourceLinkAttrsEntry(reopened, entry => entries.push(entry));
  expect(entries).toEqual([]); reopened.destroy();
});

it('image-fill preflight reads the projected original identity without waiting for pending class/source ACKs', async () => {
  const original = '<main>\n  <img src="/one.png" alt="One" class="w-64 h-40 object-cover">\n  <img src="/two.png" alt="Two" class="w-64 h-40 object-cover">\n</main>\n'; source(original);
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  const read = readCurrentImageFillSource({ location: { file, line: 3, column: 3, sourceVersion: sourceVersion(original) },
    projectPath: `wc://${projectId}`, native: true, classes: 'w-64 h-40 object-cover', isCurrent: () => true,
    geometry: { display: 'block', boxSizing: 'border-box', maxWidth: 'none', objectFit: 'cover', objectPosition: '50% 50%', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px' },
  });
  const result = await Promise.race([read, new Promise(resolve => setTimeout(() => resolve('waited for ACK'), 300))]);
  expect(result).toMatchObject({ expectedTag: '<img src="/two.png" alt="Two" class="w-64 h-40 object-cover">', location: { file, line: 2, column: 3 } });
});

it('source-text-only snapshots retain their own scan version and revision across undo and redo', async () => {
  const original = '<main><p>Old</p></main>\n'; source(original);
  const key = `${file}:1:7`;
  const location = { file, line: 1, column: 7, sourceVersion: sourceVersion(original), sourceRevision: 0 };
  const { result } = renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
  await act(async () => {
    result.current.takeSnapshot(['sourceText']);
    await acceptEditorCommands(h.doc, [
      { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key, classes: '', sourceLocation: location },
      { type: 'UPDATE_SOURCE_TEXT', sourceKey: key, textContent: 'New' },
    ], result.current.claimSnapshot());
  });
  expect(result.current.createSnapshot(['sourceText'])).toMatchObject({ sourceTextLocations: { [key]: location } });
  await act(async () => { await result.current.undo(); });
  await act(async () => { await result.current.redo(); });
  expect(h.doc.getMap<Y.Map<unknown>>('sourceText').get(key)?.get('sourceLocation')).toBeInstanceOf(Y.Map);
  // Explicit master push must not depend on a separate class snapshot surviving.
  h.doc.getMap('sourceClasses').delete(key);
  expect(registeredSourceLocation(h.doc, key, 'sourceText')).toEqual(location);
});

it('concurrent local media gestures queue for acceptance without a saving gate or source ACK', async () => {
  const original = '<main><div></div></main>\n'; source(original);
  const location = { file, line: 1, column: 7, sourceVersion: sourceVersion(original) };
  const records: StructuralUndoRecord[] = [];
  await Promise.all([
    sourceMediaMutation({ location, kind: 'image', src: '/one.png' }, record => records.push(record)),
    sourceMediaMutation({ location, kind: 'video', src: '/two.mp4' }, record => records.push(record)),
  ]);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  expect(records).toHaveLength(2);
  expect(records[1].structuralOp.sourceFiles?.[0].afterSource).toContain('<video src="/two.mp4"');
});
