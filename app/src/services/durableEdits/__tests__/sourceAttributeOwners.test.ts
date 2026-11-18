import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { moveLocalElement, deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { viteImageWriter } from '@/services/ViteImageWriter';
import { getDurableProjectState } from '../store';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { sourceVersion } from '../sourceIdentity';
import * as Y from 'yjs';
import { act, renderHook } from '@testing-library/react';
import { useSourceImageSync } from '@/hooks/useSourceImageSync';
import { awaitAccepted } from '../acceptance';
import * as astUpdater from '@/vite-plugin/ast-updater';

const file = 'src/pages/index.astro';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, release: () => void;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_attribute_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  runtime?.close(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function source(text: string) {
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: text }, { beforeCommand: () => gate });
}

it('accepts a source image attribute through the original key after reorder without iframe or source ACK', async () => {
  source('<main>\n  <img src="a" />\n  <img src="b" />\n</main>\n');
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  expect(await viteImageWriter.writeImageUpdate({ file, line: 3, column: 3 }, 'src', 'updated-b')).toBe(true);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main>\n  <img src="updated-b" />\n  <img src="a" />\n</main>\n');
});

it('maps same-line image attribute shifts before deleting the following original source key', async () => {
  source('<main><img src="a"/><p>Keep</p><p>Remove</p></main>\n');
  expect(await viteImageWriter.writeImageUpdate({ file, line: 1, column: 7 }, 'src', 'long-image.png')).toBe(true);
  expect(await deleteLocalElement({ key: `${file}:1:32`, clearSelection() {} })).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main><img src="long-image.png"/><p>Keep</p></main>\n');
});

it('rejects an externally changed initial source version without acceptance', async () => {
  source('<main><img src="external"/></main>\n');
  await expect(viteImageWriter.writeImageUpdate({ file, line: 1, column: 7, sourceVersion: sourceVersion('<main><img src="a"/></main>\n') }, 'src', 'new')).rejects.toThrow(/version/);
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe('<main><img src="external"/></main>\n');
});

it('retains cross-file default deny while explicit master image writes remain authorized', async () => {
  source('<main><img src="a"/></main>\n');
  setLocalPageFile('src/pages/other.astro');
  await expect(viteImageWriter.writeImageUpdate({ file, line: 1, column: 7 }, 'src', 'refused')).rejects.toThrow(/another surface/);
  expect(await db.durableEdits.count()).toBe(0);
  expect(await viteImageWriter.writeImageUpdate({ file, line: 1, column: 7 }, 'src', 'master', true)).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<main><img src="master"/></main>\n');
});

it('the queued image owner keeps a fresh scan revision after an identical reorder without an iframe', async () => {
  const original = '<main>\n  <img src="same" />\n  <img src="same" />\n</main>\n'; source(original);
  await moveLocalElement({ key: `${file}:2:3`, targetKey: `${file}:3:3`, position: 'after' });
  const doc = new Y.Doc();
  const key = `${file}:2:3`;
  doc.getMap('sourceClasses').set(key, new Y.Map([['sourceLocation', new Y.Map<unknown>(Object.entries({ file, line: 2, column: 3,
    sourceVersion: sourceVersion(original), sourceRevision: 1 }))]]));
  const { unmount } = renderHook(() => useSourceImageSync(doc, () => false, projectId));
  await act(async () => {
    doc.getMap('sourceImageAttributes').set(key, new Y.Map([['src', 'fresh-first']]));
    unmount(); await awaitAccepted(projectId);
  });
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2 });
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main>\n  <img src="fresh-first" />\n  <img src="same" />\n</main>\n');
  doc.destroy();
});

it.each(['project', 'surface'] as const)('2026-09-16: image preparation that straddled a %s navigation ABA is accepted', async owner => {
  const original = '<main><img src="a"/></main>\n'; source(original);
  let transformed!: () => void, releaseTransform!: () => void;
  const transforming = new Promise<void>(resolve => { transformed = resolve; });
  const gate = new Promise<void>(resolve => { releaseTransform = resolve; });
  const update = astUpdater.updateImageAttribute;
  vi.spyOn(astUpdater, 'updateImageAttribute').mockImplementationOnce(async (...args) => {
    const result = await update(...args); transformed(); await gate; return result;
  });
  const pending = viteImageWriter.writeImageUpdate({ file, line: 1, column: 7 }, 'src', 'changed');
  void pending.catch(() => {});
  await transforming;
  if (owner === 'project') { setActiveSaveProjectId('another'); setActiveSaveProjectId(projectId); }
  else { setLocalPageFile('src/pages/away.astro'); setLocalPageFile(file); }
  releaseTransform();
  await expect(pending).resolves.toBeDefined();
  expect(await db.durableEdits.count()).toBe(1);
});
