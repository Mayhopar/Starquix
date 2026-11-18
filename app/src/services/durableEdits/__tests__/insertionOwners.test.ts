import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { insertLocalComponent, materializeLibraryComponent } from '@/components/Editor/localComponentInsert';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { _resetLocalPageSyncForTests, setLocalPageFile, setLocalExpectedRoute, setLocalScannedRoute } from '@/utils/localPageSync';
import { _resetStructuralWriteInFlightForTests, moveLocalElement, deleteLocalElement } from '@/components/Editor/localStructuralOps';
import * as store from '../store';
import { appendComponentToLayoutSource } from '@/components/Editor/Editor';
import * as Y from 'yjs';
import { deleteLocalElementGroup } from '@/hooks/useKeyboardShortcuts';
import { applyCommand } from '@/store/commands';
import { peekLocalPendingSelection, resolveLocalPendingMatch } from '@/utils/localPendingSelection';
import { acceptProjectEdit } from '../acceptance';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ProjectNavigationGuard } from '@/components/ProjectNavigationGuard';
import { Toaster } from 'react-hot-toast';
import { acceptStructuralReplay } from '../structuralReplayAcceptance';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { resolveProjectedSourceLocation, sourceVersion } from '../sourceIdentity';
import { generateCommandTools } from '@/ai/tools/commandTools';
import { makeCtx, type ExecTool } from '@/ai/tools/__tests__/testCtx';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { prepareSourceGesture } from '../sourceGesture';
import { acceptFileChanges } from '../fileAcceptance';

const file = 'src/pages/index.astro';
const original = '<main>\n  <p>Replace</p>\n</main>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_insert_${crypto.randomUUID()}`; setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [file]: original, 'src/components/Card.astro': '<section>Card</section>' });
});
afterEach(() => { cleanup(); runtime.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); });
const run = () => insertLocalComponent({
  component: { name: 'Card', path: 'src/components/Card.astro', source: 'user-project', html: '<section>Card</section>', category: '', props: [], slots: [], dependencies: [] },
  selection: null, scannedElements: [], pageFile: file, replaceKey: `${file}:2:3`,
});

// Immediate release-blocking follow-on. The old preview still calls Two by
// line 3 after the accepted move places it on line 2. A byte-only receipt is
// insufficient to remap identical siblings safely; do not weaken the fence.
it('release blocker: an unchanged preview key targets the same element after an accepted move', async () => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n' }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  try {
    await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
    await deleteLocalElement({ key: `${file}:3:3`, clearSelection() {} });
  } finally { release(); await flushDurableSourceWritesThrough(projectId, 2); }
  expect(runtime.read(file)).toBe('<main>\n  <p>One</p>\n</main>\n');
});

it('edits classes and inserts by unchanged preview coordinates after a move with no ACK', async () => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
  runtime = projectFsRuntime(projectId, { [file]: source }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  render(createElement(Toaster));
  try {
    await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
    await acceptProjectEdit(doc, { projectId, operationId: 'second-class', mutate() {}, commands: [{ kind: 'class-write', payload: {
      sourceLocation: { file, line: 3, column: 3 }, newClasses: 'chosen', baseClasses: '', origin: { armed: true, pageFile: file },
    } }] });
    const inserted = await viteStructuralWriter.writeInsert({ file, line: 3, column: 3 }, '<b>After Two</b>', 'after');
    expect(inserted).toMatchObject({ success: true, insertedLine: 3 });
    expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
    expect(runtime.read(file)).toBe(source);
  } finally { release(); await flushDurableSourceWritesThrough(projectId, 3); doc.destroy(); }
  expect(runtime.read(file)).toBe('<main>\n  <p class="chosen">Two</p>\n  <b>After Two</b>\n  <p>One</p>\n</main>\n');
});

