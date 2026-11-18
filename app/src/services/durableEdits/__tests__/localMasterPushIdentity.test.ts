import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setServerWriteMode } from '@/services/serverWriteMode';
import { setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { viteClassWriter } from '@/services/ViteClassWriter';
import { setClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { pushLocalOverridesToMaster, readLocalPushFiles } from '@/store/localMasterOverrides';
import { updateClassAttribute } from '@/vite-plugin/ast-updater';
import { getDurableProjectState } from '../store';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { sourceVersion } from '../sourceIdentity';
import { acceptFileChanges } from '../fileAcceptance';

const file = 'src/components/Hero.astro', placement = 'p5e23e503da89f633';
const initial = '<section><h1 class="old">Original</h1><img src="a.png" alt="Old image" /></section>\n';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, frame: HTMLIFrameElement;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open(); resetClassWriteBaselines();
  projectId = `browser_push_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  setLocalPageFile('src/pages/index.astro'); setLocalExpectedRoute('/'); setLocalScannedRoute('/'); setServerWriteMode(true);
  runtime = projectFsRuntime(projectId, { [file]: initial });
  frame = document.createElement('iframe'); document.body.appendChild(frame);
  viteClassWriter.setIframeRef(frame); viteClassWriter.setLocalInstanceState({ status: 'running', url: 'https://preview.test' });
  // Exercise the existing legacy class bridge honestly: it changes the real
  // runtime file and replies, but cannot invent a durable identity receipt.
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(message => {
    const { type, payload } = message as { type: string; payload: { requestId: string; sourceLocation: { file: string; line: number; column: number }; newClasses: string; baseClasses: string } };
    if (type !== 'SQ_WRITE_CLASSES') return;
    void updateClassAttribute(runtime.read(file), file, payload.sourceLocation, payload.newClasses, payload.baseClasses).then(text => {
      writeFileSync(join(runtime.root, file), text);
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { type: 'SQ_WRITE_RESULT', payload: { requestId: payload.requestId, success: true } } }));
    });
  });
});
afterEach(async () => {
  await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  viteClassWriter.setIframeRef(null); viteClassWriter.setLocalInstanceState(null); frame.remove(); runtime.close();
  unmarkFilesTruth(projectId); setActiveSaveProjectId(null); setServerWriteMode(false); _resetLocalPageSyncForTests(); resetClassWriteBaselines();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('confirmed Push composes class, text and image writes through the original scanned source identity', async () => {
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const headingColumn = initial.indexOf('<h1') + 1, imageColumn = initial.indexOf('<img') + 1;
  const headingKey = `${file}:1:${headingColumn}~${placement}`, imageKey = `${file}:1:${imageColumn}~${placement}`;
  const location = (column: number) => new Y.Map<unknown>(Object.entries({ file, line: 1, column, sourceVersion: sourceVersion(initial), sourceRevision: 0 }));
  doc.getMap('sourceClasses').set(headingKey, new Y.Map<unknown>([['classes', 'text-center text-red-500'], ['baseClasses', 'old'], ['edited', true], ['sourceLocation', location(headingColumn)]]));
  doc.getMap('sourceText').set(headingKey, new Y.Map<unknown>([['textContent', 'Pushed title'], ['sourceLocation', location(headingColumn)]]));
  doc.getMap('sourceClasses').set(imageKey, new Y.Map<unknown>([['classes', ''], ['sourceLocation', location(imageColumn)]]));
  doc.getMap('sourceImageAttributes').set(imageKey, new Y.Map<unknown>([['src', 'long-new-image.png'], ['alt', 'Pushed image']]));
  setClassWriteBaseline(headingKey, 'old');
  const result = await pushLocalOverridesToMaster(doc, file, placement);
  expect(result).toMatchObject({ pushed: 3, failed: 0, reasons: [] });
  const state = await getDurableProjectState(projectId); await flushDurableSourceWritesThrough(projectId, state.acceptedRevision);
  expect(runtime.read(file)).toBe('<section><h1 class="text-center text-red-500">Pushed title</h1><img src="long-new-image.png" alt="Pushed image" /></section>\n');
  expect(doc.getMap('sourceText').has(headingKey)).toBe(false);
  expect(doc.getMap('sourceImageAttributes').has(imageKey)).toBe(false);
  doc.destroy();
});

it('a local instance class edit without explicit Push never changes its master', async () => {
  expect(await viteClassWriter.writeClassUpdate({ file, line: 1, column: initial.indexOf('<h1') + 1,
    sourceVersion: sourceVersion(initial), sourceRevision: 0 }, 'text-xl', false, 'old')).toBe(false);
  expect(runtime.read(file)).toBe(initial);
  expect(await db.durableEdits.count()).toBe(0);
  expect(frame.contentWindow!.postMessage).not.toHaveBeenCalled();
});

it('explicit Push refuses external source drift without clearing the instance override', async () => {
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const column = initial.indexOf('<h1') + 1, key = `${file}:1:${column}~${placement}`;
  doc.getMap('sourceClasses').set(key, new Y.Map<unknown>([['classes', 'text-xl'], ['edited', true],
    ['sourceLocation', new Y.Map<unknown>(Object.entries({ file, line: 1, column, sourceVersion: sourceVersion(initial), sourceRevision: 0 }))]]));
  setClassWriteBaseline(key, 'old');
  const external = initial.replace('Original', 'Externally edited');
  writeFileSync(join(runtime.root, file), external);
  const result = await pushLocalOverridesToMaster(doc, file, placement);
  expect(result).toMatchObject({ pushed: 0, failed: 1 });
  expect(result.reasons.join(' ')).toContain('Source target version does not match');
  expect(runtime.read(file)).toBe(external);
  expect((doc.getMap('sourceClasses').get(key) as Y.Map<unknown>).get('edited')).toBe(true);
  expect(await db.durableEdits.count()).toBe(0);
  doc.destroy();
});

it('Push captures its file inverse before materialization and Undo restores the exact original bytes', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime.close(); runtime = projectFsRuntime(projectId, { [file]: initial }, { beforeCommand: () => gate });
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const column = initial.indexOf('<h1') + 1, key = `${file}:1:${column}~${placement}`;
  doc.getMap('sourceClasses').set(key, new Y.Map<unknown>([['classes', 'text-xl'], ['edited', true],
    ['sourceLocation', new Y.Map<unknown>(Object.entries({ file, line: 1, column, sourceVersion: sourceVersion(initial), sourceRevision: 0 }))]]));
  setClassWriteBaseline(key, 'old');
  try {
    const [beforeSource] = await readLocalPushFiles(projectId, [file]);
    expect(await pushLocalOverridesToMaster(doc, file, placement)).toMatchObject({ pushed: 1, failed: 0 });
    const [afterSource] = await readLocalPushFiles(projectId, [file]);
    expect(runtime.read(file)).toBe(initial);
    expect((await getDurableProjectState(projectId)).materializedRevision).toBe(0);
    expect(beforeSource).toBe(initial);
    expect(afterSource).toBe(initial.replace('class="old"', 'class="text-xl"'));
    // The snapshot's reverse file batch can be accepted while Push is pending.
    const undo = await acceptFileChanges(`wc://${projectId}`, [{ file, beforeSource: afterSource!, afterSource: beforeSource! }]);
    release(); await flushDurableSourceWritesThrough(projectId, undo.revision);
    expect(runtime.read(file)).toBe(initial);
  } finally { release(); doc.destroy(); }
});
