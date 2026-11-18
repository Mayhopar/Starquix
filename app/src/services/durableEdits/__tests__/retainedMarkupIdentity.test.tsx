import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { moveLocalElement, deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { generateCommandTools } from '@/ai/tools/commandTools';
import { makeCtx, type ExecTool } from '@/ai/tools/__tests__/testCtx';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { sourceVersion } from '../sourceIdentity';
import { handleEditModeExited, handleMarkupChanged } from '@/components/Canvas/viewportMessages/textEditing';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { makeFakeCtx } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import type { ScannedElement } from '@/context/SelectionContext';
import { acceptEditorCommands } from '@/store/commandGesture';
import { mountBridgeForTest } from '@/bridge/parts/__tests__/harness';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = 'src/pages/index.astro', key = `${file}:2:3`;
const original = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
const moved = '<main>\n  <p>Two</p>\n  <p><a href="/one">One</a></p>\n</main>\n';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, gate: Promise<void>, release: (() => void) | undefined;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_markup_identity_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); gate = Promise.resolve();
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: () => gate });
});

it.each(['live', 'neighbor undo/redo', 'journal reopen', 'both linked siblings'] as const)('%s preserves moved One\'s markup after Two claims its old coordinate', async lifecycle => {
  let hook = renderHook(() => useUndoContext(), { wrapper: UndoProvider });
  let ctx = makeFakeCtx({ env: { doc: h.doc, projectId } });
  const bind = () => {
    ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
    ctx.actions.takeSnapshot = hook.result.current.takeSnapshot;
    ctx.actions.claimSnapshot = hook.result.current.claimSnapshot;
  };
  bind();
  const scan = (documentId: string, texts: string[]) => {
    const version = sourceVersion(runtime.read(file));
    const elements = texts.map((textContent, index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes: '', textContent,
      parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: version },
      rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
    handleElementsScanned(ctx, { route: '/', documentId, elements });
  };
  scan('initial', ['One', 'Two']);
  const seed = Y.encodeStateAsUpdate(h.doc);
  await act(async () => { await handleMarkupChanged(ctx, { key, innerHTML: '<a href="/one">One</a>' }); });
  if (lifecycle === 'both linked siblings') await act(async () => {
    await handleMarkupChanged(ctx, { key: `${file}:3:3`, innerHTML: '<a href="/two">Two</a>' });
  });
  await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: hook.result.current.pushStructuralUndo }); });
  const movedRevision = (await getDurableProjectState(projectId)).acceptedRevision;
  await flushDurableSourceWritesThrough(projectId, movedRevision);
  await act(async () => { scan('fresh', ['Two', 'One']); });
  const edit = async (sourceKey: string, textContent: string) => {
    await act(async () => {
      hook.result.current.takeSnapshot();
      const tool = generateCommandTools(makeCtx({ doc: h.doc, getCurrentPageFile: () => file,
        getScannedElements: () => ctx.refs.scannedElements.current, claimSnapshot: hook.result.current.claimSnapshot })).update_element_by_key as ExecTool;
      expect((await tool.execute({ sourceKey, textContent })).success).toBe(true);
    });
  };
  await edit(key, lifecycle === 'both linked siblings' ? 'Two!' : 'Updated Two');
  await flushDurableSourceWritesThrough(projectId, movedRevision + 1);
  const beforeOwnerEdit = lifecycle === 'both linked siblings'
    ? '<main>\n  <p><a href="/two">Two!</a></p>\n  <p><a href="/one">One</a></p>\n</main>\n'
    : '<main>\n  <p>Updated Two</p>\n  <p><a href="/one">One</a></p>\n</main>\n';
  expect(runtime.read(file)).toBe(beforeOwnerEdit);
  if (lifecycle === 'neighbor undo/redo') {
    await act(async () => { await hook.result.current.undo(); });
    await act(async () => { await hook.result.current.redo(); await flushDurableSourceWritesThrough(projectId, 5); });
  }
  if (lifecycle === 'journal reopen') {
    hook.unmount(); h.doc.destroy(); db.close(); await db.open(); runtime.restart();
    _resetLocalPageSyncForTests(); setLocalPageFile(file); setLocalExpectedRoute('/');
    h.doc = new Y.Doc(); Y.applyUpdate(h.doc, seed);
    for (const row of await db.durableEdits.where('projectId').equals(projectId).sortBy('revision')) if (row.yjsUpdate) Y.applyUpdate(h.doc, row.yjsUpdate);
    hook = renderHook(() => useUndoContext(), { wrapper: UndoProvider });
    ctx = makeFakeCtx({ env: { doc: h.doc, projectId } }); bind();
    scan('reopen', ['Updated Two', 'One']);
  }
  gate = new Promise<void>(resolve => { release = resolve; });
  const before = (await getDurableProjectState(projectId)).acceptedRevision;
  await edit(`${file}:3:3`, 'One!');
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: before + 1, materializedRevision: before });
  release!(); await flushDurableSourceWritesThrough(projectId, before + 1);
  const expected = lifecycle === 'both linked siblings'
    ? '<main>\n  <p><a href="/two">Two!</a></p>\n  <p><a href="/one">One!</a></p>\n</main>\n'
    : '<main>\n  <p>Updated Two</p>\n  <p><a href="/one">One!</a></p>\n</main>\n';
  expect(runtime.read(file)).toBe(expected);
  await act(async () => { await hook.result.current.undo(); await flushDurableSourceWritesThrough(projectId, before + 2); });
  expect(runtime.read(file)).toBe(beforeOwnerEdit);
  await act(async () => { await hook.result.current.redo(); await flushDurableSourceWritesThrough(projectId, before + 3); });
  expect(runtime.read(file)).toBe(expected);
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  cleanup(); runtime.close(); h.doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
});

