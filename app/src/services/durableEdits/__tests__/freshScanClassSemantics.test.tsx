import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalPageFile, restoreLocalSourceScanState, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { moveLocalElement, deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { ClassStoreProvider, useClassStore, useElementClasses } from '@/context/ClassStoreContext';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { sourceVersion } from '../sourceIdentity';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { handleElementClick } from '@/components/Canvas/viewportMessages/selection';
import { makeFakeCtx } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import type { ScannedElement } from '@/context/SelectionContext';
import { acceptEditorCommands } from '@/store/commandGesture';
import { serializeSourceClasses } from '@/hooks/useSourceOverridesPersistence';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = 'src/pages/index.astro', key = `${file}:2:3`;
const original = '<main>\n  <p class="red">One</p>\n  <p class="blue">Two</p>\n</main>\n';
const moved = '<main>\n  <p class="blue">Two</p>\n  <p class="red edited">One</p>\n</main>\n';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, release: (() => void) | undefined;
let gate: Promise<void>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_fresh_classes_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); gate = Promise.resolve();
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: () => gate });
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  cleanup(); runtime.close(); h.doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

function setup(initial = true) {
  const { result, unmount } = renderHook(() => ({ undo: useUndoContext(), classes: useClassStore(), visibleClasses: useElementClasses(key) }), {
    wrapper: ({ children }) => <UndoProvider><ClassStoreProvider>{children}</ClassStoreProvider></UndoProvider>,
  });
  const ctx = makeFakeCtx({ env: { doc: h.doc, projectId } });
  ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
  ctx.actions.takeSnapshot = result.current.undo.takeSnapshot;
  ctx.actions.claimSnapshot = result.current.undo.claimSnapshot;
  ctx.refs.registerElement.current = (...args) => result.current.classes.registerElement(...args);
  const scan = (documentId: string, entries: [string, string][]) => {
    const bytes = runtime.read(file)!;
    const elements = entries.map(([classes, textContent], index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes, textContent,
      parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: sourceVersion(bytes) },
      rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
    handleElementsScanned(ctx, { route: '/', documentId, elements });
  };
  const click = (classes: string) => handleElementClick(ctx, { key, tagName: 'p', classes,
    sourceLocation: { file, line: 2, column: 3 }, rect: { top: 0, left: 0, width: 10, height: 10 } });
  if (initial) act(() => { scan('initial', [['red', 'One'], ['blue', 'Two']]); click('red'); });
  return { result, scan, click, ctx, unmount };
}

it.each(['GRID_PLACE_ELEMENT', 'SET_GRID_SPAN', 'compound class-grid', 'retained controls', 'registered controls'] as const)(
  '%s derives classes and undo anchors from Two after the key previously owned edited One', async owner => {
    const { result, scan, click } = setup();
    await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true); });
    await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: result.current.undo.pushStructuralUndo });
      await flushDurableSourceWritesThrough(projectId, 2); });
    expect(runtime.read(file)).toBe(moved);
    act(() => { scan('moved', [['blue', 'Two'], ['red edited', 'One']]); });
    if (owner === 'registered controls') act(() => { click('blue'); });
    if (owner.endsWith('controls')) {
      expect(result.current.classes.getClasses(key)).toBe('blue');
      expect(result.current.classes.getClassesFromYjs(key)).toBe('blue');
      expect(result.current.visibleClasses).toBe('blue');
    }
    gate = new Promise<void>(resolve => { release = resolve; });
    await act(async () => {
      if (owner.endsWith('controls')) expect(await result.current.classes.setClasses(key, `${result.current.classes.getClassesFromYjs(key)} chosen`)).toBe(true);
      else {
        result.current.undo.takeSnapshot();
        await acceptEditorCommands(h.doc, [...(owner === 'compound class-grid' ? [{ type: 'UPDATE_SOURCE_CLASSES' as const, sourceKey: key, classes: 'blue chosen' }] : []),
          { type: owner === 'compound class-grid' ? 'GRID_PLACE_ELEMENT' : owner as 'GRID_PLACE_ELEMENT' | 'SET_GRID_SPAN', key,
          gridColumn: 'col-span-2', gridRow: '' }], result.current.undo.claimSnapshot());
      }
    });
    expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 2 });
    const classes = owner.endsWith('controls') ? 'blue chosen' : owner === 'compound class-grid' ? 'blue chosen col-span-2' : 'blue col-span-2';
    const carrier = h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)!;
    expect(carrier.get('classes')).toBe(classes);
    expect(carrier.get('baseClasses')).toBe('blue');
    expect(carrier.get('edited')).toBe(true);
    expect(h.doc.getMap('acceptedSourceClassTargets').get(key)).toBe(classes);
    release!(); await act(async () => { await flushDurableSourceWritesThrough(projectId, 3); });
    const changed = `<main>\n  <p class="${classes}">Two</p>\n  <p class="red edited">One</p>\n</main>\n`;
    expect(runtime.read(file)).toBe(changed);
    const undoPaints: string[] = [];
    const post = window.postMessage.bind(window);
    const observer = vi.spyOn(window, 'postMessage').mockImplementation((...args: Parameters<typeof post>) => {
      const message = args[0];
      if (message?.type === 'SYNC_CLASSES_TO_IFRAME' && message.payload?.key === key) undoPaints.push(message.payload.classes);
      return post(...args);
    });
    await act(async () => { await result.current.undo.undo(); await flushDurableSourceWritesThrough(projectId, 4); });
    observer.mockRestore();
    expect(runtime.read(file)).toBe(moved);
    expect(undoPaints).not.toContain('red edited');
    await act(async () => { await result.current.undo.redo(); await flushDurableSourceWritesThrough(projectId, 5); });
    expect(runtime.read(file)).toBe(changed);
    if (owner === 'compound class-grid') {
      act(() => { scan('compound-rescan', [[classes, 'Two'], ['red edited', 'One']]); });
      await act(async () => { expect(await result.current.classes.setClasses(key, 'blue chosen col-span-3')).toBe(true); });
      expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('baseClasses')).toBe('blue');
    }
  },
);