it.each(['prior import', 'owned scan'])('projects two same-line class targets within one accepted gesture from %s', async (ownership) => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = '<p>A</p><p>B</p>\n';
  runtime = projectFsRuntime(projectId, { [file]: source }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  try {
    if (ownership === 'prior import') await viteStructuralWriter.writeImport(file, 'Card', '../components/Card.astro');
    await acceptProjectEdit(doc, { projectId, operationId: 'compound-classes', mutate() {}, commands: [1, 9].map((column, index) => ({ kind: 'class-write' as const, payload: {
      sourceLocation: { file, line: 1, column, ...(ownership === 'owned scan' ? { sourceVersion: sourceVersion(source), sourceRevision: 0 } : {}) }, newClasses: index ? 'second' : 'first', baseClasses: '', origin: { armed: true, pageFile: file },
    } })) });
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: ownership === 'prior import' ? 2 : 1, materializedRevision: 0 });
  } finally { release(); await flushDurableSourceWritesThrough(projectId, ownership === 'prior import' ? 2 : 1); doc.destroy(); }
  expect(runtime.read(file)).toContain('<p class="first">A</p><p class="second">B</p>');
});

it('reopens accepted identical-sibling identities and preserves them across undo and redo', async () => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = '<main>\n  <p>Same</p>\n  <p>Same</p>\n</main>\n';
  runtime = projectFsRuntime(projectId, { [file]: source }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const records: StructuralUndoRecord[] = [];
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  try {
    await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after', pushUndo: r => records.push(r) });
    await acceptStructuralReplay(doc, records[0].structuralOp.inverse, records[0].structuralOp.sourceFiles);
    expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 3 })).toMatchObject({ line: 2 });
    await acceptStructuralReplay(doc, records[0].structuralOp.forward, records[0].structuralOp.sourceFiles, 'after');
    db.close(); await db.open();
    expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 3 })).toMatchObject({ line: 3 });
    await deleteLocalElement({ key: `${file}:3:3`, clearSelection() {} });
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 4 });
  } finally { release(); await flushDurableSourceWritesThrough(projectId, 4); doc.destroy(); }
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime.read(file)).toBe('<main>\n  <p>Same</p>\n</main>\n');
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 3 })).toMatchObject({ line: 2 });
  await expect(resolveProjectedSourceLocation(projectId, { file, line: 3, column: 3 })).rejects.toThrow('deleted');
});

it('replaces the moved identity and publishes its final selection before the import ACK', async () => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n', 'src/components/Card.astro': '<section>Card</section>' }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  try {
    await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
    expect(await run()).toMatchObject({ ok: true, insertedLine: 6 });
    expect(peekLocalPendingSelection()).toMatchObject({ predicted: `${file}:6:` });
  } finally { release(); await flushDurableSourceWritesThrough(projectId, 2); }
  expect(runtime.read(file)).toContain('<p>Two</p>\n  <Card />');
  expect(runtime.read(file)).not.toContain('<p>One</p>');
});

it('accepts AI class edit and deletion through original keys after reorder without a rescan', async () => {
  markFilesTruth(projectId);
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n' }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const scanned = [{ key: `${file}:2:3`, sourceLocation: { file, line: 2, column: 3 }, classes: '' },
    { key: `${file}:3:3`, sourceLocation: { file, line: 3, column: 3 }, classes: '' }];
  const ctx = makeCtx({ doc, getScannedElements: () => scanned as ReturnType<ReturnType<typeof makeCtx>['getScannedElements']> });
  try {
    await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
    expect((await (generateCommandTools(ctx).update_element_by_key as ExecTool).execute({ sourceKey: `${file}:3:3`, classes: 'chosen' })).success).toBe(true);
    expect((await (generateCommandTools(ctx).delete_element as ExecTool).execute({ elementId: `${file}:2:3` })).success).toBe(true);
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
  } finally { release(); await flushDurableSourceWritesThrough(projectId, (await store.getDurableProjectState(projectId)).acceptedRevision); doc.destroy(); unmarkFilesTruth(projectId); }
  expect(runtime.read(file)).toBe('<main>\n  <p class="chosen">Two</p>\n</main>\n');
});