it.each(['AI neighbor', 'viewport neighbor', 'AI neighbor text anchor', 'moved owner', 'historical owner'] as const)('%s cannot inherit another element\'s retained inline link after authenticated coordinate reuse', async target => {
  const { result } = renderHook(() => useUndoContext(), { wrapper: UndoProvider });
  const ctx = makeFakeCtx({ env: { doc: h.doc, projectId } });
  ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
  ctx.actions.takeSnapshot = result.current.takeSnapshot; ctx.actions.claimSnapshot = result.current.claimSnapshot;
  const scan = (documentId: string, texts: string[]) => {
    const version = sourceVersion(runtime.read(file));
    const elements = texts.map((textContent, index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes: '', textContent,
      parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: version },
      rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
    handleElementsScanned(ctx, { route: '/', documentId, elements });
  };
  scan('initial', ['One', 'Two']);
  const owner = { ...ctx.refs.scannedElements.current[0].sourceLocation! };
  await act(async () => { await handleMarkupChanged(ctx, { key, innerHTML: '<a href="/one">One</a>' }); });
  const anchored = target === 'AI neighbor text anchor';
  if (anchored) await act(async () => {
    result.current.takeSnapshot();
    await handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'One!' });
  });
  const beforeEditRevision = anchored ? 3 : 2;
  const movedSource = anchored ? '<main>\n  <p>Two</p>\n  <p><a href="/one">One!</a></p>\n</main>\n' : moved;
  const retained = structuredClone(h.doc.getMap<Y.Map<unknown>>('sourceLinkAttributes').get(key)!.toJSON());
  const firstCommand = structuredClone((await db.durableEdits.where('projectId').equals(projectId).sortBy('revision'))[0].commands);
  await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: result.current.pushStructuralUndo }); });
  await flushDurableSourceWritesThrough(projectId, beforeEditRevision); expect(runtime.read(file)).toBe(movedSource);
  await act(async () => { scan('fresh', ['Two', anchored ? 'One!' : 'One']); });
  const nextKey = target === 'moved owner' ? `${file}:3:3` : key;
  const text = target.includes('neighbor') ? 'Updated Two' : 'One!';
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => {
    result.current.takeSnapshot();
    if (target === 'viewport neighbor') await handleEditModeExited(ctx, { key: nextKey, originalText: 'Two', textContent: text });
    else if (target === 'historical owner') await acceptEditorCommands(h.doc, [{ type: 'UPDATE_SOURCE_TEXT', sourceKey: key,
      textContent: text, sourceLocation: owner }], result.current.claimSnapshot());
    else {
      const tool = generateCommandTools(makeCtx({ doc: h.doc, getCurrentPageFile: () => file,
        getScannedElements: () => ctx.refs.scannedElements.current, claimSnapshot: result.current.claimSnapshot })).update_element_by_key as ExecTool;
      expect((await tool.execute({ sourceKey: nextKey, textContent: text })).success).toBe(true);
    }
  });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: beforeEditRevision + 1, materializedRevision: beforeEditRevision });
  release!(); await flushDurableSourceWritesThrough(projectId, beforeEditRevision + 1);
  const expected = anchored ? '<main>\n  <p>Updated Two</p>\n  <p><a href="/one">One!</a></p>\n</main>\n'
    : target.includes('neighbor') ? '<main>\n  <p>Updated Two</p>\n  <p><a href="/one">One</a></p>\n</main>\n'
    : '<main>\n  <p>Two</p>\n  <p><a href="/one">One!</a></p>\n</main>\n';
  expect(runtime.read(file)).toBe(expected);
  if (anchored) expect(h.doc.getMap<Y.Map<unknown>>('sourceText').get(key)?.get('baseText')).toBe('Two');
  await act(async () => { await result.current.undo(); });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: beforeEditRevision + 2 });
  await flushDurableSourceWritesThrough(projectId, beforeEditRevision + 2);
  expect(runtime.read(file)).toBe(movedSource);
  expect(h.doc.getMap<Y.Map<unknown>>('sourceLinkAttributes').get(key)?.toJSON()).toEqual(retained);
  await act(async () => { await result.current.redo(); await flushDurableSourceWritesThrough(projectId, beforeEditRevision + 3); });
  expect(runtime.read(file)).toBe(expected);
  expect((await db.durableEdits.where('projectId').equals(projectId).sortBy('revision'))[0].commands).toEqual(firstCommand);
});