it('does not repaint an accepted source class carrier onto the different element occupying its old coordinate', async () => {
  const { result, scan, ctx } = setup();
  const messages: Array<{ type: string; payload?: { key?: string; classes?: string } }> = [];
  ctx.refs.iframe.current = { contentWindow: { postMessage: (message: typeof messages[number]) => { messages.push(message); } } } as unknown as HTMLIFrameElement;
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true); });
  await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: result.current.undo.pushStructuralUndo });
    await flushDurableSourceWritesThrough(projectId, 2); });
  messages.length = 0;
  act(() => { scan('moved', [['blue', 'Two'], ['red edited', 'One']]); });
  expect(messages.filter(message => message.type === 'UPDATE_CLASSES' && message.payload?.key === key)).toEqual([]);
  expect(runtime.read(file)).toBe(moved);
});

it('does not repersist an accepted historical class carrier as an overlay for the new key occupant', async () => {
  const { result, scan } = setup();
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true); });
  await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: result.current.undo.pushStructuralUndo });
    await flushDurableSourceWritesThrough(projectId, 2); });
  act(() => { scan('moved', [['blue', 'Two'], ['red edited', 'One']]); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { expect(await result.current.classes.setClasses(key, 'blue chosen')).toBe(true); });
  expect(serializeSourceClasses(h.doc)).toEqual({});
  expect(runtime.read(file)).toBe(moved);
});

it('keeps the same element original class anchor across an authenticated rescan and accepts successive held-ACK edits', async () => {
  const { result, scan, click } = setup();
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true);
    await flushDurableSourceWritesThrough(projectId, 1); });
  act(() => { scan('same-element', [['red edited', 'One'], ['blue', 'Two']]); click('red edited'); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { expect(await result.current.classes.setClasses(key, `${result.current.classes.getClassesFromYjs(key)} chosen`)).toBe(true); });
  expect(result.current.classes.getClassesFromYjs(key)).toBe('red edited chosen');
  await act(async () => { expect(await result.current.classes.setClasses(key, `${result.current.classes.getClassesFromYjs(key)} final`)).toBe(true); });
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('baseClasses')).toBe('red');
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 1 });
  release!(); await act(async () => { await flushDurableSourceWritesThrough(projectId, 3); });
  expect(runtime.read(file)).toBe('<main>\n  <p class="red edited chosen final">One</p>\n  <p class="blue">Two</p>\n</main>\n');
});

it.each(['grid', 'controls'] as const)('%s uses newer accepted Undo classes instead of an older authenticated scan', async gesture => {
  const { result, scan } = setup();
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true);
    await flushDurableSourceWritesThrough(projectId, 1); });
  act(() => { scan('edited', [['red edited', 'One'], ['blue', 'Two']]); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { await result.current.undo.undo(); });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 1 });
  await act(async () => {
    if (gesture === 'controls') expect(await result.current.classes.setClasses(key, `${result.current.classes.getClassesFromYjs(key)} chosen`)).toBe(true);
    else {
      result.current.undo.takeSnapshot();
      await acceptEditorCommands(h.doc, [{ type: 'SET_GRID_SPAN', key, gridColumn: 'col-span-2', gridRow: '' }], result.current.undo.claimSnapshot());
    }
  });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 1 });
  release!(); await flushDurableSourceWritesThrough(projectId, 3);
  const expected = gesture === 'controls'
    ? '<main>\n  <p class="red chosen">One</p>\n  <p class="blue">Two</p>\n</main>\n'
    : '<main>\n  <p class="red col-span-2">One</p>\n  <p class="blue">Two</p>\n</main>\n';
  expect(runtime.read(file)).toBe(expected);
  await act(async () => { await result.current.undo.undo(); await flushDurableSourceWritesThrough(projectId, 4); });
  expect(runtime.read(file)).toBe(original);
  await act(async () => { await result.current.undo.redo(); await flushDurableSourceWritesThrough(projectId, 5); });
  expect(runtime.read(file)).toBe(expected);
});