it.each(['surface', 'project ABA'])('2026-09-16: a gesture straddling a %s generation bump is accepted, not refused', async owner => {
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const gesture = prepareSourceGesture(projectId);
  if (owner === 'surface') { setLocalExpectedRoute('/away'); setLocalExpectedRoute('/'); setLocalScannedRoute('/'); }
  else { setActiveSaveProjectId('another-project'); setActiveSaveProjectId(projectId); }
  await acceptFileChanges(`wc://${projectId}`, async () => {
    await gesture.apply({ kind: 'remove', loc: { file, line: 2, column: 3 } });
    return [...gesture.files.values()];
  });
  await flushDurableSourceWritesThrough(projectId, (await store.getDurableProjectState(projectId)).acceptedRevision);
  expect(await db.durableEdits.count()).toBe(1);
  expect(runtime.read(file)).not.toBe(original);
});

it('still refuses a gesture once ANOTHER project is active', async () => {
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const gesture = prepareSourceGesture(projectId);
  setActiveSaveProjectId('another-project');
  await expect(acceptFileChanges(`wc://${projectId}`, async () => {
    await gesture.apply({ kind: 'remove', loc: { file, line: 2, column: 3 } });
    return [...gesture.files.values()];
  })).rejects.toThrow('Another project is active');
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(original);
});

it('2026-09-16: a queued component insertion survives a project ABA', async () => {
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const pending = run();
  setActiveSaveProjectId('another-project'); setActiveSaveProjectId(projectId);
  const result = await pending;
  await flushDurableSourceWritesThrough(projectId, (await store.getDurableProjectState(projectId)).acceptedRevision);
  expect(result).toMatchObject({ ok: true });
  expect(await db.durableEdits.count()).toBeGreaterThan(0);
  expect(runtime.read(file)).not.toBe(original);
});

it('chains reorder, deletion, navigation and undo while source ACK is indefinitely blocked', async () => {
  runtime.close(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: () => gate });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const records: StructuralUndoRecord[] = [];
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const router = createMemoryRouter([{ path: '/', element: createElement(ProjectNavigationGuard, { projectId }) },
    { path: '/next', element: createElement('p', null, 'Next page') }]);
  render(createElement(RouterProvider, { router })); render(createElement(Toaster));
  let chained: Promise<void> | undefined;
  try {
    expect(await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after', pushUndo: r => records.push(r) })).toBe(true);
    setLocalScannedRoute('/');
    let accepted = false;
    chained = (async () => {
      expect(await deleteLocalElement({ key: `${file}:2:3`, clearSelection() {}, pushUndo: r => records.push(r) })).toBe(true);
      await acceptStructuralReplay(doc, records[1].structuralOp!.inverse);
      accepted = true;
    })();
    await act(async () => { await vi.waitFor(() => expect(accepted).toBe(true)); });
    expect(accepted).toBe(true);
    await act(async () => { await router.navigate('/next'); });
    expect(screen.getByText('Next page')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 3, materializedRevision: 0 });
    expect(runtime.read(file)).toBe(original);
  } finally { release(); await chained; await flushDurableSourceWritesThrough(projectId, 3); doc.destroy(); }
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWritesThrough(projectId, 3);
  expect(runtime.read(file)).toBe('<main>\n  <p>Two</p>\n  <p>One</p>\n</main>\n');
});

it.each(['move', 'delete'])('accepts a source %s and publishes undo without waiting for source acknowledgement', async kind => {
  runtime.close();
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n' }, { beforeCommand: async () => { started(); await gate; } });
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const undo: unknown[] = [];
  const moving = kind === 'move' ? moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after', pushUndo: record => { undo.push(record); } })
    : deleteLocalElement({ key: `${file}:2:3`, clearSelection: () => {}, pushUndo: record => { undo.push(record); } });
  try {
    expect(await Promise.race([moving.then(() => 'accepted'), dispatched.then(() => 'waiting-for-source')])).toBe('accepted');
    expect(undo).toHaveLength(1);
    expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
  } finally { release(); await moving; await flushDurableSourceWritesThrough(projectId, 1); }
  expect(runtime.read(file)).toContain(kind === 'move' ? '<p>Two</p>\n  <p>One</p>' : '<p>Two</p>');
});

