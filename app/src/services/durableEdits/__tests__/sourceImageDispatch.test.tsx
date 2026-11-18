import 'fake-indexeddb/auto';
import React from 'react';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { useDurableDispatch } from '@/store/hooks';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import { useSourceImageSync } from '@/hooks/useSourceImageSync';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { setLocalPageFile, setLocalExpectedRoute, setLocalScannedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { awaitAccepted } from '../acceptance';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import * as store from '../store';

const file = 'src/pages/index.astro', key = `${file}:1:7`;
const initial = '<main><img src="original.png" alt="Original" /></main>\n';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, release: () => void;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_image_dispatch_${crypto.randomUUID()}`;
  markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: initial }, { beforeCommand: () => gate });
});
afterEach(async () => {
  cleanup(); release();
  await flushDurableSourceWritesThrough(projectId, (await store.getDurableProjectState(projectId)).acceptedRevision);
  runtime.close(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null); _resetLocalPageSyncForTests();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount() {
  const hook = await renderReadyEditorHook(() => {
    const doc = useEditorDoc(), undo = useUndoContext();
    useSourceImageSync(doc, () => undo.isUndoingRef.current, projectId);
    return { doc, undo, dispatch: useDurableDispatch() };
  }, { wrapper: ({ children }) => <EditorProvider><UndoProvider>{children}</UndoProvider></EditorProvider> });
  act(() => { hook.result.current.doc.getMap('meta').set('projectId', projectId); });
  return hook;
}
const rows = () => db.durableEdits.where('projectId').equals(projectId).sortBy('revision');

it('the FIRST image UI acceptance owns document and source together without an observer follow-up', async () => {
  const { result } = await mount();
  await act(async () => {
    result.current.undo.takeSnapshot();
    await result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Accepted' });
    await awaitAccepted(projectId);
  });
  const accepted = await rows();
  expect(accepted[0].commands).toEqual([expect.objectContaining({ kind: 'file-batch', payload: { files: [expect.objectContaining({
    file, beforeSource: initial, afterSource: initial.replace('Original', 'Accepted'),
  })] } })]);
  expect(accepted).toHaveLength(1);
  expect(result.current.doc.getMap<Y.Map<string>>('sourceImageAttributes').get(key)?.get('alt')).toBe('Accepted');
  expect(runtime.read(file)).toBe(initial);
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toContain('alt="Accepted"');
  await act(async () => { await result.current.undo.undo(); await awaitAccepted(projectId); });
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(initial);
  await act(async () => { await result.current.undo.redo(); await awaitAccepted(projectId); });
  await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime.read(file)).toContain('alt="Accepted"');
  expect(await rows()).toHaveLength(3);
});

it('quota refusal publishes neither image document state nor source intent', async () => {
  const { result } = await mount();
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  await act(async () => {
    await expect(result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Refused' })).rejects.toThrow('quota');
  });
  expect(await rows()).toHaveLength(0);
  expect(result.current.doc.getMap('sourceImageAttributes').has(key)).toBe(false);
  expect(runtime.read(file)).toBe(initial);
});

it.each([['src', 'next.png'], ['src', ''], ['alt', ''], ['loading', 'eager'], ['autoplay', 'true']] as const)(
  'accepts %s=%s with source in its first revision', async (attribute, value) => {
    const { result } = await mount();
    await act(async () => {
      await result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute, value });
      await awaitAccepted(projectId);
    });
    const accepted = await rows();
    expect(accepted).toHaveLength(1);
    expect(accepted[0].commands[0].kind).toBe('file-batch');
    release(); await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read(file)).toContain(`${attribute}="${value}"`);
  },
);

it('keeps a later legacy source-image writer alive after an atomically owned value', async () => {
  const { applyCommand } = await import('@/store/commands');
  const { result } = await mount();
  await act(async () => {
    await result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Owned' });
    result.current.doc.transact(() => { applyCommand(result.current.doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Legacy',
    }); });
    await awaitAccepted(projectId);
  });
  expect(await rows()).toHaveLength(2);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toContain('alt="Legacy"');
});

it('does not write an invalid loading value rejected by the reducer', async () => {
  const { result } = await mount();
  await act(async () => {
    await expect(result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'loading', value: 'invalid' })).rejects.toThrow(/loading/);
  });
  expect(await rows()).toHaveLength(0);
  expect(runtime.read(file)).toBe(initial);
});

it('Undo to a preexisting legacy image value uses only its exact file inverse', async () => {
  const { applyCommand } = await import('@/store/commands');
  const { result } = await mount();
  await act(async () => {
    result.current.doc.transact(() => { applyCommand(result.current.doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Original',
    }); });
    await awaitAccepted(projectId);
  });
  await act(async () => {
    result.current.undo.takeSnapshot();
    await result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Accepted' });
    await awaitAccepted(projectId);
  });
  expect(await rows()).toHaveLength(2);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  await act(async () => { await result.current.undo.undo(); await awaitAccepted(projectId); });
  const accepted = await rows();
  expect(accepted).toHaveLength(3);
  await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime.read(file)).toBe(initial);
});

it('keeps instance image edits and page-scoped master overrides on their existing document owners', async () => {
  const { dispatchDurableAction } = await import('@/store/durableDispatch');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  doc.getMap('elements').set('el-image', new Y.Map());
  await dispatchDurableAction(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'el-image', attribute: 'alt', value: 'Instance' });
  await dispatchDurableAction(doc, { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:1:1', attribute: 'alt', value: 'Placement' });
  const accepted = await rows();
  expect(accepted).toHaveLength(2);
  expect(accepted.every(row => row.commands.length === 0)).toBe(true);
  expect(doc.getMap<Y.Map<unknown>>('elements').get('el-image')?.get('imageAttributes')).toBeInstanceOf(Y.Map);
  expect(doc.getMap<Y.Map<string>>('sourceImageAttributes').get('src/components/Hero.astro:1:1')?.get('alt')).toBe('Placement');
  expect(runtime.read(file)).toBe(initial);
  doc.destroy();
});

it('preserves explicit operation dedupe when the source-image dispatch is retried', async () => {
  const { dispatchDurableAction } = await import('@/store/durableDispatch');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const action = { type: 'UPDATE_IMAGE_ATTRIBUTE' as const, elementId: key, attribute: 'alt' as const, value: 'Once' };
  const first = await dispatchDurableAction(doc, action, [], 'stable-image-operation');
  const retry = await dispatchDurableAction(doc, { ...action, value: 'Must not replace' }, [], 'stable-image-operation');
  expect(retry).toMatchObject({ operationId: first.operationId, revision: first.revision });
  expect(await rows()).toHaveLength(1);
  expect(doc.getMap<Y.Map<string>>('sourceImageAttributes').get(key)?.get('alt')).toBe('Once');
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toContain('alt="Once"');
  doc.destroy();
});


it('accepted image carriers never overwrite newer source on a document remount', async () => {
  const { serializeSourceImageAttrs } = await import('@/hooks/useSourceOverridesPersistence');
  const { result } = await mount();
  await act(async () => {
    await result.current.dispatch({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Accepted earlier' });
    await awaitAccepted(projectId);
  });
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(serializeSourceImageAttrs(result.current.doc)).toEqual({});
  const reloaded = new Y.Doc(); Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(result.current.doc));
  const post = vi.spyOn(window, 'postMessage');
  const { unmount } = renderHook(() => useSourceImageSync(reloaded, () => false, projectId));
  expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SYNC_IMAGE_ATTR_TO_IFRAME' }), '*');
  unmount(); reloaded.destroy();
});

it('generated-image src and alt batches share their FIRST source and document acceptance', async () => {
  const { acceptEditorCommands } = await import('@/store/commandGesture');
  const { result } = await mount();
  await act(async () => {
    result.current.undo.takeSnapshot();
    await acceptEditorCommands(result.current.doc, [
      { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'src', value: '/uploads/generated.png' },
      { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'alt', value: 'Generated image' },
    ], result.current.undo.claimSnapshot());
    await awaitAccepted(projectId);
  });
  const accepted = await rows();
  expect(accepted).toHaveLength(1);
  expect(accepted[0].commands.map(command => command.kind)).toEqual(['file-batch']);
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<main><img src="/uploads/generated.png" alt="Generated image" /></main>\n');
  await act(async () => { await result.current.undo.undo(); await awaitAccepted(projectId); });
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(initial);
  expect(await rows()).toHaveLength(2);
});

it('composes class, image and following text intents on the same source file without stale baselines', async () => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { acceptEditorCommands } = await import('@/store/commandGesture');
  const original = '<main><img class="old" src="a" alt="Original" /><p>Before</p></main>\n';
  writeFileSync(join(runtime.root, file), original);
  const { result } = await mount();
  await act(async () => {
    result.current.undo.takeSnapshot();
    await acceptEditorCommands(result.current.doc, [
      { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key, classes: 'old', sourceLocation: { file, line: 1, column: 7 } },
      { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes: 'new', originalClasses: 'old' },
      { type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: key, attribute: 'src', value: '/uploads/a-much-longer-image.png' },
      { type: 'UPDATE_SOURCE_TEXT', sourceKey: `${file}:1:${original.indexOf('<p>') + 1}`, textContent: 'After', originalText: 'Before' },
    ], result.current.undo.claimSnapshot());
    await awaitAccepted(projectId);
  });
  expect(await rows()).toHaveLength(1);
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<main><img class="new" src="/uploads/a-much-longer-image.png" alt="Original" /><p>After</p></main>\n');
  await act(async () => { await result.current.undo.undo(); await awaitAccepted(projectId); });
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(original);
});