it.each(['live', 'journal reopen'] as const)('%s preserves both original class anchors when edited siblings move and claim each other\'s keys', async lifecycle => {
  let { result, scan, unmount } = setup();
  const seed = Y.encodeStateAsUpdate(h.doc);
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true); });
  await act(async () => { expect(await result.current.classes.setClasses(`${file}:3:3`, 'blue edited')).toBe(true); });
  await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: result.current.undo.pushStructuralUndo });
    await flushDurableSourceWritesThrough(projectId, 3); });
  if (lifecycle === 'journal reopen') {
    unmount(); h.doc.destroy(); db.close(); await db.open(); runtime.restart();
    _resetLocalPageSyncForTests(); setLocalPageFile(file); setLocalExpectedRoute('/'); await restoreLocalSourceScanState(projectId);
    h.doc = new Y.Doc(); Y.applyUpdate(h.doc, seed);
    for (const row of await db.durableEdits.where('projectId').equals(projectId).sortBy('revision')) if (row.yjsUpdate) Y.applyUpdate(h.doc, row.yjsUpdate);
    ({ result, scan, unmount } = setup(false));
  }
  act(() => { scan('both-moved', [['blue edited', 'Two'], ['red edited', 'One']]); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { expect(await result.current.classes.setClasses(key, 'blue edited chosen')).toBe(true); });
  await act(async () => { expect(await result.current.classes.setClasses(`${file}:3:3`, 'red edited chosen')).toBe(true); });
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('baseClasses')).toBe('blue');
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(`${file}:3:3`)?.get('baseClasses')).toBe('red');
  release!(); await flushDurableSourceWritesThrough(projectId, 5);
  const expected = '<main>\n  <p class="blue edited chosen">Two</p>\n  <p class="red edited chosen">One</p>\n</main>\n';
  expect(runtime.read(file)).toBe(expected);
  await act(async () => { await result.current.undo.undo(); await flushDurableSourceWritesThrough(projectId, 6); });
  expect(runtime.read(file)).toBe('<main>\n  <p class="blue edited chosen">Two</p>\n  <p class="red edited">One</p>\n</main>\n');
  await act(async () => { await result.current.undo.redo(); await flushDurableSourceWritesThrough(projectId, 7); });
  expect(runtime.read(file)).toBe(expected);
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('baseClasses')).toBe('blue');
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(`${file}:3:3`)?.get('baseClasses')).toBe('red');
});

it('does not reuse a deleted class identity when the survivor claims its coordinate', async () => {
  const { result, scan } = setup();
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true); });
  await act(async () => { expect(await deleteLocalElement({ key, clearSelection() {}, pushUndo: result.current.undo.pushStructuralUndo })).toBe(true);
    await flushDurableSourceWritesThrough(projectId, 2); });
  act(() => { scan('survivor', [['blue', 'Two']]); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { expect(await result.current.classes.setClasses(key, `${result.current.classes.getClassesFromYjs(key)} chosen`)).toBe(true); });
  expect(h.doc.getMap<Y.Map<unknown>>('sourceClasses').get(key)?.get('baseClasses')).toBe('blue');
  release!(); await act(async () => { await flushDurableSourceWritesThrough(projectId, 3); });
  expect(runtime.read(file)).toBe('<main>\n  <p class="blue chosen">Two</p>\n</main>\n');
  await act(async () => { await result.current.undo.undo(); await flushDurableSourceWritesThrough(projectId, 4); });
  expect(runtime.read(file)).toBe('<main>\n  <p class="blue">Two</p>\n</main>\n');
  expect(result.current.classes.getClassesFromYjs(key)).toBe('blue');
  await act(async () => { await result.current.undo.redo(); await flushDurableSourceWritesThrough(projectId, 5); });
  expect(runtime.read(file)).toBe('<main>\n  <p class="blue chosen">Two</p>\n</main>\n');
});

it('keeps a newer accepted class value when an authenticated scan arrives after invocation', async () => {
  const { result, scan } = setup();
  await act(async () => { expect(await result.current.classes.setClasses(key, 'red edited')).toBe(true);
    await flushDurableSourceWritesThrough(projectId, 1); });
  gate = new Promise<void>(resolve => { release = resolve; });
  await act(async () => {
    const pending = result.current.classes.setClasses(key, 'red edited chosen');
    scan('arrives-during-acceptance', [['red edited', 'One'], ['blue', 'Two']]);
    expect(await pending).toBe(true);
  });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 1 });
  expect(result.current.classes.getClasses(key)).toBe('red edited chosen');
  expect(result.current.classes.getClassesFromYjs(key)).toBe('red edited chosen');
  expect(result.current.visibleClasses).toBe('red edited chosen');
  await act(async () => { expect(await result.current.classes.setClasses(key, `${result.current.classes.getClassesFromYjs(key)} final`)).toBe(true); });
  release!(); await act(async () => { await flushDurableSourceWritesThrough(projectId, 3); });
  expect(runtime.read(file)).toBe('<main>\n  <p class="red edited chosen final">One</p>\n  <p class="blue">Two</p>\n</main>\n');
});