it('prepares insertion after an accepted class edit without waiting for its debounce', async () => {
  writeFileSync(join(runtime.root, file), '<main class="p-2">\n  <p>Replace</p>\n</main>\n');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  await acceptProjectEdit(doc, { projectId, operationId: 'class-first', mutate: () => {}, commands: [{ kind: 'class-write', payload: {
    sourceLocation: { file, line: 1, column: 1 }, newClasses: 'p-4', baseClasses: 'p-2',
    origin: { armed: true, pageFile: file }, deferUntil: Date.now() + 60_000,
  } }] });
  expect((await run()).ok).toBe(true);
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toContain('class="p-4"');
  expect(runtime.read(file)).toContain('<Card');
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 2 });
  doc.destroy();
});

it('accepts import, placement and replacement in one revision', async () => {
  const inserted = await run();
  expect(inserted.ok).toBe(true);
  expect(await db.durableEdits.count()).toBe(1);
  await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toContain('<Card');
  expect(runtime.read(file)).not.toContain('Replace');
  const finalLine = runtime.read(file).split('\n').findIndex(line => line.includes('<Card')) + 1;
  expect(inserted).toMatchObject({ insertedLine: finalLine });
  expect(resolveLocalPendingMatch(peekLocalPendingSelection()!, [`${file}:${finalLine}:3`]).key).toBe(`${file}:${finalLine}:3`);
});

it('returns accepted insertion and its inverse before the source ACK', async () => {
  runtime.close(); let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const dispatch = new Promise<void>(resolve => { started = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: original, 'src/components/Card.astro': '<section>Card</section>' }, { beforeCommand: async () => { started(); await gate; } });
  const inserting = run();
  try { expect(await Promise.race([inserting.then(() => 'accepted'), dispatch.then(() => 'waiting')])).toBe('accepted'); }
  finally { release(); await inserting; await flushDurableSourceWritesThrough(projectId, 1); }
});

it('opens an accepted project component copy without waiting for its source ACK', async () => {
  runtime.close(); let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const dispatch = new Promise<void>(resolve => { started = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: async () => { started(); await gate; } });
  const copying = materializeLibraryComponent({ id: 'theme', name: 'Hero', html: '<section>Hero</section>' } as never, `wc://${projectId}`);
  try {
    expect(await Promise.race([copying.then(result => result.ok ? 'accepted' : result.reason), dispatch.then(() => 'waiting')])).toBe('accepted');
  } finally { release(); await copying; await flushDurableSourceWritesThrough(projectId, 1); }
});

it('rejects storage without leaving an import or partial placement', async () => {
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('insert quota'));
  expect((await run()).ok).toBe(false);
  expect(runtime.read(file)).toBe(original);
  expect(await db.durableEdits.count()).toBe(0);
});

it('rejects a bundled component gesture before creating its component file', async () => {
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('insert quota'));
  const result = await insertLocalComponent({ component: { id: 'theme', name: 'Hero', html: '<section>Hero</section>' } as never,
    selection: null, scannedElements: [], pageFile: file, localProjectPath: `wc://${projectId}` });
  expect(result.ok).toBe(false);
  expect(runtime.journal.since(0).entries).toEqual([]);
  expect(runtime.read(file)).toBe(original);
});

it('rejects layout append acceptance without calling a shared host save route', async () => {
  runtime.close(); runtime = projectFsRuntime(projectId, { 'src/layouts/Host.astro': '<Layout></Layout>' });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<Layout></Layout>'));
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('layout quota'));
  await expect(appendComponentToLayoutSource('layouts/Host.astro', 'Card', 'library/Card.astro')).rejects.toThrow('layout quota');
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('accepts mixed source/document deletion in one revision', async () => {
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page', name: '/', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-a', pageId: 'page', tag: 'div', classes: '', textContent: '', parentKey: null, insertIndex: 0 } });
  await deleteLocalElementGroup([{ key: 'drawn-a', elementId: 'drawn-a' }, { key: `${file}:2:3`, elementId: null }], {
    docDeps: { doc, dispatch: action => applyCommand(doc, action), scannedElements: [] },
    scannedByKey: new Map(), takeSnapshot: () => {}, clearSelection: () => {},
  });
  expect(doc.getMap('elements').has('drawn-a')).toBe(false);
  await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).not.toContain('Replace');
  expect(await db.durableEdits.count()).toBe(1);
  doc.destroy();
});