it('retires a deleted markup identity without lending its link to the surviving coordinate occupant after reopen', async () => {
  const ctx = makeFakeCtx({ env: { doc: h.doc, projectId } });
  ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
  const scan = (documentId: string, texts: string[]) => {
    const version = sourceVersion(runtime.read(file));
    const elements = texts.map((textContent, index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes: '', textContent,
      parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: version },
      rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
    handleElementsScanned(ctx, { route: '/', documentId, elements });
  };
  scan('initial', ['One', 'Two']);
  await handleMarkupChanged(ctx, { key, innerHTML: '<a href="/one">One</a>' });
  expect(await deleteLocalElement({ key, clearSelection() {} })).toBe(true);
  await flushDurableSourceWritesThrough(projectId, 2);
  db.close(); await db.open(); runtime.restart();
  scan('remaining', ['Two']);
  await handleEditModeExited(ctx, { key, originalText: 'Two', textContent: 'Two!' });
  await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime.read(file)).toBe('<main>\n  <p>Two!</p>\n</main>\n');
  const markup = [...h.doc.getMap<Y.Map<unknown>>('sourceLinkAttributes').values()].map(entry => entry.get('sqMarkup')).filter(Boolean);
  expect(markup).toEqual([]);
});

it('does not flatten retained markup when an old-preview text continuation follows carrier relocation under held ACK', async () => {
  const ctx = makeFakeCtx({ env: { doc: h.doc, projectId } });
  const bridge = mountBridgeForTest();
  const paragraph = document.createElement('p'); paragraph.setAttribute('data-key', key);
  paragraph.innerHTML = '<a href="/one">One</a>'; document.body.append(paragraph);
  const messages: Array<{ type: string }> = [];
  ctx.refs.iframe.current = { contentWindow: { postMessage: (message: { type: string; payload: { key: string; textContent: string } }) => {
    messages.push(message); if (message.type === 'UPDATE_TEXT') bridge.handleUpdateText(message.payload);
  } } } as unknown as HTMLIFrameElement;
  ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
  const version = sourceVersion(original);
  const elements = ['One', 'Two'].map((textContent, index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes: '', textContent,
    parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: version },
    rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
  handleElementsScanned(ctx, { route: '/', documentId: 'initial', elements });
  await handleMarkupChanged(ctx, { key, innerHTML: '<a href="/one">One</a>' });
  await flushDurableSourceWritesThrough(projectId, 1);
  gate = new Promise<void>(resolve => { release = resolve; });
  await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after' });
  messages.length = 0;
  paragraph.querySelector('a')!.textContent = 'One!';
  const first = handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'One!' });
  paragraph.querySelector('a')!.textContent = 'One!?';
  const second = handleEditModeExited(ctx, { key, originalText: 'One!', textContent: 'One!?' });
  await Promise.all([first, second]);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 4, materializedRevision: 1 });
  expect(paragraph.innerHTML).toBe('<a href="/one">One!?</a>');
  expect(messages.filter(message => message.type === 'UPDATE_TEXT')).toEqual([]);
  release!(); await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime.read(file)).toBe('<main>\n  <p>Two</p>\n  <p><a href="/one">One!?</a></p>\n</main>\n');
  paragraph.remove();
});

it('rejects a failed carrier identity read without treating it as a tombstone', async () => {
  const location = { file, line: 2, column: 3, sourceVersion: sourceVersion(original), sourceRevision: 0 };
  await acceptEditorCommands(h.doc, [{ type: 'UPDATE_SOURCE_MARKUP', sourceKey: key, markup: '<a href="/one">One</a>', sourceLocation: location }]);
  await flushDurableSourceWritesThrough(projectId, 1);
  const before = h.doc.getMap('sourceLinkAttributes').toJSON();
  const failure = vi.spyOn(db.durableEdits, 'where').mockImplementationOnce(() => { throw new Error('identity storage read failed'); });
  try {
    await expect(acceptEditorCommands(h.doc, [{ type: 'UPDATE_SOURCE_TEXT', sourceKey: key, textContent: 'One!', sourceLocation: location }])).rejects.toThrow('identity storage read failed');
  } finally { failure.mockRestore(); }
  expect((await getDurableProjectState(projectId)).acceptedRevision).toBe(1);
  expect(h.doc.getMap('sourceLinkAttributes').toJSON()).toEqual(before);
  expect(runtime.read(file)).toBe('<main>\n  <p><a href="/one">One</a></p>\n  <p>Two</p>\n</main>\n');
});
