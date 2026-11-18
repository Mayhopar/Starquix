import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { getLocalSourceScanRevision, setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { moveLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { generateCommandTools } from '@/ai/tools/commandTools';
import { makeCtx, type ExecTool } from '@/ai/tools/__tests__/testCtx';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { ClassStoreProvider, useClassStore } from '@/context/ClassStoreContext';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { resolveProjectedSourceLocation, sourceVersion } from '../sourceIdentity';
import { handleEditModeExited, handleMarkupChanged } from '@/components/Canvas/viewportMessages/textEditing';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { handleElementClick } from '@/components/Canvas/viewportMessages/selection';
import { makeFakeCtx } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import type { ScannedElement } from '@/context/SelectionContext';
import { acceptEditorCommands } from '@/store/commandGesture';
import { useDispatch } from '@/store/hooks';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = 'src/pages/index.astro', key = `${file}:2:3`;
const original = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
const moved = '<main>\n  <p>Two</p>\n  <p>Changed One</p>\n</main>\n';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, release: (() => void) | undefined;
let gate: Promise<void>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_fresh_scan_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); gate = Promise.resolve();
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: () => gate });
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  cleanup(); runtime.close(); h.doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
});

it.each(['AI text', 'AI classes', 'AI compound', 'viewport text', 'viewport markup', 'registered classes', 'retained registered classes', 'source-key command', 'dispatch text', 'dispatch classes', 'dispatch markup', 'grid placement', 'grid span'] as const)(
  '%s uses the current authenticated scan when a retained key now identifies another element', async owner => {
    const { result } = renderHook(() => ({ undo: useUndoContext(), classes: useClassStore(), dispatch: useDispatch() }), {
      wrapper: ({ children }) => <UndoProvider><ClassStoreProvider>{children}</ClassStoreProvider></UndoProvider>,
    });
    const ctx = makeFakeCtx({ env: { doc: h.doc, projectId } });
    ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
    ctx.actions.takeSnapshot = result.current.undo.takeSnapshot;
    ctx.actions.claimSnapshot = result.current.undo.claimSnapshot;
    ctx.refs.registerElement.current = (...args) => result.current.classes.registerElement(...args);
    const scan = (documentId: string, texts: [string, string]) => {
      const bytes = runtime.read(file)!;
      const elements = texts.map((textContent, index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes: '', textContent,
        parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: sourceVersion(bytes) },
        rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
      handleElementsScanned(ctx, { route: '/', documentId, elements });
    };
    scan('initial-document', ['One', 'Two']);
    if (owner === 'retained registered classes') act(() => {
      handleElementClick(ctx, { key, tagName: 'p', classes: '', sourceLocation: { file, line: 2, column: 3 },
        rect: { top: 0, left: 0, width: 10, height: 10 } });
    });
    const aiContext = makeCtx({ doc: h.doc, getCurrentPageFile: () => file,
      getScannedElements: () => ctx.refs.scannedElements.current,
      takeSnapshot: result.current.undo.takeSnapshot, claimSnapshot: result.current.undo.claimSnapshot });
    const tool = generateCommandTools(aiContext).update_element_by_key as ExecTool;
    await act(async () => { expect((await tool.execute({ sourceKey: key, textContent: 'Changed One' })).success).toBe(true); });
    await act(async () => { await moveLocalElement({ key, targetKey: `${file}:3:3`, position: 'after', pushUndo: result.current.undo.pushStructuralUndo }); });
    await act(async () => { await flushDurableSourceWritesThrough(projectId, 2); });
    expect(runtime.read(file)).toBe(moved);
    await act(async () => { scan('fresh-document', ['Two', 'Changed One']); });
    expect(getLocalSourceScanRevision()).toBe(2);
    expect(ctx.refs.scannedElements.current[0].sourceLocation).toMatchObject({ sourceVersion: sourceVersion(moved), sourceRevision: 2 });
    gate = new Promise<void>(resolve => { release = resolve; });
    await act(async () => {
      if (owner.startsWith('AI')) expect((await tool.execute({ sourceKey: key,
        ...(owner !== 'AI classes' ? { textContent: 'Updated Two' } : {}),
        ...(owner !== 'AI text' ? { classes: 'chosen' } : {}),
      })).success).toBe(true);
      else if (owner === 'viewport text') {
        result.current.undo.takeSnapshot();
        await handleEditModeExited(ctx, { key, originalText: 'Two', textContent: 'Updated Two' });
      } else if (owner === 'viewport markup') await handleMarkupChanged(ctx, { key, innerHTML: '<b>Updated Two</b>' });
      else if (owner === 'source-key command') {
        result.current.undo.takeSnapshot();
        await acceptEditorCommands(h.doc, [{ type: 'UPDATE_SOURCE_TEXT', sourceKey: key, originalText: 'Two', textContent: 'Updated Two' }], result.current.undo.claimSnapshot());
      }
      else if (owner.startsWith('dispatch ')) {
        result.current.undo.takeSnapshot();
        await result.current.dispatch(owner === 'dispatch classes' ? { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key, classes: 'chosen' }
          : owner === 'dispatch markup' ? { type: 'UPDATE_SOURCE_MARKUP', sourceKey: key, markup: '<b>Updated Two</b>' }
          : { type: 'UPDATE_SOURCE_TEXT', sourceKey: key, originalText: 'Two', textContent: 'Updated Two' });
      }
      else if (owner.startsWith('grid ')) {
        result.current.undo.takeSnapshot();
        await acceptEditorCommands(h.doc, [{ type: owner === 'grid placement' ? 'GRID_PLACE_ELEMENT' : 'SET_GRID_SPAN', key,
          gridColumn: 'col-span-2', gridRow: '' }], result.current.undo.claimSnapshot());
      }
      else {
        if (owner === 'registered classes') handleElementClick(ctx, { key, tagName: 'p', classes: '', sourceLocation: { file, line: 2, column: 3 },
          rect: { top: 0, left: 0, width: 10, height: 10 } });
        expect(await result.current.classes.setClasses(key, 'chosen')).toBe(true);
      }
    });
    expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 2 });
    release!(); await act(async () => { await flushDurableSourceWritesThrough(projectId, 3); });
    const classStoreOwner = owner === 'registered classes' || owner === 'retained registered classes';
    const changedTwo = owner.startsWith('grid ') ? '<p class="col-span-2">Two</p>'
      : owner === 'AI classes' || owner === 'dispatch classes' || classStoreOwner ? '<p class="chosen">Two</p>'
      : owner === 'AI compound' ? '<p class="chosen">Updated Two</p>'
      : owner === 'viewport markup' || owner === 'dispatch markup' ? '<p><b>Updated Two</b></p>' : '<p>Updated Two</p>';
    expect(runtime.read(file)).toBe(`<main>\n  ${changedTwo}\n  <p>Changed One</p>\n</main>\n`);
    await act(async () => { await result.current.undo.undo(); });
    await act(async () => { await flushDurableSourceWritesThrough(projectId, 4); });
    expect(runtime.read(file)).toBe(moved);
    await act(async () => { await result.current.undo.redo(); await flushDurableSourceWritesThrough(projectId, 5); });
    expect(runtime.read(file)).toBe(`<main>\n  ${changedTwo}\n  <p>Changed One</p>\n</main>\n`);
    await act(async () => { await result.current.undo.undo(); await flushDurableSourceWritesThrough(projectId, 6); });
    expect(runtime.read(file)).toBe(moved);
    const first = (await db.durableEdits.where('projectId').equals(projectId).sortBy('revision'))[0];
    const text = first.commands.find(command => command.kind === 'source-batch');
    expect(text?.kind === 'source-batch' && text.payload.sourceTextEdits?.[0].sourceLocation).toMatchObject({ sourceRevision: 0, sourceVersion: sourceVersion(original) });
    expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 3, sourceVersion: sourceVersion(original), sourceRevision: 0 })).toMatchObject({ line: 3, column: 3 });
  },
);
