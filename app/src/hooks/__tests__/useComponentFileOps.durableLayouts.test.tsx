import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth } from '@/utils/localMode';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { hasPendingUserAcceptance } from '@/services/durableEdits/acceptance';
import { acceptFileChanges } from '@/services/durableEdits/fileAcceptance';
import type { DurableFileChange } from '@/services/durableEdits/types';
import type { MutationSnapshot } from '@/store/documentMutation';
import { useComponentFileOps } from '../useComponentFileOps';
import { useLayoutLibrary } from '../useLayoutLibrary';
import { resolveProjectedSourceLocation, sourceVersion, invertIdentityMaps } from '@/services/durableEdits/sourceIdentity';

const h = vi.hoisted(() => ({ folder: '' }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => h.folder }));
const layoutFile = 'src/layouts/Foo.astro';
const layout = '<html><body><header>Chrome</header><slot /></body></html>\n';
const pageFile = 'src/pages/index.astro';
const page = '---\r\nimport Foo from "../layouts/Foo.astro";\r\n---\r\n<Foo><p>Original</p></Foo>\r\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let dispatched: number;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_layout_crud_${crypto.randomUUID()}`; markFilesTruth(projectId);
  h.folder = `wc://${projectId}`; setActiveSaveProjectId(projectId); dispatched = 0;
  runtime = projectFsRuntime(projectId, { [layoutFile]: layout, [pageFile]: page }, {
    beforeCommand: async () => { dispatched++; expect(await db.durableEdits.count()).toBeGreaterThan(0); },
    loseAcknowledgement: () => true,
  });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('registers layout acceptance immediately and keeps source untouched until durable dispatch', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  const pending = result.current.createLayout('Fresh', '<main><slot /></main>');
  expect(hasPendingUserAcceptance(projectId)).toBe(true);
  expect(await pending).toBe('src/layouts/Fresh.astro');
  expect(await db.durableEdits.count()).toBe(1);
  expect(() => runtime.read('src/layouts/Fresh.astro')).toThrow('ENOENT');
  expect(dispatched).toBe(0);
});

it.each(['create', 'delete', 'inline', 'restore'] as const)('refuses %s without file changes when IndexedDB rejects acceptance', async action => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  const { result } = renderHook(() => useComponentFileOps());
  const output = action === 'create' ? await result.current.createLayout('Fresh', '<slot />')
    : action === 'delete' ? await result.current.deleteLayout('Foo')
      : action === 'inline' ? await result.current.inlineDeleteLayout('Foo')
        : await result.current.restoreFiles([{ file: pageFile, content: '<p>Replacement</p>' }]);
  expect(output).toBe(action === 'restore' ? false : null);
  expect(await db.durableEdits.count()).toBe(0); expect(dispatched).toBe(0);
  expect(runtime.read(layoutFile)).toBe(layout); expect(runtime.read(pageFile)).toBe(page);
  expect(() => runtime.read('src/layouts/Fresh.astro')).toThrow('ENOENT');
});

it('inlines accepted importer bytes and journals exact delete/restore/redo across reload and lost ACKs', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  const changedPage = page.replace('Original', 'Accepted');
  await acceptFileChanges(h.folder, [{ file: pageFile, beforeSource: page, afterSource: changedPage }]);
  const previous = await result.current.inlineDeleteLayout('Foo');
  expect(previous).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: pageFile, content: changedPage }), expect.objectContaining({ file: layoutFile, content: layout }),
  ]));
  expect(await db.durableEdits.count()).toBe(2); expect(runtime.read(pageFile)).toBe(page);
  expect(await result.current.restoreFiles(previous!)).toBe(true);
  expect(await resolveProjectedSourceLocation(projectId, { file: pageFile, line: 4, column: 6,
    sourceRevision: 1, sourceVersion: sourceVersion(changedPage) })).toMatchObject({ line: 4, column: 6 });
  expect(await result.current.inlineDeleteLayout('Foo')).not.toBeNull();
  expect(await db.durableEdits.count()).toBe(4); expect(dispatched).toBe(0);
  db.close(); await db.open(); runtime.restart();
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(pageFile)).toContain('<header>Chrome</header><p>Accepted</p>');
  expect(runtime.read(pageFile)).not.toContain('import Foo');
  expect(() => runtime.read(layoutFile)).toThrow('ENOENT');
  expect(dispatched).toBe(4);
});

it('rejects collisions in the accepted prefix and aborts all importers when one uses the layout twice', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  expect(await result.current.createLayout('../escape', '<slot />')).toBeNull();
  expect(await result.current.createLayout('Fresh', '<slot />')).toBeTruthy();
  expect(await result.current.createLayout('Fresh', '<slot />')).toBeNull();
  await acceptFileChanges(h.folder, [{ file: 'src/pages/other.astro', beforeSource: null,
    afterSource: '---\nimport Foo from "../layouts/Foo.astro";\n---\n<Foo /><Foo />' }]);
  expect(await result.current.inlineDeleteLayout('Foo')).toBeNull();
  expect(await db.durableEdits.count()).toBe(2);
  expect(runtime.read(layoutFile)).toBe(layout); expect(runtime.read(pageFile)).toBe(page);
});

it('attaches an exact source-only undo snapshot and commits it after acceptance without staging a dummy document', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  let attached: DurableFileChange[] = [], committed = false;
  const snapshot: MutationSnapshot = {
    stage: () => { throw new Error('Source-only snapshot must not stage an empty document'); },
    attachFiles: files => { attached = files; },
    commit: () => { committed = true; },
  };
  // The layout owner must pass the claimed inverse through its acceptance.
  expect(await result.current.createLayout('Fresh', '<slot />', snapshot)).toBe('src/layouts/Fresh.astro');
  expect(await db.durableEdits.count()).toBe(1); expect(committed).toBe(true);
  expect(attached).toEqual([{ file: 'src/layouts/Fresh.astro', beforeSource: null, afterSource: '<slot />' }]);
});

it('preserves the original child identity through inlining and exact Undo/Redo before source ACK', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  await result.current.inlineDeleteLayout('Foo');
  const old = { file: pageFile, line: 4, column: 6, sourceVersion: sourceVersion(page) };
  expect(await resolveProjectedSourceLocation(projectId, old)).toMatchObject({ line: 1, column: 36 });
  const command = (await db.durableEdits.toArray())[0].commands[0];
  if (command.kind !== 'file-batch') throw new Error('Expected a file batch');
  await acceptFileChanges(h.folder, command.payload.files.map(file => ({ ...file, beforeSource: file.afterSource,
    afterSource: file.beforeSource, identityMaps: invertIdentityMaps(file.identityMaps ?? []) })));
  expect(await resolveProjectedSourceLocation(projectId, old)).toMatchObject({ line: 4, column: 6 });
  await acceptFileChanges(h.folder, command.payload.files);
  expect(await resolveProjectedSourceLocation(projectId, old)).toMatchObject({ line: 1, column: 36 });
  expect(runtime.read(pageFile)).toBe(page);
});

it('lists accepted layout creates and deletes before source materialization and after remount', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  const listing = renderHook(() => useLayoutLibrary());
  await waitFor(() => expect(listing.result.current.layouts.map(item => item.name)).toEqual(['Foo']));
  await act(async () => { await result.current.createLayout('Fresh', '<main><slot /></main>'); });
  await waitFor(() => expect(listing.result.current.layouts.map(item => item.name)).toEqual(['Foo', 'Fresh']));
  await act(async () => { await result.current.inlineDeleteLayout('Foo'); });
  await waitFor(() => expect(listing.result.current.layouts.map(item => item.name)).toEqual(['Fresh']));
  listing.unmount(); db.close(); await db.open();
  const reopened = renderHook(() => useLayoutLibrary());
  await waitFor(() => expect(reopened.result.current.layouts.map(item => item.name)).toEqual(['Fresh']));
  expect(reopened.result.current.layouts[0].body).toBe('<main><slot /></main>');
  expect(dispatched).toBe(0); expect(runtime.read(layoutFile)).toBe(layout);
});

it('tracks named-slot moves, stripped slot attributes and nested children using byte provenance', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  const nestedPage = '---\r\nimport Reorder from "../layouts/Reorder.astro";\r\n---\r\n<aside>é🙂</aside>\r\n<Reorder><h1 slot="head"><em>Same</em></h1><p>Same</p></Reorder>\r\n<footer>Same</footer>';
  await acceptFileChanges(h.folder, [
    { file: 'src/layouts/Reorder.astro', beforeSource: null, afterSource: '<article><slot /><header><slot name="head" /></header></article>' },
    { file: 'src/pages/named.astro', beforeSource: null, afterSource: nestedPage },
  ]);
  expect(await result.current.inlineDeleteLayout('Reorder')).not.toBeNull();
  const target = (line: number, column: number) => ({ file: 'src/pages/named.astro', line, column, sourceRevision: 1, sourceVersion: sourceVersion(nestedPage) });
  expect(await resolveProjectedSourceLocation(projectId, target(5, 10))).toMatchObject({ line: 2, column: 29 });
  expect(await resolveProjectedSourceLocation(projectId, target(5, 26))).toMatchObject({ line: 2, column: 33 });
  expect(await resolveProjectedSourceLocation(projectId, target(5, 44))).toMatchObject({ line: 2, column: 10 });
  expect(await resolveProjectedSourceLocation(projectId, target(4, 1))).toMatchObject({ line: 1, column: 1 });
  expect(await resolveProjectedSourceLocation(projectId, target(6, 1))).toMatchObject({ line: 3, column: 1 });
});

it('refuses an old inline-delete restore if an importer has changed since the deletion', async () => {
  const { result } = renderHook(() => useComponentFileOps());
  const previous = await result.current.inlineDeleteLayout('Foo');
  const command = (await db.durableEdits.toArray())[0].commands[0];
  if (command.kind !== 'file-batch') throw new Error('Expected a file batch');
  const changed = command.payload.files.find(item => item.file === pageFile)!;
  await acceptFileChanges(h.folder, [{ file: pageFile, beforeSource: changed.afterSource, afterSource: '<p>Later accepted edit</p>' }]);
  expect(await result.current.restoreFiles(previous!)).toBe(false);
  expect(await db.durableEdits.count()).toBe(2);
});
